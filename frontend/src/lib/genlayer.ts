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

/**
 * Write-capable client. Pass address string + provider for MetaMask signing,
 * or a viem Account for local key signing.
 */
export function getWriteClient(
  network: NetworkKey,
  accountOrAddress: string,
  provider?: any,
): Client {
  const opts: any = { chain: NETWORKS[network].chain };
  if (provider) {
    // MetaMask path: SDK routes eth_sendTransaction to the provider
    opts.account = accountOrAddress;
    opts.provider = provider;
  } else {
    // Local key path: SDK signs locally with the Account object
    opts.account = accountOrAddress;
  }
  return createClient(opts);
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

/** Pull `{execution_result, result.payload.readable}` out of a receipt shape. */
function parseReceipt(receipt: unknown): { execution: string; readable: string | null } {
  try {
    const r = receipt as Record<string, unknown>;
    const cd = r["consensus_data"] as Record<string, unknown> | undefined;
    const leader = (cd?.["leader_receipt"] as Array<Record<string, unknown>> | undefined)?.[0];
    const execution = String(leader?.["execution_result"] ?? "UNKNOWN");
    const res = leader?.["result"] as Record<string, unknown> | undefined;
    const payload = res?.["payload"] as Record<string, unknown> | undefined;
    const readable = typeof payload?.["readable"] === "string" ? (payload["readable"] as string) : null;
    return { execution, readable };
  } catch {
    return { execution: "UNKNOWN", readable: null };
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

function revertFromReadable(readable: string | null): string | null {
  if (!readable) return null;
  const parsed = parseReadable<string>(readable);
  return typeof parsed === "string" && parsed.length > 0 ? parsed : readable;
}

/**
 * Send a write, wait for finalization, and classify the outcome.
 * accountOrAddress: either a viem Account object or a string address (for MetaMask).
 * provider: EIP-1193 provider (window.ethereum) — required when address is a string.
 */
export async function sendWrite<T>(opts: {
  network: NetworkKey;
  accountOrAddress: any;
  provider?: any;
  method: string;
  args?: unknown[];
  value?: bigint;
  waitMs?: number;
}): Promise<TxOutcome<T>> {
  const client = getWriteClient(opts.network, opts.accountOrAddress, opts.provider);
  const hash = (await client.writeContract({
    address: contractAddress() as `0x${string}`,
    functionName: opts.method,
    args: (opts.args ?? []) as never[],
    value: opts.value ?? 0n,
    account: opts.accountOrAddress,
  })) as unknown as string;

  const waitMs = opts.waitMs ?? 1000 * 60 * 8;
  const retries = Math.max(1, Math.floor(waitMs / 5000));
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as Hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries,
  });

  const { execution, readable } = parseReceipt(receipt);
  if (execution === "SUCCESS") {
    return { hash, ok: true, result: parseReadable<T>(readable), execution, revertReason: null };
  }
  return { hash, ok: false, result: null, execution, revertReason: revertFromReadable(readable) ?? "Transaction reverted" };
}
