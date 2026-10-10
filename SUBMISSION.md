# Submission Notes (Portal copy-paste, <1000 chars)

Title: RealityBet — AI-Resolved Prediction Market

AI-resolved YES/NO prediction market on GenLayer: create markets, bet GEN, lock, LLM-resolve via live web, claim/dispute ≤24h.

Consensus: gl.eq_principle.prompt_comparative — leader fetches resolution_url, returns LLM JSON {outcome,confidence,reason,sources}; validators re-fetch, match `outcome` exactly. Low-confidence/parse-fail auto-voids.

Non-trivial: full lifecycle (open/locked/resolved/finalized/voided/disputed), TreeMap/DynArray storage, payable pools, dispute/re_resolve/force_resolve, 36 tests.

Safety (per review): claims unlock only after the 24h window, no market pays twice. Recovery is two-party: `report_failed_payout` only requests — moves no money; owner must independently verify non-delivery and `authorize_recovery` on-chain; each authorization is spent by one `recover_payout`/`recover_refund`/`recover_funding_refund` emit; `confirm_payout` locks delivered transfers. Self-reported failure never mints a second payout.
