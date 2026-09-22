import { Link } from "react-router-dom";
import { MarketCard } from "../components/MarketCard";
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { getMarket, getPlatformStats } from "../lib/contract";
import { fmtGen } from "../lib/format";
import { useLoader } from "../lib/hooks";
import { listMarkets } from "../lib/market-registry";
import { NETWORKS } from "../lib/chains";
import { useWallet } from "../lib/wallet";

export function Home() {
  const { network } = useWallet();
  const stats = useLoader(() => getPlatformStats(network), [network]);
  const featured = useLoader(async () => {
    const ids = listMarkets(network).slice(0, 3);
    const out = [];
    for (const id of ids) {
      try {
        out.push(await getMarket(network, id));
      } catch {
        // skip missing markets
      }
    }
    return out;
  }, [network]);

  return (
    <div>
      <div className="overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-900/40 via-[#12131a] to-[#12131a] p-8 sm:p-12">
        <h1 className="max-w-2xl text-3xl font-black tracking-tight text-white sm:text-5xl">
          Bet on reality. <span className="text-violet-300">Settled by AI consensus.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
          RealityBet is a prediction market on GenLayer. Anyone creates a YES/NO market, bettors fund
          pools in GEN, and validator consensus resolves real-world events using live web data.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/markets" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">
            Browse markets
          </Link>
          <Link to="/create" className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/10">
            Create a market
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.loading ? (
          <Card><Spinner label="Loading stats…" /></Card>
        ) : stats.error ? (
          <div className="sm:col-span-3"><ErrorBox message={stats.error} onRetry={stats.reload} /></div>
        ) : (
          <>
            <Card>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Total volume</div>
              <div className="mt-1 text-2xl font-bold text-white">{fmtGen(stats.data?.total_volume ?? 0n)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">GEN wagered across all markets</div>
            </Card>
            <Card>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Markets created</div>
              <div className="mt-1 text-2xl font-bold text-white">{stats.data?.total_markets ?? 0}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">All-time on {NETWORKS[network].label}</div>
            </Card>
            <Card>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Network</div>
              <div className="mt-1 text-2xl font-bold text-white">{NETWORKS[network].label}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">Chain ID {NETWORKS[network].chain.id}</div>
            </Card>
          </>
        )}
      </div>

      <PageHeader title="Featured markets" sub="Recently tracked markets on this network." action={<Link to="/markets" className="text-sm text-violet-300 hover:underline">View all →</Link>} />
      {featured.loading ? (
        <Spinner />
      ) : featured.error ? (
        <ErrorBox message={featured.error} onRetry={featured.reload} />
      ) : featured.data && featured.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.data.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      ) : (
        <EmptyState title="No markets tracked yet" hint="Create the first market or import one by id." action={<Link to="/create" className="text-sm text-violet-300 hover:underline">Create a market</Link>} />
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          { t: "1 · Create", d: "Set a question, resolution criteria and a primary source URL. Betting opens immediately." },
          { t: "2 · Bet", d: "Fund YES or NO pools in GEN. Odds come from pool math — no oracle needed." },
          { t: "3 · Resolve & claim", d: "AI validators fetch the source, agree on an outcome, and winners claim parimutuel payouts. Losers can dispute within 24h." },
        ].map((s) => (
          <Card key={s.t}>
            <div className="font-semibold text-white">{s.t}</div>
            <div className="mt-1.5 text-sm leading-relaxed text-zinc-400">{s.d}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
