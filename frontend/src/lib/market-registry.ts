import { SEED_MARKETS, type NetworkKey } from "./chains";

const KEY = "realitybet.markets.v1";

/** Registry is per-network so Studio and testnet markets don't mix. */
function scopedKey(network: NetworkKey): string {
  return `${KEY}.${network}`;
}

export function listMarkets(network: NetworkKey): string[] {
  try {
    const raw = localStorage.getItem(scopedKey(network));
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // storage unavailable — fall back to seeds
  }
  return [...SEED_MARKETS];
}

export function addMarket(network: NetworkKey, id: string) {
  const clean = id.trim();
  if (!clean) return;
  const cur = listMarkets(network);
  if (!cur.includes(clean)) {
    cur.unshift(clean);
    try {
      localStorage.setItem(scopedKey(network), JSON.stringify(cur));
    } catch {
      // ignore
    }
  }
}

export function removeMarket(network: NetworkKey, id: string) {
  const cur = listMarkets(network).filter((m) => m !== id);
  try {
    localStorage.setItem(scopedKey(network), JSON.stringify(cur));
  } catch {
    // ignore
  }
}
