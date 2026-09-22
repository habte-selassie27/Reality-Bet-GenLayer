# RealityBet — AI-Resolved Prediction Market on GenLayer

Decentralized prediction market where GenLayer validator consensus settles real-world events using live web data. Anyone creates a YES/NO market; bettors fund pools in GEN; AI resolves; winners claim parimutuel payouts.

## How GenLayer consensus is used

Resolution runs inside `gl.eq_principle.prompt_comparative`: the leader fetches `resolution_url` via `gl.nondet.web.get`, prompts the LLM for `{outcome, confidence, reason, sources_checked}`, and validators independently re-fetch + re-run the LLM. The `EqComparative` template accepts only if `outcome` matches exactly. No `strict_eq` on LLM text, no schema-only checks. Low confidence or unparsable output auto-voids to protect bettors. Stored resolution metadata: `resolver_confidence` (high/medium/low) and `resolver_sources` (JSON array) surface in `get_market` for frontend display.

## Payout formula (u256 only)

`gross = bet * total_pool // win_pool`; `fee = gross * fee_bps // 10000`; `net = gross - fee`. Fee → owner via `emit_transfer`; net → winner. VOID → full refund, no fee. Losers get 0.

## Lifecycle

`OPEN → LOCKED → RESOLVED → claims`; `OPEN/LOCKED → VOIDED → refunds`; `RESOLVED → DISPUTED (24h) → RESOLVED` via owner ruling or AI `re_resolve`; `force_resolve` is emergency fallback.

## Example

"Will BTC close above $100k on Dec 31 2025?" (crypto, source: CoinMarketCap). Close `1767139200`, resolve `1767225600`. 6 GEN YES vs 4 GEN NO, outcome YES: 1 GEN YES → gross 1.667, fee 1.5% → net ~1.642 GEN.
