import { useState } from "react";
import { Link } from "react-router-dom";
import { MarketCard } from "../components/MarketCard";
import { EmptyState, ErrorBox, inputCls, PageHeader, Spinner } from "../components/ui";
import { getMarket, type Market } from "../lib/contract";
import { useLoader } from "../lib/hooks";
import { addMarket, listMarkets } from "../lib/market-registry";
import { useWallet } from "../lib/wallet";

export function Markets() {
  const { network } = useWallet();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [importId, setImportId] = useState("");
  const [showImport, setShowImport] = useState(false);
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
        sub="Browse and search prediction markets"
        action={<Link to="/create" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">+ New market</Link>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none">
          {["all", "open", "locked", "resolved", "disputed", "voided"].map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search markets…" className={`${inputCls} max-w-xs`} />
        <button
          onClick={() => setShowImport(!showImport)}
          className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-300"
        >
          {showImport ? "Hide import" : "Import by ID"}
        </button>
      </div>

      {showImport && (
        <div className="mb-5 flex gap-2">
          <input
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            placeholder="Enter market ID (e.g. m0-1234567890)"
            className={`${inputCls} max-w-xs font-mono`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && importId.trim()) {
                addMarket(network, importId.trim());
                setImportId("");
                refreshIds();
              }
            }}
          />
          <button
            onClick={() => {
              if (importId.trim()) {
                addMarket(network, importId.trim());
                setImportId("");
                refreshIds();
              }
            }}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Import
          </button>
        </div>
      )}

      {markets.loading ? (
        <Spinner label="Loading markets…" />
      ) : markets.error ? (
        <ErrorBox message={markets.error} onRetry={markets.reload} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No markets found"
          hint={ids.length === 0 ? "Create a market or import one by ID to get started." : "Try a different filter or search term."}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((m) =>
            (m as Market & { _missing?: boolean })._missing ? (
              <div key={m.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="font-mono text-sm text-zinc-400">{m.id}</div>
                <div className="mt-1 text-xs text-zinc-500">Market not found on this network.</div>
              </div>
            ) : (
              <MarketCard key={m.id} market={m as Market} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
