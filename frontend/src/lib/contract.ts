import type { NetworkKey } from "./chains";
import { toBigInt, toBool, toNumber, toStr } from "./format";
import {
  contractAddress,
  decode,
  getClient,
  guardRateLimit,
  noteFailurePublic,
  sendWrite,
  viewCacheGet,
  viewCacheSet,
  type TxOutcome,
} from "./genlayer";

export interface Market {
  id: string;
  creator: string;
  title: string;
  description: string;
  resolution_url: string;
  category: string;
  categories: string[];
  close_time: number;
  resolve_time: number;
  outcome: string;
  status: string;
  pool_yes: bigint;
  pool_no: bigint;
  fee_bps: number;
  resolved_at: number;
  resolver_note: string;
  resolver_confidence: string;
  resolver_sources: string;
}

export interface Bet {
  id: string;
  market_id: string;
  bettor: string;
  side: string;
  amount: bigint;
  claimed: boolean;
  placed_at: number;
}

export interface Dispute {
  id: string;
  market_id: string;
  raised_by: string;
  reason: string;
  resolved: boolean;
  outcome: string;
}

export interface Odds {
  yes: number;
  no: number;
  pool_yes: bigint;
  pool_no: bigint;
  total_pool: bigint;
}

export interface MarketStats {
  market_id: string;
  title: string;
  status: string;
  outcome: string;
  pool_yes: bigint;
  pool_no: bigint;
  total_bets: number;
  yes_bets: number;
  no_bets: number;
  resolver_note: string;
}

export interface PlatformStats {
  total_markets: number;
  total_volume: bigint;
  fee_bps: number;
  owner: string;
}

async function view<T>(network: NetworkKey, method: string, args: unknown[] = []): Promise<T> {
  guardRateLimit(); // fail fast while the rate-limit cooldown is active

  const cached = viewCacheGet<T>(network, method, args);
  if (cached !== null) return cached;

  const client = getClient(network);
  try {
    const raw = await client.readContract({
      address: contractAddress() as `0x${string}`,
      functionName: method,
      args: args as never[],
    });
    viewCacheSet(network, method, args, raw);
    return decode<T>(raw);
  } catch (err) {
    noteFailurePublic(err); // engages rate-limit cooldown on 429 bursts
    throw err;
  }
}

function normMarket(m: Record<string, unknown>): Market {
  return {
    id: toStr(m["id"]),
    creator: toStr(m["creator"]),
    title: toStr(m["title"]),
    description: toStr(m["description"]),
    resolution_url: toStr(m["resolution_url"]),
    category: toStr(m["category"]),
    categories: Array.isArray(m["categories"])
      ? (m["categories"] as unknown[]).map(toStr)
      : toStr(m["category"])
        ? [toStr(m["category"])]
        : [],
    close_time: toNumber(m["close_time"]),
    resolve_time: toNumber(m["resolve_time"]),
    outcome: toStr(m["outcome"]),
    status: toStr(m["status"]),
    pool_yes: toBigInt(m["pool_yes"]),
    pool_no: toBigInt(m["pool_no"]),
    fee_bps: toNumber(m["fee_bps"]),
    resolved_at: toNumber(m["resolved_at"]),
    resolver_note: toStr(m["resolver_note"]),
    resolver_confidence: toStr(m["resolver_confidence"]),
    resolver_sources: toStr(m["resolver_sources"]),
  };
}

function normBet(b: Record<string, unknown>): Bet {
  return {
    id: toStr(b["id"]),
    market_id: toStr(b["market_id"]),
    bettor: toStr(b["bettor"]),
    side: toStr(b["side"]),
    amount: toBigInt(b["amount"]),
    claimed: toBool(b["claimed"]),
    placed_at: toNumber(b["placed_at"]),
  };
}

function normDispute(d: Record<string, unknown>): Dispute {
  return {
    id: toStr(d["id"]),
    market_id: toStr(d["market_id"]),
    raised_by: toStr(d["raised_by"]),
    reason: toStr(d["reason"]),
    resolved: toBool(d["resolved"]),
    outcome: toStr(d["outcome"]),
  };
}

// ── Views ──────────────────────────────────────────────────────

export async function getMarket(network: NetworkKey, marketId: string): Promise<Market> {
  return normMarket(await view<Record<string, unknown>>(network, "get_market", [marketId]));
}

export async function getBet(network: NetworkKey, betId: string): Promise<Bet> {
  return normBet(await view<Record<string, unknown>>(network, "get_bet", [betId]));
}

export async function getDispute(network: NetworkKey, disputeId: string): Promise<Dispute> {
  return normDispute(await view<Record<string, unknown>>(network, "get_dispute", [disputeId]));
}

export async function getMarketBets(network: NetworkKey, marketId: string): Promise<string[]> {
  const list = await view<unknown[]>(network, "get_market_bets", [marketId]);
  return (Array.isArray(list) ? list : []).map(toStr);
}

export async function getOdds(network: NetworkKey, marketId: string): Promise<Odds> {
  const o = await view<Record<string, unknown>>(network, "get_odds", [marketId]);
  return {
    yes: toNumber(o["yes"]),
    no: toNumber(o["no"]),
    pool_yes: toBigInt(o["pool_yes"]),
    pool_no: toBigInt(o["pool_no"]),
    total_pool: toBigInt(o["total_pool"]),
  };
}

export async function getMarketStats(network: NetworkKey, marketId: string): Promise<MarketStats> {
  const s = await view<Record<string, unknown>>(network, "get_market_stats", [marketId]);
  return {
    market_id: toStr(s["market_id"]),
    title: toStr(s["title"]),
    status: toStr(s["status"]),
    outcome: toStr(s["outcome"]),
    pool_yes: toBigInt(s["pool_yes"]),
    pool_no: toBigInt(s["pool_no"]),
    total_bets: toNumber(s["total_bets"]),
    yes_bets: toNumber(s["yes_bets"]),
    no_bets: toNumber(s["no_bets"]),
    resolver_note: toStr(s["resolver_note"]),
  };
}

export async function getPlatformStats(network: NetworkKey): Promise<PlatformStats> {
  const s = await view<Record<string, unknown>>(network, "get_platform_stats", []);
  return {
    total_markets: toNumber(s["total_markets"]),
    total_volume: toBigInt(s["total_volume"]),
    fee_bps: toNumber(s["fee_bps"]),
    owner: toStr(s["owner"]),
  };
}

// ── Writes (all return TxOutcome; reverts surface as ok:false) ──

function write<T>(
  network: NetworkKey,
  address: string,
  provider: any,
  method: string,
  args: unknown[] = [],
  value = 0n,
): Promise<TxOutcome<T>> {
  return sendWrite<T>({ network, address, provider, method, args, value });
}

export const createMarket = (
  network: NetworkKey,
  address: string,
  provider: any,
  p: { title: string; description: string; resolution_url: string; categories: string[]; close_time: number; resolve_time: number },
) => write<string>(network, address, provider, "create_market", [p.title, p.description, p.resolution_url, p.categories, p.close_time, p.resolve_time]);

export const lockMarket = (network: NetworkKey, address: string, provider: any, marketId: string) =>
  write<boolean>(network, address, provider, "lock_market", [marketId]);

export const voidMarket = (network: NetworkKey, address: string, provider: any, marketId: string) =>
  write<boolean>(network, address, provider, "void_market", [marketId]);

export const fundMarket = (network: NetworkKey, address: string, provider: any, marketId: string, valueWei: bigint) =>
  write<boolean>(network, address, provider, "fund_market", [marketId], valueWei);

export const placeBet = (network: NetworkKey, address: string, provider: any, marketId: string, side: string, valueWei: bigint) =>
  write<string>(network, address, provider, "place_bet", [marketId, side], valueWei);

/** Returns payout in wei (as decoded string/number). */
export const claimWinnings = (network: NetworkKey, address: string, provider: any, betId: string) =>
  write<string | number>(network, address, provider, "claim_winnings", [betId]);

export const refundVoid = (network: NetworkKey, address: string, provider: any, betId: string) =>
  write<boolean>(network, address, provider, "refund_void", [betId]);

export const requestResolution = (network: NetworkKey, address: string, provider: any, marketId: string) =>
  write<boolean>(network, address, provider, "request_resolution", [marketId]);

export const forceResolve = (network: NetworkKey, address: string, provider: any, marketId: string, outcome: string, note: string) =>
  write<boolean>(network, address, provider, "force_resolve", [marketId, outcome, note]);

export const raiseDispute = (network: NetworkKey, address: string, provider: any, marketId: string, reason: string) =>
  write<string>(network, address, provider, "raise_dispute", [marketId, reason]);

export const resolveDispute = (
  network: NetworkKey,
  address: string,
  provider: any,
  disputeId: string,
  upheld: boolean,
  newOutcome: string,
  note: string,
) => write<boolean>(network, address, provider, "resolve_dispute", [disputeId, upheld, newOutcome, note]);

export const reResolve = (network: NetworkKey, address: string, provider: any, marketId: string) =>
  write<boolean>(network, address, provider, "re_resolve", [marketId]);

export const setFee = (network: NetworkKey, address: string, provider: any, bps: number) =>
  write<boolean>(network, address, provider, "set_fee", [bps]);

export const transferOwnership = (network: NetworkKey, address: string, provider: any, newOwner: string) =>
  write<boolean>(network, address, provider, "transfer_ownership", [newOwner]);
