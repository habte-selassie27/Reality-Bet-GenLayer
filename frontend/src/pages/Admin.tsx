import { useState } from "react";
import { Btn, Card, EmptyState, ErrorBox, Field, inputCls, PageHeader, Spinner, TxHash } from "../components/ui";
import {
  forceResolve,
  getDispute,
  getPlatformStats,
  reResolve,
  resolveDispute,
  setFee,
  transferOwnership,
} from "../lib/contract";
import { fmtGen, shorten } from "../lib/format";
import { useLoader } from "../lib/hooks";
import { isOwnerAddress, useOwner } from "../lib/owner";
import { useWallet } from "../lib/wallet";

export function Admin() {
  const { network, address, provider } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const [feeBps, setFeeBps] = useState("150");
  const [frMarket, setFrMarket] = useState("");
  const [frOutcome, setFrOutcome] = useState("yes");
  const [frNote, setFrNote] = useState("");
  const [rdId, setRdId] = useState("");
  const [rdUpheld, setRdUpheld] = useState(true);
  const [rdOutcome, setRdOutcome] = useState("no");
  const [rdNote, setRdNote] = useState("");
  const [rrMarket, setRrMarket] = useState("");
  const [toAddr, setToAddr] = useState("");
  const [disputeView, setDisputeView] = useState("");

  const stats = useLoader(() => getPlatformStats(network), [network]);
  const { owner, loading: ownerLoading } = useOwner(network);
  // Owner is resolved on-chain. The page stays hidden for everyone else;
  // even if bypassed, the contract reverts non-owner admin writes.
  const isOwner = isOwnerAddress(owner, address);

  if (ownerLoading) {
    return (
      <div>
        <PageHeader title="Admin" sub="Owner-only area." />
        <Spinner label="Checking owner…" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Admin" sub="Owner-only area." />
        <EmptyState
          title="Restricted"
          hint="This page is only visible to the contract owner wallet. Connect the owner wallet to access admin controls."
        />
      </div>
    );
  }

  async function run(label: string, fn: () => Promise<{ ok: boolean; hash: string; revertReason: string | null; result: unknown }>) {
    if (!address) {
      setMsg({ ok: false, text: "Connect the owner wallet first." });
      return;
    }
    setBusy(label);
    setMsg(null);
    try {
      const out = await fn();
      if (!out.ok) {
        setMsg({ ok: false, text: out.revertReason ?? `${label} reverted`, hash: out.hash });
      } else {
        setMsg({ ok: true, text: `${label} succeeded`, hash: out.hash });
        stats.reload();
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Admin" sub="Owner-only controls. Connect the contract owner wallet to use them." />
      {stats.loading ? (
        <Spinner />
      ) : stats.error ? (
        <ErrorBox message={stats.error} onRetry={stats.reload} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card><div className="text-xs uppercase tracking-wide text-zinc-500">Owner</div><div className="mt-1 font-mono text-sm text-white">{shorten(stats.data?.owner ?? "")}</div></Card>
          <Card><div className="text-xs uppercase tracking-wide text-zinc-500">Markets</div><div className="mt-1 text-xl font-bold text-white">{stats.data?.total_markets}</div></Card>
          <Card><div className="text-xs uppercase tracking-wide text-zinc-500">Volume</div><div className="mt-1 text-xl font-bold text-white">{fmtGen(stats.data?.total_volume ?? 0n)}</div></Card>
          <Card><div className="text-xs uppercase tracking-wide text-zinc-500">Fee</div><div className="mt-1 text-xl font-bold text-white">{((stats.data?.fee_bps ?? 0) / 100).toFixed(2)}%</div></Card>
        </div>
      )}

      {msg && (
        <div className={`mt-4 rounded-xl border p-3 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
          {msg.text} {msg.hash && <>· <TxHash hash={msg.hash} /></>}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold text-white">Platform fee (bps)</h3>
          <div className="mt-2 flex gap-2">
            <input value={feeBps} onChange={(e) => setFeeBps(e.target.value)} inputMode="numeric" className={inputCls} />
            <Btn disabled={!isOwner || busy !== null} onClick={() => address && run("Set fee", () => setFee(network, address, provider, Number(feeBps)))}>
              {busy === "Set fee" ? "…" : "Set"}
            </Btn>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Max 500 (5%). Applies to markets created after the change.</p>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Force resolve</h3>
          <p className="mt-1 text-xs text-zinc-500">Emergency override for LOCKED or DISPUTED markets.</p>
          <div className="mt-2 space-y-2">
            <Field label="Market id"><input value={frMarket} onChange={(e) => setFrMarket(e.target.value)} className={`${inputCls} font-mono`} /></Field>
            <div className="flex gap-2">
              <select value={frOutcome} onChange={(e) => setFrOutcome(e.target.value)} className={inputCls}>
                <option value="yes">yes</option>
                <option value="no">no</option>
                <option value="void">void</option>
              </select>
              <input value={frNote} onChange={(e) => setFrNote(e.target.value)} placeholder="Note" className={inputCls} />
              <Btn disabled={!isOwner || busy !== null || !frMarket.trim()} onClick={() => address && run("Force resolve", () => forceResolve(network, address, provider, frMarket.trim(), frOutcome, frNote))}>
                {busy === "Force resolve" ? "…" : "Go"}
              </Btn>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Resolve dispute</h3>
          <div className="mt-2 space-y-2">
            <Field label="Dispute id"><input value={rdId} onChange={(e) => setRdId(e.target.value)} className={`${inputCls} font-mono`} /></Field>
            <div className="flex flex-wrap gap-2">
              <select value={rdUpheld ? "upheld" : "rejected"} onChange={(e) => setRdUpheld(e.target.value === "upheld")} className={inputCls}>
                <option value="upheld">upheld</option>
                <option value="rejected">rejected</option>
              </select>
              <select value={rdOutcome} onChange={(e) => setRdOutcome(e.target.value)} className={inputCls}>
                <option value="yes">yes</option>
                <option value="no">no</option>
                <option value="void">void</option>
              </select>
              <input value={rdNote} onChange={(e) => setRdNote(e.target.value)} placeholder="Note" className={inputCls} />
              <Btn
                disabled={!isOwner || busy !== null || !rdId.trim()}
                onClick={() => address && run("Resolve dispute", () => resolveDispute(network, address, provider, rdId.trim(), rdUpheld, rdOutcome, rdNote))}
              >
                {busy === "Resolve dispute" ? "…" : "Go"}
              </Btn>
            </div>
            <div className="flex gap-2">
              <input value={disputeView} onChange={(e) => setDisputeView(e.target.value)} placeholder="View dispute d0-…" className={`${inputCls} font-mono`} />
              <Btn
                variant="ghost"
                onClick={async () => {
                  setMsg(null);
                  try {
                    const d = await getDispute(network, disputeView.trim());
                    setMsg({ ok: true, text: `${d.id} · market ${d.market_id} · by ${shorten(d.raised_by)} · ${d.reason} · resolved=${String(d.resolved)} outcome=${d.outcome || "—"}` });
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                View
              </Btn>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Re-run AI resolution</h3>
          <p className="mt-1 text-xs text-zinc-500">For DISPUTED markets — validators re-fetch and re-vote.</p>
          <div className="mt-2 flex gap-2">
            <input value={rrMarket} onChange={(e) => setRrMarket(e.target.value)} placeholder="Market id" className={`${inputCls} font-mono`} />
            <Btn disabled={!isOwner || busy !== null || !rrMarket.trim()} onClick={() => address && run("Re-resolve", () => reResolve(network, address, provider, rrMarket.trim()))}>
              {busy === "Re-resolve" ? "AI working…" : "Go"}
            </Btn>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-red-300">Transfer ownership</h3>
          <p className="mt-1 text-xs text-zinc-500">Irreversible. Double-check the address.</p>
          <div className="mt-2 flex gap-2">
            <input value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="0x…" className={`${inputCls} font-mono`} />
            <Btn
              variant="danger"
              disabled={!isOwner || busy !== null || !/^0x[0-9a-fA-F]{40}$/.test(toAddr.trim())}
              onClick={() => {
                if (address && window.confirm(`Transfer ownership to ${toAddr.trim()}?`)) {
                  run("Transfer", () => transferOwnership(network, address, provider, toAddr.trim()));
                }
              }}
            >
              Transfer
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
