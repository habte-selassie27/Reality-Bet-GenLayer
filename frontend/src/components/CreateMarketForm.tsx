import { useState } from "react";
import { createMarket } from "../lib/contract";
import { addMarket } from "../lib/market-registry";
import { useWallet } from "../lib/wallet";
import { Btn, Field, inputCls, TxHash } from "./ui";

const CATEGORIES = ["crypto", "sports", "politics", "tech", "science", "custom"];

function toUnix(dtLocal: string): number | null {
  const ms = new Date(dtLocal).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function defaultClose(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return toLocal(d);
}
function defaultResolve(): string {
  const d = new Date(Date.now() + 48 * 3600 * 1000);
  return toLocal(d);
}
function toLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CreateMarketForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { network, address, provider } = useWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("https://");
  const [category, setCategory] = useState("crypto");
  const [close, setClose] = useState(defaultClose);
  const [resolve, setResolve] = useState(defaultResolve);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; tx: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    const closeTs = toUnix(close);
    const resolveTs = toUnix(resolve);
    if (closeTs === null || resolveTs === null) {
      setError("Invalid close / resolve time.");
      return;
    }
    if (resolveTs < closeTs) {
      setError("Resolve time must be at or after close time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await createMarket(network, address, provider, {
        title: title.trim(),
        description: description.trim(),
        resolution_url: url.trim(),
        category,
        close_time: closeTs,
        resolve_time: resolveTs,
      });
      if (!out.ok) {
        setError(out.revertReason ?? "Create reverted");
        return;
      }
      const id = String(out.result ?? "");
      addMarket(network, id);
      setCreated({ id, tx: out.hash });
      setTitle("");
      setDescription("");
      setUrl("https://");
      setCategory("crypto");
      setClose(defaultClose());
      setResolve(defaultResolve());
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Question">
        <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Will BTC close above $100k on Dec 31?" className={inputCls} />
      </Field>
      <Field label="Description / resolution criteria">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} placeholder="Resolves YES if…" className={inputCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary source URL (AI checks this)">
          <input value={url} onChange={(e) => setUrl(e.target.value)} required type="url" className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Betting closes">
          <input type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Earliest resolution">
          <input type="datetime-local" value={resolve} onChange={(e) => setResolve(e.target.value)} required className={inputCls} />
        </Field>
      </div>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}
      {created && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          Market created: <span className="font-mono">{created.id}</span> · tx <TxHash hash={created.tx} />
        </div>
      )}
      <Btn type="submit" disabled={!address || busy || !title.trim()}>
        {busy ? "Waiting for consensus…" : "Create market"}
      </Btn>
      {!address && <div className="text-xs text-amber-300">Connect a wallet to create markets.</div>}
    </form>
  );
}
