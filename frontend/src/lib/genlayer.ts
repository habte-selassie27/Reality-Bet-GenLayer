import { createClient } from "genlayer-js";
import { TransactionStatus } from "genlayer-js/types";
import type { Hash } from "genlayer-js/types";
import { encodeFunctionData, type Abi } from "viem";
import { CONTRACT_ADDRESS, NETWORKS, type NetworkKey } from "./chains";
import { REALITY_BET_ABI } from "./abi";

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
 * Send a write transaction directly via MetaMask's eth_sendTransaction,
 * bypassing the SDK's writeContract which has chainId mismatch issues.
 * Then poll the GenLayer SDK for the finalized receipt.
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

  const data = encodeFunctionData({
    abi: REALITY_BET_ABI as Abi,
    functionName: opts.method,
    args: (opts.args ?? []) as never[],
  });

  const txParams: Record<string, unknown> = {
    from: opts.address,
    to: contractAddress(),
    data,
  };
  if (opts.value && opts.value > 0n) {
    txParams.value = "0x" + opts.value.toString(16);
  }

  const hash = (await opts.provider.request({
    method: "eth_sendTransaction",
    params: [txParams],
  })) as string;

  const client = getClient(opts.network);
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
