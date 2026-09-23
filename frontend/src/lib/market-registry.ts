import { SEED_MARKETS, type NetworkKey } from "./chains";

/**
 * Pinned market ids for the current browser.
 *
 * This is NOT the source of truth any more: the contract exposes
 * get_market_ids / get_markets_page, so Market lists, My Bets and the
 * Leaderboard read every market on chain. What remains here is a small
 * per-browser list of ids worth keeping visible anyway — markets created
 * locally before those views shipped, and ids pasted in via "Import by ID" —
 * plus the optional VITE_SEED_MARKETS list baked in at build time.
 */

/** Bump this to force-clear stale localStorage data from old deployments. */
const STORAGE_VERSION = 3;
const KEY = `realitybet.markets.v${STORAGE_VERSION}`;

/** Known test/probe markets to exclude from the registry. */
const EXCLUDED = new Set(["m2-1789988760", "m3-1789988982", "m5-1789989445", "m7-1789990765"]);

/** Registry is per-network so Studio and testnet markets don't mix. */
function scopedKey(network: NetworkKey): string {
  return `${KEY}.${network}`;
}

export function listMarkets(network: NetworkKey): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem(scopedKey(network));
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) saved = arr.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* storage unavailable */
  }

  // Merge: start with saved, prepend any new seeds not already present.
  const seen = new Set(saved);
  const merged: string[] = [...saved];
  for (const id of SEED_MARKETS) {
    if (!seen.has(id)) merged.unshift(id);
  }

  // Filter out known test/probe markets and deduplicate.
  const out: string[] = [];
  const outSeen = new Set<string>();
  for (const id of merged) {
    if (!EXCLUDED.has(id) && !outSeen.has(id)) {
      out.push(id);
      outSeen.add(id);
    }
  }

  // Persist the cleaned list back.
  if (out.length !== saved.length || out.some((id, i) => id !== saved[i])) {
    try {
      localStorage.setItem(scopedKey(network), JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }

  return out;
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
