# RealityBet Frontend

React + Vite + Tailwind + `genlayer-js` UI for the RealityBet Intelligent Contract.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
npm run preview    # serve dist/
```

Config lives in `.env` (see `.env.example`):

| Var | Meaning |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Deployed RealityBet contract |
| `VITE_NETWORK` | `studionet` \| `testnetAsimov` \| `testnetBradbury` \| `localnet` |
| `VITE_SEED_MARKETS` | Comma-separated market ids shown on first load |

## Wallet

Testnet-oriented: **Connect wallet → Import private key** (e.g. exported from Rabby)
or **New burner**. The key stays in `localStorage` in this browser only.
Fund burner accounts from a funded account (`genlayer account send …`) or a faucet.

## Notes / known contract quirks handled in UI

- The contract has **no on-chain market list** — the app keeps a per-network
  registry in `localStorage` (seeded from `VITE_SEED_MARKETS`, plus “Import by id”).
- `get_bettor_bets` currently **traps on-chain**, so **My Bets** enumerates
  tracked markets (`get_market_bets` → `get_bet` → filter by bettor) instead.
- The GenLayer CLI cannot attach GEN to payable calls, but this UI can —
  betting/funding go through `genlayer-js writeContract({ value })`.
- Writes wait for `FINALIZED` consensus (can take minutes for AI resolution);
  contract reverts surface inline as messages, not exceptions.
