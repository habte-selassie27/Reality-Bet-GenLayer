# Submission Notes (Portal copy-paste, <1000 chars)

Title: RealityBet — AI-Resolved Prediction Market

YES/NO market on GenLayer: create markets, bet GEN, LLM-resolve via live web, ≤24h disputes.

Consensus: gl.eq_principle.prompt_comparative — leader fetches resolution_url; validators re-fetch and must match `outcome` exactly. Low confidence voids.

Non-trivial: full lifecycle, TreeMap/DynArray storage, payable pools, 39 tests.

Safety: claims unlock only after the 24h window; no market pays twice. The balance-snapshot recovery gate is REMOVED: GenLayer exposes no delivery-status API for emit_transfer, and a balance can't substitute, since funds that arrive then get spent look like funds that never arrived. So payouts emit at most ONCE, structurally: no recover_*/authorize_* path exists; an entitlement only moves attempted→delivered or →written_off (pays nothing). Cost: a failed transfer is stranded, not double-paid. Tests cover lands+kept, lands+spent, genuine failure, balance sweep; a probe on the old gate reproduced the double pay.