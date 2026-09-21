import { useEffect, useState } from "react";
import type { NetworkKey } from "./chains";
import { getPlatformStats } from "./contract";
import { sameAddress } from "./format";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<NetworkKey, { owner: string; at: number }>();

/** Contract owner, cached per network. Source of truth is on-chain. */
export async function getOwner(network: NetworkKey): Promise<string | null> {
  const hit = cache.get(network);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.owner;
  try {
    const s = await getPlatformStats(network);
    cache.set(network, { owner: s.owner, at: Date.now() });
    return s.owner;
  } catch {
    return hit?.owner ?? null;
  }
}

export function useOwner(network: NetworkKey): { owner: string | null; loading: boolean } {
  const [owner, setOwner] = useState<string | null>(() => cache.get(network)?.owner ?? null);
  const [loading, setLoading] = useState(() => !cache.has(network));
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOwner(network).then((o) => {
      if (!cancelled) {
        setOwner(o);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [network]);
  return { owner, loading };
}

/** True only when the connected wallet is the on-chain contract owner. */
export function isOwnerAddress(owner: string | null, address: string | null): boolean {
  return !!owner && !!address && sameAddress(owner, address);
}
