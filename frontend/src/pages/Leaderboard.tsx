import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { getBet, getMarket, getMarketBets, type Bet, type Market } from "../lib/contract";
import { fmtGen, shorten, sameAddress } from "../lib/format";
import { useLoader } from "../lib/hooks";
import { listMarkets } from "../lib/market-registry";
import { useWallet } from "../lib/wallet";

interface BettorStats {
  address: string;
  profit: bigint;
  totalWagered: bigint;
  betsWon: number;
  betsLost: number;
  betsVoided: number;
  totalBets: number;
}

function estPayout(bet: Bet, market: Market): bigint {
  if (market.outcome === "void") return bet.amount;
  if (bet.side !== market.outcome) return 0n;
  const totalPool = market.pool_yes + market.pool_no;
  const winPool = market.outcome === "yes" ? market.pool_yes : market.pool_no;
  if (winPool === 0n) return 0n;
  const gross = (bet.amount * totalPool) / winPool;
  const fee = (gross * BigInt(market.fee_bps)) / 10000n;
  return gross - fee;
}

export function Leaderboard() {
  const { network, address } = useWallet();

  const stats = useLoader<BettorStats[]>(async () => {
    const ids = listMarkets(network);
    const bettorMap = new Map<string, BettorStats>();

    function getOrCreate(addr: string): BettorStats {
      const key = addr.toLowerCase();
      let s = bettorMap.get(key);
      if (!s) {
        s = { address: addr, profit: 0n, totalWagered: 0n, betsWon: 0, betsLost: 0, betsVoided: 0, totalBets: 0 };
        bettorMap.set(key, s);
      }
      return s;
    }

    for (const mid of ids) {
      let market: Market;
      try {
        market = await getMarket(network, mid);
      } catch {
        continue;
      }
      if (market.status !== "resolved") continue;

      let betIds: string[];
      try {
        betIds = await getMarketBets(network, mid);
      } catch {
        continue;
      }

      for (const bid of betIds) {
        let bet: Bet;
        try {
          bet = await getBet(network, bid);
        } catch {
          continue;
        }
        const s = getOrCreate(bet.bettor);
        s.totalBets++;
        s.totalWagered += bet.amount;

        if (!market.outcome || market.outcome === "void") {
          s.betsVoided++;
          s.profit += bet.amount; // refund
        } else if (bet.side === market.outcome) {
          s.betsWon++;
          const payout = estPayout(bet, market);
          s.profit += payout - bet.amount;
        } else {
          s.betsLost++;
          s.profit -= bet.amount;
        }
      }
    }

    return Array.from(bettorMap.values()).sort((a, b) => (b.profit > a.profit ? 1 : b.profit < a.profit ? -1 : 0));
  }, [network]);

  return (
    <div>
      <PageHeader title="Leaderboard" sub="Top bettors ranked by profit across resolved markets." />
      {stats.loading ? (
        <Spinner label="Loading leaderboard…" />
      ) : stats.error ? (
        <ErrorBox message={stats.error} onRetry={stats.reload} />
      ) : !stats.data || stats.data.length === 0 ? (
        <EmptyState title="No resolved bets yet" hint="Leaderboard populates once markets are resolved and bets are placed." />
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Bettor</th>
                  <th className="px-5 py-3 text-right">Profit</th>
                  <th className="px-5 py-3 text-right">Wagered</th>
                  <th className="px-5 py-3 text-right">Won</th>
                  <th className="px-5 py-3 text-right">Lost</th>
                  <th className="px-5 py-3 text-right">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.map((s, i) => {
                  const decisions = s.betsWon + s.betsLost;
                  const winRate = decisions > 0 ? Math.round((s.betsWon / decisions) * 100) : 0;
                  const isYou = address && sameAddress(s.address, address);
                  return (
                    <tr
                      key={s.address}
                      className={`border-b border-white/5 transition hover:bg-white/[0.03] ${
                        isYou ? "bg-violet-500/5" : ""
                      } ${i < 3 ? "bg-white/[0.02]" : ""}`}
                    >
                      <td className="px-5 py-3 font-mono text-zinc-500">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-mono text-xs ${isYou ? "text-violet-300" : "text-zinc-200"}`}>
                          {shorten(s.address, 6)}
                        </span>
                        {isYou && <span className="ml-2 text-[10px] text-violet-400">you</span>}
                      </td>
                      <td className={`px-5 py-3 text-right font-mono font-semibold ${s.profit >= 0n ? "text-emerald-400" : "text-rose-400"}`}>
                        {s.profit >= 0n ? "+" : ""}{fmtGen(s.profit)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-zinc-400">{fmtGen(s.totalWagered)}</td>
                      <td className="px-5 py-3 text-right font-mono text-emerald-400">{s.betsWon}</td>
                      <td className="px-5 py-3 text-right font-mono text-rose-400">{s.betsLost}</td>
                      <td className="px-5 py-3 text-right font-mono text-zinc-300">{decisions > 0 ? `${winRate}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
