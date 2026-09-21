import { useState } from "react";
import { Link } from "react-router-dom";
import { MarketCard } from "../components/MarketCard";
import { Btn, EmptyState, ErrorBox, Field, inputCls, PageHeader, Spinner } from "../components/ui";
import { getMarket, type Market } from "../lib/contract";
import { useLoader } from "../lib/hooks";
import { addMarket, listMarkets, removeMarket } from "../lib/market-registry";
import { useWallet } from "../lib/wallet";

export function Markets() {
  const { network } = useWallet();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [importId, setImportId] = useState("");
  const [ids, setIds] = useState<string[]>(() => listMarkets(network));

  const markets = useLoader(async () => {
    const results = await Promise.allSettled(ids.map((id) => getMarket(network, id)));
    return results.flatMap((r, i) => {
      if (r.status === "fulfilled") return [{ ...r.value, _missing: false }];
      return [{ id: ids[i], _missing: true } as unknown as Market & { _missing: boolean }];
    });
  }, [network, ids]);

  function refreshIds() {
    setIds(listMarkets(network));
  }

  const visible = (markets.data ?? []).filter((m) => {
    if (statusFilter !== "all" && (m as Market).status !== statusFilter) return false;
    if (query && !`${m.id} ${(m as Market).title ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Markets"
        sub="Tracked markets on this network. The contract has no on-chain list, so the app keeps a local registry."
        action={<Link to="/create" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">+ New market</Link>}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <input value={importId} onChange={(e) => setImportId(e.target.value)} placeholder="Import market by id (m0-…)" className={`${inputCls} max-w-xs font-mono`} />
        <Btn
          variant="ghost"
          onClick={() => {
            if (importId.trim()) {
              addMarket(network, importId.trim());
              setImportId("");
              refreshIds();
            }
          }}
        >
          Import
        </Btn>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none">
          {["all", "open", "locked", "resolved", "disputed", "voided"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className={`${inputCls} max-w-xs`} />
      </div>

      {markets.loading ? (
        <Spinner label="Loading markets…" />
      ) : markets.error ? (
        <ErrorBox message={markets.error} onRetry={markets.reload} />
      ) : visible.length === 0 ? (
        <EmptyState title="No markets match" hint="Adjust the filter or import a market id." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((m) =>
            (m as Market & { _missing?: boolean })._missing ? (
              <div key={m.id} className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                <div className="font-mono text-sm text-red-200">{m.id}</div>
                <div className="mt-1 text-xs text-zinc-400">Not found on this network.</div>
                <button
                  onClick={() => {
                    removeMarket(network, m.id);
                    refreshIds();
                  }}
                  className="mt-3 text-xs text-zinc-400 underline hover:text-zinc-200"
                >
                  Remove from registry
                </button>
              </div>
            ) : (
              <MarketCard key={m.id} market={m as Market} />
            ),
          )}
        </div>
      )}
      <div className="mt-6">
        <Field label="Registry (this browser, this network)">
          <div className="font-mono text-xs break-all text-zinc-500">{ids.join(", ") || "empty"}</div>
        </Field>
      </div>
    </div>
  );
}
