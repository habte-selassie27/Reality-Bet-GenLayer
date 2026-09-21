import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>{children}</div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-zinc-400">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
      <div className="font-medium">Something went wrong</div>
      <div className="mt-1 break-words opacity-90">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs hover:bg-red-500/20">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
      <div className="text-base font-medium text-zinc-200">{title}</div>
      {hint && <div className="mx-auto mt-2 max-w-md text-sm text-zinc-400">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger" | "success";
  type?: "button" | "submit";
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-violet-600 hover:bg-violet-500 text-white"
      : variant === "success"
        ? "bg-emerald-600 hover:bg-emerald-500 text-white"
        : variant === "danger"
          ? "bg-red-600/80 hover:bg-red-500/80 text-white"
          : "border border-white/15 hover:bg-white/10 text-zinc-200";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/60";

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function TxHash({ hash }: { hash: string }) {
  return (
    <span title={hash} className="font-mono text-xs text-violet-300">
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </span>
  );
}
