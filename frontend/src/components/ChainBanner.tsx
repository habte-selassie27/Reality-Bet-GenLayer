import { useState } from "react";
import { NETWORKS } from "../lib/chains";
import { useWallet } from "../lib/wallet";

/**
 * Warns when the connected wallet is not on the app's selected network.
 * Catching this up front avoids MetaMask rejecting writes with
 * `chainId should be same as current chainId`.
 */
export function ChainBanner() {
  const { network, chainId, expectedChainId, wrongChain, switchChain } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wrongChain) return null;

  const cfg = NETWORKS[network];

  async function onSwitch() {
    setBusy(true);
    setError(null);
    try {
      await switchChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
      <span aria-hidden>⚠️</span>
      <span className="font-medium">Wrong network</span>
      <span className="text-amber-200/90">
        Your wallet is on chain {chainId}, but RealityBet uses {cfg.label} ({expectedChainId}).
        Transactions will be rejected until you switch.
      </span>
      <button
        onClick={onSwitch}
        disabled={busy}
        className="ml-auto rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-amber-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Switching…" : `Switch to ${cfg.label}`}
      </button>
      {error && <div className="w-full text-xs text-red-200">{error}</div>}
    </div>
  );
}
