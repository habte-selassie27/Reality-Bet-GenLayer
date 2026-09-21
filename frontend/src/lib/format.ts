export const WEI = 10n ** 18n;

/** Parse u256-ish values (bigint | number | numeric string) into bigint. */
export function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) return BigInt(s);
    if (/^-?\d*\.?\d+$/.test(s)) return BigInt(Math.trunc(Number(s)));
  }
  return 0n;
}

export function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}

export function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** 1.5 GEN — trims trailing zeros, max 4 decimals. */
export function fmtGen(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WEI;
  const frac = abs % WEI;
  if (frac === 0n) return `${neg ? "-" : ""}${whole.toString()} GEN`;
  let f = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${f ? "." + f : ""} GEN`;
}

/** "0.1" GEN -> wei. Returns null on invalid input. */
export function parseGen(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const [w = "0", f = ""] = s.split(".");
  const frac = (f + "0".repeat(18)).slice(0, 18);
  try {
    const v = BigInt(w === "" ? "0" : w) * WEI + BigInt(frac);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function fmtDateTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

/** "2h 14m" / "45s" / "closed 3h ago" style countdown. */
export function countdown(targetTs: number, nowSec: number): string {
  const d = targetTs - nowSec;
  const abs = Math.abs(d);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const body = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return d >= 0 ? body : `${body} ago`;
}

export function shorten(addr: string, chars = 4): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
