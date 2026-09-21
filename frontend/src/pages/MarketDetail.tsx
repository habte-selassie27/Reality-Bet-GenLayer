import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { OddsBar } from "../components/MarketCard";
import { PlaceBetModal } from "../components/PlaceBetModal";
import { CategoryBadge, OutcomeBadge, StatusBadge } from "../components/StatusBadge";
import { Btn, Card, ErrorBox, Field, inputCls, PageHeader, Spinner, TxHash } from "../components/ui";
import {
  claimWinnings,
  getBet,
  getDispute,
  getMarket,
  getMarketBets,
  getOdds,
  lockMarket,
  raiseDispute,
  refundVoid,
  requestResolution,
  voidMarket,
  type Bet,
  type Dispute,
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
  const [lookupId, setLookupId] = useState("");
  const [lookup, setLookup] = useState<Dispute | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  const detail = useLoader<Detail>(async () => {
    const [market, odds, betIds] = await Promise.all([
      getMarket(network, marketId),
      getOdds(network, marketId),
      getMarketBets(network, marketId),
    ]);
    const bets = await Promise.all(betIds.map((b) => getBet(network, b)));
    return { market, odds, bets };
  }, [network, marketId]);

  // Live refresh every 15s.
  useEffect(() => {
    const t = setInterval(() => detail.reload(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, marketId]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; hash: string; revertReason: string | null; result: unknown }>) {
    if (!address) {
      setActionErr("Connect a wallet first.");
      return;
    }
    setBusy(label);
    setActionErr(null);
    setTxMsg(null);
    try {
      const out = await fn();
      if (!out.ok) {
        setActionErr(out.revertReason ?? `${label} reverted`);
        return;
      }
      setTxMsg({ label, hash: out.hash, extra: out.result !== null && typeof out.result !== "boolean" ? String(out.result) : undefined });
      detail.reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const m = detail.data?.market ?? null;
  const myBets = (detail.data?.bets ?? []).filter((b) => address && sameAddress(b.bettor, address));
  const disputeOpen = m?.status === "resolved" && m.resolved_at > 0 && now <= m.resolved_at + 86400;

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
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{m.description}</p>
              <div className="mt-3 grid gap-2 font-mono text-xs text-zinc-400 sm:grid-cols-2">
                <div>source: <a href={m.resolution_url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">{m.resolution_url}</a></div>
                <div>creator: {shorten(m.creator)}</div>
                <div>closes: {fmtDateTime(m.close_time)} ({countdown(m.close_time, now)})</div>
                <div>resolvable: {fmtDateTime(m.resolve_time)} ({countdown(m.resolve_time, now)})</div>
                {m.resolved_at > 0 && <div>resolved: {fmtDateTime(m.resolved_at)}</div>}
                <div>fee: {(m.fee_bps / 100).toFixed(2)}%</div>
              </div>
              {m.resolver_note && (
                <div className="mt-3 rounded-xl bg-sky-400/10 p-3 text-xs leading-relaxed text-sky-200">
                  <span className="font-semibold">Resolver: </span>{m.resolver_note}
                </div>
              )}
              <OddsBar yesPct={detail.data?.odds.yes ?? 50} />
              <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-zinc-400">
                <span>YES pool: {fmtGen(m.pool_yes)}</span>
                <span>NO pool: {fmtGen(m.pool_no)}</span>
                <span>bets: {detail.data?.bets.length ?? 0}</span>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-white">Bets ({detail.data?.bets.length ?? 0})</h3>
              {(detail.data?.bets.length ?? 0) === 0 ? (
                <div className="mt-2 text-sm text-zinc-500">No bets yet.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {detail.data?.bets.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-3 font-mono text-xs">
                      <span className={`font-bold uppercase ${b.side === "yes" ? "text-emerald-300" : "text-rose-300"}`}>{b.side}</span>
                      <span className="text-zinc-200">{fmtGen(b.amount)}</span>
                      <span className="text-zinc-500">{shorten(b.bettor)}</span>
                      {b.claimed && <span className="text-zinc-500">claimed</span>}
                      {address && sameAddress(b.bettor, address) && <span className="text-violet-300">you</span>}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold text-white">Dispute lookup</h3>
              <div className="mt-2 flex gap-2">
                <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Dispute id (d0-…)" className={`${inputCls} font-mono`} />
                <Btn
                  variant="ghost"
                  onClick={async () => {
                    setLookupErr(null);
                    setLookup(null);
                    try {
                      setLookup(await getDispute(network, lookupId.trim()));
                    } catch (e) {
                      setLookupErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Look up
                </Btn>
              </div>
              {lookupErr && <div className="mt-2 text-xs text-red-300">{lookupErr}</div>}
              {lookup && (
                <div className="mt-2 rounded-xl bg-white/5 p-3 font-mono text-xs text-zinc-300">
                  <div>market: {lookup.market_id}</div>
                  <div>by: {shorten(lookup.raised_by)}</div>
                  <div>reason: {lookup.reason}</div>
                  <div>resolved: {String(lookup.resolved)} · outcome: {lookup.outcome || "—"}</div>
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
                {(m.status === "open" || m.status === "locked") && address &&
                  (sameAddress(m.creator, address)) && (
                  <Btn variant="danger" className="w-full" disabled={busy !== null} onClick={() => address && run("Void", () => voidMarket(network, address, provider, m.id))}>
                    Void market
                  </Btn>
                )}
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
                  {myBets.map((b) => (
                    <div key={b.id} className="rounded-xl bg-white/[0.03] p-3 text-xs">
                      <div className="flex justify-between font-mono">
                        <span className={`font-bold uppercase ${b.side === "yes" ? "text-emerald-300" : "text-rose-300"}`}>{b.side} · {fmtGen(b.amount)}</span>
                        {b.claimed && <span className="text-zinc-500">claimed</span>}
                      </div>
                      {!b.claimed && m.status === "resolved" && (
                        <Btn
                          className="mt-2 w-full"
                          disabled={busy !== null}
                          onClick={() => address && run("Claim", () => claimWinnings(network, address, provider, b.id))}
                        >
                          Claim winnings
                        </Btn>
                      )}
                      {!b.claimed && m.status === "voided" && (
                        <Btn
                          className="mt-2 w-full"
                          disabled={busy !== null}
                          onClick={() => address && run("Refund", () => refundVoid(network, address, provider, b.id))}
                        >
                          Refund (voided)
                        </Btn>
                      )}
                    </div>
                  ))}
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
                  <Btn
                    variant="danger"
                    className="w-full"
                    disabled={busy !== null || !disputeReason.trim()}
                    onClick={() => address && run("Dispute", () => raiseDispute(network, address, provider, m.id, disputeReason.trim()))}
                  >
                    Submit dispute
                  </Btn>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      {betOpen && m && (
        <PlaceBetModal
          market={m}
          onClose={() => setBetOpen(false)}
          onPlaced={() => {
            setBetOpen(false);
            detail.reload();
          }}
        />
      )}
    </div>
  );
}
