import { Link } from "react-router-dom";
import { Btn, Card, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import {
  claimWinnings,
  getBetsByBettor,
  getMarket,
  refundVoid,
  type Bet,
  type Market,
} from "../lib/contract";
import { fmtDateTime, fmtGen } from "../lib/format";
import { useLoader } from "../lib/hooks";
import { useWallet } from "../lib/wallet";
import { useState } from "react";

interface Row extends Bet {
  marketTitle: string;
  marketStatus: string;
  marketOutcome: string;
}

/**
 * Bets come straight from the contract's per-bettor index
 * (get_bets_by_bettor), so this page works in any browser — it no longer
 * depends on the visitor's local market registry.
 */
export function MyBets() {
  const { network, address, provider } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const bets = useLoader<Row[]>(async () => {
    if (!address) return [];

    // One call for every bet this wallet placed, then one cached read per
    // distinct market for its title and status.
    const mine = await getBetsByBettor(network, address);
    const markets = new Map<string, Market>();
    await Promise.all(
      Array.from(new Set(mine.map((b) => b.market_id))).map(async (mid) => {
        try {
          markets.set(mid, await getMarket(network, mid));
        } catch {
          // market unreadable — fall back to showing the raw id
        }
      }),
    );

    return mine
      .map((b) => {
        const mk = markets.get(b.market_id);
        return {
          ...b,
          marketTitle: mk?.title ?? b.market_id,
          marketStatus: mk?.status ?? "",
          marketOutcome: mk?.outcome ?? "",
        };
      })
      .sort((a, b) => b.placed_at - a.placed_at);
  }, [network, address]);

  async function act(betId: string, kind: "claim" | "refund") {
    if (!address) return;
    setBusyId(betId);
    setMsg(null);
    try {
      const out = kind === "claim" ? await claimWinnings(network, address, provider, betId) : await refundVoid(network, address, provider, betId);
      if (!out.ok) {
        setMsg(out.revertReason ?? "Transaction reverted");
      } else {
        const extra = out.result !== null && typeof out.result !== "boolean" ? ` → ${String(out.result)} wei` : "";
        setMsg(`${kind === "claim" ? "Claimed" : "Refunded"} ${betId}${extra}`);
        bets.reload();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="My bets" sub="Bets placed by the connected wallet on this network." />
      {!address ? (
        <EmptyState title="No wallet connected" hint="Connect a wallet to see your bets." />
      ) : bets.loading ? (
        <Spinner label="Loading your bets…" />
      ) : bets.error ? (
        <ErrorBox message={bets.error} onRetry={bets.reload} />
      ) : !bets.data || bets.data.length === 0 ? (
        <EmptyState title="No bets yet" hint="Browse open markets and place your first bet." action={<Link to="/markets" className="text-sm text-violet-300 hover:underline">Browse markets</Link>} />
      ) : (
        <div className="space-y-3">
          {msg && <div className="rounded-xl border border-white/15 bg-white/5 p-3 font-mono text-xs text-zinc-200">{msg}</div>}
          {bets.data.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase ${b.side === "yes" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-rose-400/30 bg-rose-400/10 text-rose-300"}`}>
                  {b.side}
                </span>
                <span className="font-mono text-sm text-white">{fmtGen(b.amount)}</span>
                <span className="text-xs text-zinc-500">placed {fmtDateTime(b.placed_at)}</span>
                {b.claimed && <span className="text-xs text-zinc-500">· claimed</span>}
              </div>
              <Link to={`/markets/${encodeURIComponent(b.market_id)}`} className="mt-2 block text-sm font-medium text-zinc-100 hover:text-violet-300">
                {b.marketTitle}
              </Link>
              <div className="mt-1 font-mono text-xs text-zinc-500">
                market {b.marketStatus}{b.marketOutcome ? ` · outcome ${b.marketOutcome}` : ""} · bet {b.id}
              </div>
              {!b.claimed && b.marketStatus === "resolved" && (
                <Btn className="mt-3" disabled={busyId === b.id} onClick={() => act(b.id, "claim")}>
                  {busyId === b.id ? "Claiming…" : "Claim winnings"}
                </Btn>
              )}
              {!b.claimed && b.marketStatus === "voided" && (
                <Btn className="mt-3" disabled={busyId === b.id} onClick={() => act(b.id, "refund")}>
                  {busyId === b.id ? "Refunding…" : "Refund (voided)"}
                </Btn>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
