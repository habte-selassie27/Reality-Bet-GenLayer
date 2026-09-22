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
  if (/fetch failed|timeout|network/i.test(msg)) return "Network error — Studio may be rate-limiting, retry shortly";
  return msg.slice(0, 180);
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
 */
export async function sendWrite<T>(opts: {
  network: NetworkKey;
  address: string;
  provider: any;
  method: string;
  args?: unknown[];
  value?: bigint;
  waitMs?: number;
}): Promise<TxOutcome<T>> {
  await ensureChain(opts.provider, opts.network);

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
  const retries = Math.max(1, Math.floor(waitMs / 5000));
  const receipt = await (client as unknown as ReceiptClient).waitForTransactionReceipt({
    hash: hash as Hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries,
    // Keeps consensus_data.leader_receipt[0].result, which the simplified
    // receipt drops — and that is where the return value / revert reason lives.
    fullTransaction: true,
  });

  const { execution, status, readable, vmError } = parseReceipt(receipt);
  const ok = status !== null ? status === "return" : execution === "SUCCESS";
  if (ok) {
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
