# Submission Notes (Portal copy-paste, <1000 chars)

Title: RealityBet — AI-Resolved Prediction Market

AI-resolved YES/NO prediction market on GenLayer: create markets, bet GEN, lock, LLM-resolve via live web, claim/dispute ≤24h.

Consensus: gl.eq_principle.prompt_comparative — leader fetches resolution_url, returns LLM JSON {outcome,confidence,reason,sources}; validators re-fetch, match `outcome` exactly. Low-confidence/parse-fail auto-voids.

Non-trivial: full lifecycle (open/locked/resolved/finalized/voided/disputed), TreeMap/DynArray storage, payable pools, dispute/re_resolve/force_resolve, 40 tests.

Safety (per review): claims unlock only after the 24h window, no market pays twice. Transfer-safety is evidence-gated, not signature-based: every emit records the payee's on-chain balance baseline + attempt time; only the payee may report non-delivery (after a 1h settle grace); verification is independent (owner or appointed recovery_guardian, never the payee), so an owner-bettor cannot self-report AND self-authorize; and recover_payout re-reads the payee's balance — a delivered transfer reverts recovery with "Delivery observed on-chain" regardless of any authorization. No boolean is treated as proof; each authorization is spent by exactly one emit; confirm_payout permanently locks delivered transfers. Tests establish failure both ways: un-credited balance (genuinely lost) can recover once, credited balance blocks re-emission entirely.
