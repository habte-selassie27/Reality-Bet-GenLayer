import { chains } from "genlayer-js";

export type NetworkKey = "studionet" | "testnetAsimov" | "testnetBradbury" | "localnet";

export const NETWORKS: Record<
  NetworkKey,
  { label: string; explorer: string | null; chain: (typeof chains)[NetworkKey] }
> = {
  studionet: {
    label: "Studio",
    explorer: "https://genlayer-explorer.vercel.app",
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
  "0x6CC37dD808cb9758245A3C8Aa37feFB116A80dfC";

export const DEFAULT_NETWORK: NetworkKey = parseNetwork(import.meta.env.VITE_NETWORK);

export const SEED_MARKETS: string[] = (import.meta.env.VITE_SEED_MARKETS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);
