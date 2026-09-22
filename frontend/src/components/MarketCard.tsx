import { Link } from "react-router-dom";
import type { Market } from "../lib/contract";
import { countdown, fmtGen } from "../lib/format";
import { useNow } from "../lib/hooks";
import { CategoryBadge, OutcomeBadge, StatusBadge } from "./StatusBadge";

export function OddsBar({ yesPct }: { yesPct: number }) {
  const y = Math.max(0, Math.min(100, Math.round(yesPct)));
  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
        <div className="bg-emerald-400" style={{ width: `${y}%` }} />
        <div className="bg-rose-400" style={{ width: `${100 - y}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className="font-semibold text-emerald-300">YES {y}%</span>
        <span className="font-semibold text-rose-300">NO {100 - y}%</span>
      </div>
    </div>
  );
}

export function MarketCard({ market }: { market: Market }) {
  const now = useNow(1000);
  const total = market.pool_yes + market.pool_no;
  const yesPct = total === 0n ? 50 : Number((market.pool_yes * 100n) / total);
  const closingIn = market.status === "open" ? countdown(market.close_time, now) : null;

  return (
    <Link
      to={`/markets/${encodeURIComponent(market.id)}`}
      className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-violet-500/40 hover:bg-white/[0.05]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={market.status} />
        <OutcomeBadge outcome={market.outcome} />
        <CategoryBadge categories={market.categories} />
        {closingIn && market.status === "open" && (
          <span className="ml-auto text-xs text-zinc-400">closes in {closingIn}</span>
        )}
      </div>
      <h3 className="mt-3 text-base font-semibold leading-snug text-white">{market.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{market.description}</p>
      <OddsBar yesPct={yesPct} />
      <div className="mt-2 font-mono text-xs text-zinc-500">
        pool {fmtGen(total)} · id {market.id}
      </div>
    </Link>
  );
}
