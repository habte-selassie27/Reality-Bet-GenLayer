import { chains } from "genlayer-js";

export type NetworkKey = "studionet" | "testnetAsimov" | "testnetBradbury" | "localnet";

export const NETWORKS: Record<
  NetworkKey,
  { label: string; explorer: string | null; chain: (typeof chains)[NetworkKey] }
> = {
  studionet: {
    label: "Studio",
    explorer: "https://explorer-studio.genlayer.com",
    chain: chains.studionet,
  },
  testnetAsimov: {
    label: "Asimov Testnet",
    explorer: null,
    chain: chains.testnetAsimov,
  },
  testnetBradbury: {
    label: "Bradbury Testnet",
    explorer: null,
    chain: chains.testnetBradbury,
  },
  localnet: {
    label: "Localnet",
    explorer: null,
    chain: chains.localnet,
  },
};

export function parseNetwork(v: string | undefined): NetworkKey {
  if (v === "testnetAsimov" || v === "testnetBradbury" || v === "localnet") return v;
  return "studionet";
}

export const CONTRACT_ADDRESS: string =
  import.meta.env.VITE_CONTRACT_ADDRESS ??
  "0x5809744633d425b3b419567021510f6B42E5AC60";

export const DEFAULT_NETWORK: NetworkKey = parseNetwork(import.meta.env.VITE_NETWORK);

export const SEED_MARKETS: string[] = (import.meta.env.VITE_SEED_MARKETS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * RPC endpoint handed to genlayer-js.
 *
 * Studio's public RPC returns 429s without `Access-Control-Allow-Origin`, so
 * the browser reports rate limiting as an opaque "blocked by CORS policy" /
 * "Failed to fetch" error. Calling a same-origin proxy avoids that entirely:
 * the Vercel rewrite in production, the Vite dev proxy locally, both `/api/rpc`.
 *
 * VITE_RPC_URL overrides it — set an absolute URL for a dedicated endpoint, or
 * the literal `direct` to bypass the proxy and use the SDK's built-in Studio URL.
 */
export function rpcUrl(): string | null {
  const explicit = (import.meta.env.VITE_RPC_URL ?? "").trim();
  if (explicit === "direct") return null;
  if (explicit) return explicit;
  if (typeof window === "undefined") return null;
  return `${window.location.origin}/api/rpc`;
}
