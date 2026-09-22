const STATUS_STYLES: Record<string, string> = {
  open: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  locked: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  resolved: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  voided: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
  disputed: "border-red-400/30 bg-red-400/10 text-red-300",
};

const OUTCOME_STYLES: Record<string, string> = {
  yes: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  no: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  void: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES["voided"];
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${cls}`}>
      {status || "?"}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (!outcome) return null;
  const cls = OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES["void"];
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${cls}`}>
      {outcome}
    </span>
  );
}

export function CategoryBadge({ categories }: { categories: string[] }) {
  const list = categories.length > 0 ? categories : ["custom"];
  return (
    <>
      {list.map((c) => (
        <span
          key={c}
          className="inline-block rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-zinc-300"
        >
          {c}
        </span>
      ))}
    </>
  );
}
