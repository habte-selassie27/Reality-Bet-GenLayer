import { useMemo, useState } from "react";
import { placeBet, type Market } from "../lib/contract";
import { fmtGen, parseGen, WEI } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Btn, Field, inputCls, TxHash } from "./ui";

export function PlaceBetModal({
  market,
  onClose,
  onPlaced,
}: {
  market: Market;
  onClose: () => void;
  onPlaced: (betId: string, txHash: string) => void;
}) {
  const { network, address, provider } = useWallet();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("0.5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const wei = useMemo(() => parseGen(amount), [amount]);

  const estPayout = useMemo(() => {
    if (wei === null) return null;
    const py = market.pool_yes + (side === "yes" ? wei : 0n);
    const pn = market.pool_no + (side === "no" ? wei : 0n);
    const total = py + pn;
    const winPool = side === "yes" ? py : pn;
    if (winPool === 0n) return null;
    const gross = (wei * total) / winPool;
    const fee = (gross * BigInt(market.fee_bps)) / 10000n;
    return gross - fee;
  }, [wei, side, market]);

  async function submit() {
    if (!address || !provider || wei === null) return;
    setBusy(true);
    setError(null);
    try {
      const out = await placeBet(network, address, market.id, side, wei);
      if (!out.ok) {
        setError(out.revertReason ?? "Bet reverted");
        return;
      }
      setTx(out.hash);
      onPlaced(String(out.result ?? ""), out.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12131a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">Place bet</h2>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{market.title}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-xl border px-4 py-2.5 text-sm font-bold uppercase transition ${
                side === s
                  ? s === "yes"
                    ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                    : "border-rose-400/60 bg-rose-400/15 text-rose-200"
                  : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <Field label="Amount (GEN)" hint={wei === null ? "Enter a valid amount" : `≈ ${fmtGen(wei)} · ${wei.toString()} wei`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputCls} />
          </Field>
        </div>

        <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs text-zinc-300">
          <div className="flex justify-between">
            <span>Est. payout if {side.toUpperCase()} wins</span>
            <span className="font-mono font-semibold text-white">
              {estPayout !== null ? fmtGen(estPayout) : "—"}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-zinc-500">
            <span>Fee ({(market.fee_bps / 100).toFixed(2)}%) taken from winnings</span>
            <span>1 GEN = {WEI.toString()} wei</span>
          </div>
        </div>

        {error && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}
        {tx && (
          <div className="mt-3 text-xs text-zinc-400">
            Submitted: <TxHash hash={tx} />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Btn className="flex-1" disabled={!address || wei === null || busy} onClick={submit}>
            {busy ? "Waiting for consensus…" : `Bet ${side.toUpperCase()}`}
          </Btn>
          <Btn variant="ghost" onClick={onClose}>
            Close
          </Btn>
        </div>
        {!address && <div className="mt-2 text-xs text-amber-300">Connect a wallet to place bets.</div>}
      </div>
    </div>
  );
}
