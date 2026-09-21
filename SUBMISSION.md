# Submission Notes (Portal copy-paste, <1000 chars)

Title: RealityBet — AI-Resolved Prediction Market

Decentralized YES/NO prediction market settled by GenLayer validator consensus over live web data. Create markets, bet GEN, lock, AI-resolve, claim or dispute within 24h.

Consensus: resolver uses gl.eq_principle.prompt_comparative — leader fetches resolution_url + LLM JSON {outcome,confidence,reason,sources}; validators re-fetch/re-run and match `outcome` exactly via EqComparative template. No strict_eq on LLM text, no schema-only validation. Low-confidence/parse-fail auto-voids; payouts are parimutuel u256 math with fee split via emit_transfer.

Non-trivial: full lifecycle (open/locked/resolved/voided/disputed), TreeMap/DynArray storage, payable pools, dispute + re_resolve + force_resolve, defensive LLM parsing, 11 direct tests with mocked web/LLM, lint-clean.
