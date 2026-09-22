import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { OddsBar } from "../components/MarketCard";
import { PlaceBetModal } from "../components/PlaceBetModal";
import { CategoryBadge, OutcomeBadge, StatusBadge } from "../components/StatusBadge";
import { Btn, Card, ErrorBox, Field, inputCls, PageHeader, Spinner, TxHash } from "../components/ui";
import {
  claimWinnings,
  getBet,
  getMarket,
  getMarketBets,
  getOdds,
  lockMarket,
  raiseDispute,
  refundVoid,
  requestResolution,
  voidMarket,
  type Bet,
  type Market,
  type Odds,
} from "../lib/contract";
import { countdown, fmtDateTime, fmtGen, sameAddress, shorten } from "../lib/format";
import { useLoader, useNow } from "../lib/hooks";
import { useWallet } from "../lib/wallet";

interface Detail {
  market: Market;
  odds: Odds;
  bets: Bet[];
}

function estPayout(bet: Bet, market: Market): bigint {
  if (market.status !== "resolved" || !market.outcome) return 0n;
  if (market.outcome === "void") return bet.amount;
  if (bet.side !== market.outcome) return 0n;
  const totalPool = market.pool_yes + market.pool_no;
  const winPool = market.outcome === "yes" ? market.pool_yes : market.pool_no;
  if (winPool === 0n) return 0n;
  const gross = (bet.amount * totalPool) / winPool;
  const fee = (gross * BigInt(market.fee_bps)) / 10000n;
  return gross - fee;
}

function UrgencyCountdown({ target, now, label }: { target: number; now: number; label: string }) {
  const remaining = target - now;
  const isPast = remaining < 0;
  const abs = Math.abs(remaining);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const timeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  const colorClass = isPast
    ? "text-zinc-500"
    : abs < 3600
      ? "text-rose-400 animate-pulse"
      : abs < 86400
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-500">{label}:</span>
      <span className={`font-mono font-semibold ${colorClass}`}>
        {isPast ? `${timeStr} ago` : timeStr}
      </span>
    </div>
  );
}

export function MarketDetail() {
  const { id = "" } = useParams();
  const marketId = decodeURIComponent(id);
  const { network, address, provider } = useWallet();
  const now = useNow(1000);
  const [betOpen, setBetOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<{ label: string; hash: string; extra?: string } | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [copied, setCopied] = useState(false);

  const detail = useLoader<Detail>(async () => {
    const [market, odds, betIds] = await Promise.all([
      getMarket(network, marketId),
      getOdds(network, marketId),
      getMarketBets(network, marketId),
    ]);
    const bets = await Promise.all(betIds.map((b) => getBet(network, b)));
    return { market, odds, bets };
  }, [network, marketId]);

  useEffect(() => {
    const t = setInterval(() => detail.reload(), 15000);
    return () => clearInterval(t);
  }, [network, marketId]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; hash: string; revertReason: string | null; result: unknown }>) {
    if (!address) { setActionErr("Connect a wallet first."); return; }
    setBusy(label);
    setActionErr(null);
    setTxMsg(null);
    try {
      const out = await fn();
      if (!out.ok) { setActionErr(out.revertReason ?? `${label} reverted`); return; }
      setTxMsg({ label, hash: out.hash, extra: out.result !== null && typeof out.result !== "boolean" ? String(out.result) : undefined });
      detail.reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function shareMarket() {
    const url = `${window.location.origin}/markets/${encodeURIComponent(marketId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.createElement("input");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const m = detail.data?.market ?? null;
  const bets = detail.data?.bets ?? [];
  const myBets = bets.filter((b) => address && sameAddress(b.bettor, address));
  const disputeOpen = m?.status === "resolved" && m.resolved_at > 0 && now <= m.resolved_at + 86400;
  const sortedBets = [...bets].sort((a, b) => b.placed_at - a.placed_at);

  return (
    <div>
      <PageHeader title={m?.title ?? marketId} sub={m ? `Market ${m.id}` : undefined} />
      {detail.loading && !detail.data ? (
        <Spinner label="Loading market…" />
      ) : detail.error && !detail.data ? (
        <ErrorBox message={detail.error} onRetry={detail.reload} />
      ) : !m ? (
        <ErrorBox message="Market not found." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={m.status} />
                <OutcomeBadge outcome={m.outcome} />
                <CategoryBadge category={m.category} />
                <button
                  onClick={shareMarket}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {copied ? "Copied!" : "Share"}
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{m.description}</p>
              <div className="mt-3 grid gap-2 font-mono text-xs text-zinc-400 sm:grid-cols-2">
                <div>source: <a href={m.resolution_url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">{m.resolution_url}</a></div>
                <div>creator: {shorten(m.creator)}</div>
                <div>fee: {(m.fee_bps / 100).toFixed(2)}%</div>
              </div>
              {m.status === "open" && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <UrgencyCountdown target={m.close_time} now={now} label="Closes" />
                  <UrgencyCountdown target={m.resolve_time} now={now} label="Resolvable" />
                </div>
              )}
              {m.status === "locked" && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <UrgencyCountdown target={m.resolve_time} now={now} label="Resolvable" />
                </div>
              )}
              {m.status === "resolved" && m.resolved_at > 0 && (
                <div className="mt-3 text-sm text-zinc-500">
                  Resolved {fmtDateTime(m.resolved_at)}
                </div>
              )}
              {m.resolver_note && (
                <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI Resolution
                    {m.resolver_confidence && (
                      <span
                        className={`ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] normal-case ${
                          m.resolver_confidence === "high"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : m.resolver_confidence === "medium"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        confidence: {m.resolver_confidence}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{m.resolver_note}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
                    <span>Source checked: <a href={m.resolution_url} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">{m.resolution_url}</a></span>
                    {(() => {
                      try {
                        const sources: unknown = m.resolver_sources ? JSON.parse(m.resolver_sources) : [];
                        return Array.isArray(sources)
                          ? sources.filter((s) => typeof s === "string" && s !== m.resolution_url).map((s) => (
                              <span key={s}>· <a href={s} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">{s}</a></span>
                            ))
                          : null;
                      } catch {
                        return null;
                      }
                    })()}
                  </div>
                </div>
              )}
              <OddsBar yesPct={detail.data?.odds.yes ?? 50} />
              <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-zinc-400">
                <span>YES pool: {fmtGen(m.pool_yes)}</span>
                <span>NO pool: {fmtGen(m.pool_no)}</span>
                <span>bets: {bets.length}</span>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-white">Bets ({bets.length})</h3>
              {bets.length === 0 ? (
                <div className="mt-2 text-sm text-zinc-500">No bets yet.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {sortedBets.map((b) => {
                    const isWinner = m.status === "resolved" && m.outcome && b.side === m.outcome;
                    const isLoser = m.status === "resolved" && m.outcome && m.outcome !== "void" && b.side !== m.outcome;
                    const payout = estPayout(b, m);
                    return (
                      <div
                        key={b.id}
                        className={`flex flex-wrap items-center gap-2 rounded-xl p-3 font-mono text-xs ${
                          isWinner ? "border border-emerald-500/30 bg-emerald-500/10"
                            : isLoser ? "bg-white/[0.02] opacity-60"
                              : "bg-white/[0.03]"
                        }`}
                      >
                        <span className={`font-bold uppercase ${b.side === "yes" ? "text-emerald-300" : "text-rose-300"}`}>{b.side}</span>
                        <span className="text-zinc-200">{fmtGen(b.amount)}</span>
                        <span className="text-zinc-500">{shorten(b.bettor)}</span>
                        {address && sameAddress(b.bettor, address) && <span className="text-violet-300">you</span>}
                        {isWinner && payout > 0n && (
                          <span className="ml-auto font-semibold text-emerald-300">+{fmtGen(payout)}</span>
                        )}
                        {isLoser && <span className="ml-auto text-zinc-500">lost</span>}
                        {b.claimed && <span className="text-zinc-500">claimed</span>}
                        <span className="text-zinc-600" title={fmtDateTime(b.placed_at)}>
                          {countdown(b.placed_at, now)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold text-white">Actions</h3>
              <div className="mt-3 space-y-2">
                {m.status === "open" && (
                  <Btn className="w-full" onClick={() => setBetOpen(true)}>Place bet</Btn>
                )}
                {m.status === "open" && now >= m.close_time && (
                  <Btn variant="ghost" className="w-full" disabled={busy !== null} onClick={() => address && run("Lock", () => lockMarket(network, address, provider, m.id))}>
                    {busy === "Lock" ? "Locking…" : "Lock market"}
                  </Btn>
                )}
                {m.status === "locked" && now >= m.resolve_time && (
                  <Btn className="w-full" disabled={busy !== null} onClick={() => address && run("AI resolve", () => requestResolution(network, address, provider, m.id))}>
                    {busy === "AI resolve" ? "AI resolving (minutes)…" : "Request AI resolution"}
                  </Btn>
                )}
                {(m.status === "open" || m.status === "locked") && address && sameAddress(m.creator, address) && (
                  <Btn variant="danger" className="w-full" disabled={busy !== null} onClick={() => address && run("Void", () => voidMarket(network, address, provider, m.id))}>
                    Void market
                  </Btn>
                )}
                <Btn variant="ghost" className="w-full" onClick={shareMarket}>
                  {copied ? "Link copied!" : "Share market"}
                </Btn>
              </div>
              {actionErr && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{actionErr}</div>}
              {txMsg && (
                <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  {txMsg.label} ok · <TxHash hash={txMsg.hash} />
                  {txMsg.extra && <div className="mt-1 font-mono">→ {txMsg.extra}</div>}
                </div>
              )}
              {!address && <div className="mt-2 text-xs text-amber-300">Connect a wallet to act.</div>}
            </Card>

            {myBets.length > 0 && (
              <Card>
                <h3 className="font-semibold text-white">Your bets ({myBets.length})</h3>
                <div className="mt-3 space-y-2">
                  {myBets.map((b) => {
                    const isWinner = m.status === "resolved" && m.outcome && b.side === m.outcome;
                    const payout = estPayout(b, m);
                    return (
                      <div key={b.id} className={`rounded-xl p-3 text-xs ${isWinner ? "border border-emerald-500/30 bg-emerald-500/10" : "bg-white/[0.03]"}`}>
                        <div className="flex justify-between font-mono">
                          <span className={`font-bold uppercase ${b.side === "yes" ? "text-emerald-300" : "text-rose-300"}`}>{b.side} · {fmtGen(b.amount)}</span>
                          {isWinner && payout > 0n && <span className="font-semibold text-emerald-300">+{fmtGen(payout)}</span>}
                          {b.claimed && <span className="text-zinc-500">claimed</span>}
                        </div>
                        {!b.claimed && m.status === "resolved" && (
                          <Btn className="mt-2 w-full" disabled={busy !== null} onClick={() => address && run("Claim", () => claimWinnings(network, address, provider, b.id))}>
                            Claim winnings
                          </Btn>
                        )}
                        {!b.claimed && m.status === "voided" && (
                          <Btn className="mt-2 w-full" disabled={busy !== null} onClick={() => address && run("Refund", () => refundVoid(network, address, provider, b.id))}>
                            Refund (voided)
                          </Btn>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {disputeOpen && myBets.length > 0 && (
              <Card>
                <h3 className="font-semibold text-white">Raise dispute</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Window closes {fmtDateTime(m.resolved_at + 86400)} ({countdown(m.resolved_at + 86400, now)} left).
                </p>
                <div className="mt-2 space-y-2">
                  <Field label="Reason">
                    <input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Primary source misread…" className={inputCls} />
                  </Field>
                  <Btn variant="danger" className="w-full" disabled={busy !== null || !disputeReason.trim()} onClick={() => address && run("Dispute", () => raiseDispute(network, address, provider, m.id, disputeReason.trim()))}>
                    Submit dispute
                  </Btn>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      {betOpen && m && (
        <PlaceBetModal market={m} onClose={() => setBetOpen(false)} onPlaced={() => { setBetOpen(false); detail.reload(); }} />
      )}
    </div>
  );
}
