import { createClient } from "genlayer-js";
import { TransactionStatus } from "genlayer-js/types";
import type { Hash } from "genlayer-js/types";
import { CONTRACT_ADDRESS, NETWORKS, type NetworkKey } from "./chains";

type Client = ReturnType<typeof createClient>;

const clients = new Map<string, Client>();

/** Cached read-only client per network (no account needed for views). */
export function getClient(network: NetworkKey): Client {
  const hit = clients.get(network);
  if (hit) return hit;
  const c = createClient({ chain: NETWORKS[network].chain });
  clients.set(network, c);
  return c;
}

/** Hex chain id as MetaMask expects it (lowercase, 0x-prefixed). */
export function chainIdHex(network: NetworkKey): string {
  return "0x" + NETWORKS[network].chain.id.toString(16);
}

/**
 * Ensure the wallet is on the correct GenLayer chain before sending a tx.
 *
 * A tx sent while the wallet sits on another chain is rejected by MetaMask with
 * `-32602 chainId should be same as current chainId`, so we verify with
 * `eth_chainId` instead of trusting `wallet_switchEthereumChain` to have worked.
 */
export async function ensureChain(eth: any, network: NetworkKey): Promise<void> {
  const cfg = NETWORKS[network];
  const targetId = chainIdHex(network);

  const already = await eth.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof already === "string" && already.toLowerCase() === targetId.toLowerCase()) return;

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetId }] });
  } catch (err: any) {
    // 4902 = chain unknown to the wallet → register it, then it is selected.
    if (err?.code === 4902 || err?.code === -32603) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: targetId,
          chainName: cfg.chain.name,
          rpcUrls: [cfg.chain.rpcUrls.default.http[0]],
          // Required by EIP-3085 — a wallet may refuse to add the chain without it.
          nativeCurrency: cfg.chain.nativeCurrency,
          blockExplorerUrls: cfg.explorer ? [cfg.explorer] : [],
        }],
      });
    } else if (err?.code === 4001) {
      throw new Error(`Switch your wallet to ${cfg.chain.name} to continue.`);
    } else {
      throw err;
    }
  }

  const now = await eth.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof now === "string" && now.toLowerCase() !== targetId.toLowerCase()) {
    throw new Error(
      `Wallet is on chain ${parseInt(now, 16)} but RealityBet needs ${cfg.chain.name} ` +
        `(${cfg.chain.id}). Switch networks in your wallet and retry.`,
    );
  }
}

export function contractAddress(): string {
  return CONTRACT_ADDRESS;
}

/** Unwrap genlayer-js decoded values into plain JS (bigint-safe). */
export function decode<T>(v: unknown): T {
  return v as T;
}

/**
 * Extract the human-readable revert reason from a failed read, e.g.
 * "Market not found". Falls back to a generic message.
 */
export function readErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/payload['"]?\s*:\s*['"]([^'"]+)['"]/);
  if (m) return m[1];
  if (/execution failed/i.test(msg)) return "Contract call reverted (see details)";
  if (/429|Too Many Requests|Rate limit/i.test(msg)) {
    return "Studio RPC rate-limited (500 requests/hour) — try again in a few minutes.";
  }
  if (isNetworkError(msg)) return "Network error — Studio may be rate-limiting, retry shortly";
  return msg.slice(0, 180);
}

/** Detect transient network-level errors (RPC down, rate-limited, CORS). */
function isNetworkError(msg: string): boolean {
  return /fetch failed|timeout|network|ERR_CONNECTION_CLOSED|net::ERR|Failed to fetch|Connection closed/i.test(msg);
}

// ── Studio rate-limit guard (500 requests/hour) ────────────────────
// Studio's 429s surface in the browser as opaque CORS/"Failed to fetch"
// errors (the 429 response lacks Access-Control-Allow-Origin), so we
// treat explicit 429 text OR a burst of network failures as rate
// limiting, engage a cooldown, and fail fast until it expires.

const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000; // pause all RPC for 10 min
const NET_FAIL_WINDOW_MS = 30_000;          // burst window
const NET_FAIL_THRESHOLD = 3;               // failures within window → rate-limited

let rateLimitedUntil = 0;
let netFailStamps: number[] = [];

function rateLimitError(): Error {
  const mins = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 60_000));
  return new Error(
    `Studio RPC rate-limited (500 requests/hour) — waiting; try again in ~${mins} min.`,
  );
}

/** Fail fast while the cooldown is active (no RPC traffic). */
export function guardRateLimit(): void {
  if (Date.now() < rateLimitedUntil) throw rateLimitError();
}

function engageRateLimit(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  netFailStamps = [];
}

/** Classify a read/write failure; engages the cooldown when rate-limited. */
function noteFailure(err: unknown): "rate_limit" | "user_reject" | "network" | "other" {
  const msg = err instanceof Error ? err.message : String(err);
  if (/4001|user rejected|denied/i.test(msg)) return "user_reject";
  if (/429|Too Many Requests|Rate limit/i.test(msg)) {
    engageRateLimit();
    return "rate_limit";
  }
  if (!isNetworkError(msg)) {
    // Contract-level responses prove the RPC is reachable — reset the burst.
    netFailStamps = [];
    return "other";
  }
  const now = Date.now();
  netFailStamps = netFailStamps.filter((t) => now - t < NET_FAIL_WINDOW_MS);
  netFailStamps.push(now);
  if (netFailStamps.length >= NET_FAIL_THRESHOLD) {
    engageRateLimit();
    return "rate_limit";
  }
  return "network";
}

/** Public wrapper: classify a read failure and engage the cooldown if needed. */
export function noteFailurePublic(err: unknown): void {
  noteFailure(err);
}

// ── View cache (30s TTL) ────────────────────────────────────────────
// Cross-navigation dedupe: re-entering a page reuses recent reads
// instead of re-hitting the RPC. Cleared after every successful write.

const VIEW_TTL_MS = 30_000;
const viewCache = new Map<string, { t: number; v: unknown }>();

export function viewCacheGet<T>(network: NetworkKey, method: string, args: unknown[]): T | null {
  let key: string;
  try {
    key = `${network}|${method}|${JSON.stringify(args)}`;
  } catch {
    return null;
  }
  const hit = viewCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > VIEW_TTL_MS) {
    viewCache.delete(key);
    return null;
  }
  return hit.v as T;
}

export function viewCacheSet(network: NetworkKey, method: string, args: unknown[], value: unknown): void {
  try {
    viewCache.set(`${network}|${method}|${JSON.stringify(args)}`, { t: Date.now(), v: value });
  } catch {
    // non-serializable args — skip caching
  }
}

export function clearViewCache(): void {
  viewCache.clear();
}

export interface TxOutcome<T> {
  hash: string;
  ok: boolean;
  /** Decoded return payload (bet id, bool, payout wei-string, …). */
  result: T | null;
  /** Raw leader execution result, e.g. SUCCESS / ERROR. */
  execution: string;
  /** Revert reason when ok === false. */
  revertReason: string | null;
}

interface ReceiptInfo {
  /** Leader execution result, e.g. SUCCESS / ERROR. */
  execution: string;
  /** VM result status: return | rollback | contract_error | error | none. */
  status: string | null;
  /** Decoded return value (status "return") or revert message (status is an error). */
  readable: string | null;
  /** Lower-level GenVM error text, when the VM itself failed. */
  vmError: string | null;
}

/**
 * Read the outcome out of a GenLayer receipt.
 *
 * Studio decodes `leader_receipt[0].result` into `{ raw, status, payload }`: on
 * success the payload is `{ readable }`, while a revert carries the message
 * directly as a string. `genvm_result` holds VM-level errors.
 */
function parseReceipt(receipt: unknown): ReceiptInfo {
  try {
    const r = receipt as Record<string, unknown>;
    const cd = r["consensus_data"] as Record<string, unknown> | undefined;
    const leader = (cd?.["leader_receipt"] as Array<Record<string, unknown>> | undefined)?.[0];
    if (!leader) return { execution: "UNKNOWN", status: null, readable: null, vmError: null };

    const execution = String(leader["execution_result"] ?? "UNKNOWN");
    const res = leader["result"] as Record<string, unknown> | undefined;
    const status = typeof res?.["status"] === "string" ? (res["status"] as string) : null;
    const payload = res?.["payload"];
    const readable =
      typeof payload === "string"
        ? payload
        : typeof (payload as Record<string, unknown> | undefined)?.["readable"] === "string"
          ? ((payload as Record<string, unknown>)["readable"] as string)
          : null;

    const genvm = leader["genvm_result"] as Record<string, unknown> | undefined;
    const vmError =
      typeof genvm?.["error_data"] === "string" && genvm["error_data"]
        ? (genvm["error_data"] as string)
        : typeof genvm?.["stderr"] === "string" && genvm["stderr"]
          ? (genvm["stderr"] as string)
          : null;

    return { execution, status, readable, vmError };
  } catch {
    return { execution: "UNKNOWN", status: null, readable: null, vmError: null };
  }
}

/** Parse a `readable` payload like '"m5-…"' / 'true' / '0' / '30019047…' into JS. */
export function parseReadable<T>(readable: string | null): T | null {
  if (readable === null) return null;
  try {
    return JSON.parse(readable) as T;
  } catch {
    return readable as unknown as T;
  }
}

/** `fullTransaction` is supported at runtime but missing from the SDK types. */
interface ReceiptClient {
  waitForTransactionReceipt(args: {
    hash: Hash;
    status?: TransactionStatus;
    interval?: number;
    retries?: number;
    fullTransaction?: boolean;
  }): Promise<unknown>;
}

/**
 * Send a state-changing call and wait for it to finalize.
 *
 * A GenLayer write is not an EVM call to the contract address: the SDK encodes
 * the method and submits it through the consensus contract's `addTransaction`.
 * Hand-encoding ABI calldata and sending it straight to the contract (as this
 * used to do) reverts, because the EVM tx never enters consensus. The wallet is
 * switched to the right chain first, so the `chainId` the SDK attaches is the
 * one the wallet is already on.
 *
 * Retries transient network errors (RPC connection closed) up to 3 times with
 * exponential backoff. Rate-limit failures (429 / burst) engage a 10-minute
 * cooldown and fail immediately — no retries while limited.
 */
const MAX_WRITE_RETRIES = 3;
const RETRY_BASE_MS = 2000;

export async function sendWrite<T>(opts: {
  network: NetworkKey;
  address: string;
  provider: any;
  method: string;
  args?: unknown[];
  value?: bigint;
  waitMs?: number;
}): Promise<TxOutcome<T>> {
  guardRateLimit();
  await ensureChain(opts.provider, opts.network);

  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
    guardRateLimit();
    try {
      return await sendWriteOnce<T>(opts);
    } catch (err: unknown) {
      lastErr = err;
      const kind = noteFailure(err);
      // Rate-limited → cooldown engaged, fail immediately (no retries).
      // Contract reverts / user rejections fail immediately too.
      // Only other transient network errors are retried with backoff.
      if (kind === "rate_limit") throw rateLimitError();
      if (kind === "user_reject" || kind === "other") throw err;
      if (attempt < MAX_WRITE_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[RealityBet] Network error (attempt ${attempt}/${MAX_WRITE_RETRIES}), retrying in ${delay}ms …`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function sendWriteOnce<T>(opts: {
  network: NetworkKey;
  address: string;
  provider: any;
  method: string;
  args?: unknown[];
  value?: bigint;
  waitMs?: number;
}): Promise<TxOutcome<T>> {
  const client = createClient({
    chain: NETWORKS[opts.network].chain,
    account: opts.address as `0x${string}`,
    provider: opts.provider,
  });

  const hash = (await client.writeContract({
    address: contractAddress() as `0x${string}`,
    functionName: opts.method,
    args: (opts.args ?? []) as never[],
    value: opts.value ?? 0n,
  })) as string;

  const waitMs = opts.waitMs ?? 1000 * 60 * 8;
  // Poll every 12s instead of 5s — receipt checks are RPC requests and the
  // Studio endpoint allows only 500/hour. Still ~40 polls over 8 minutes.
  const POLL_MS = 12_000;
  const retries = Math.max(1, Math.floor(waitMs / POLL_MS));
  const receipt = await (client as unknown as ReceiptClient).waitForTransactionReceipt({
    hash: hash as Hash,
    status: TransactionStatus.FINALIZED,
    interval: POLL_MS,
    retries,
    // Keeps consensus_data.leader_receipt[0].result, which the simplified
    // receipt drops — and that is where the return value / revert reason lives.
    fullTransaction: true,
  });

  const { execution, status, readable, vmError } = parseReceipt(receipt);
  const ok = status !== null ? status === "return" : execution === "SUCCESS";
  if (ok) {
    clearViewCache(); // state changed — stale reads must not be reused
    return { hash, ok: true, result: parseReadable<T>(readable), execution, revertReason: null };
  }
  return {
    hash,
    ok: false,
    result: null,
    execution,
    revertReason: readable ?? vmError ?? `Transaction ${status ?? execution}`,
  };
}
