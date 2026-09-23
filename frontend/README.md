# RealityBet Frontend

React + Vite + Tailwind + `genlayer-js` UI for the RealityBet Intelligent Contract.

![RealityBet hero](../docs/images/hero-logo.jpeg)

## Screenshots

| | |
|---|---|
| ![Markets](../docs/images/screenshot-01-18-52.png) | ![Market detail](../docs/images/screenshot-01-20-51.png) |
| ![Place bet](../docs/images/screenshot-01-20-57.png) | ![Odds](../docs/images/screenshot-01-21-05.png) |
| ![My bets](../docs/images/screenshot-01-21-14.png) | ![Resolution](../docs/images/screenshot-01-21-34.png) |
| ![Dispute](../docs/images/screenshot-01-21-39.png) | ![Wallet](../docs/images/screenshot-01-21-47.png) |
| ![Stats](../docs/images/screenshot-01-21-53.png) | ![Admin](../docs/images/screenshot-01-22-13.png) |
| ![Extra view](../docs/images/screenshot-01-22-22.png) | |

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
| `VITE_RPC_URL` | Optional. Absolute RPC endpoint, or `direct` to skip the proxy |
| `VITE_SEED_MARKETS` | Optional. Extra market ids to pin in this browser's registry |

## Wallet

Testnet-oriented: **Connect wallet → Import private key** (e.g. exported from Rabby)
or **New burner**. The key stays in `localStorage` in this browser only.
Fund burner accounts from a funded account (`genlayer account send …`) or a faucet.

## RPC endpoint

Studio's public RPC (`https://studio.genlayer.com/api`) is rate-limited
(~500 req/hour) and returns 429s **without** an `Access-Control-Allow-Origin`
header, so the browser reports quota exhaustion as an opaque *“blocked by CORS
policy”* error. The app avoids both by not calling Studio directly from the
browser:

- production → the `vercel.json` rewrite proxies `/api/rpc` to Studio
- dev → the matching proxy in `vite.config.ts`

`VITE_RPC_URL` overrides this with a full URL, or the literal `direct` to
bypass the proxy.

Reads are batched to stay inside the quota too: the contract enumerates
everything it owns (`get_market_ids`, `get_markets_page`,
`get_market_bets_detailed`, `get_bets_by_bettor`), so a page costs one call
instead of one per market plus one per bet. Successful views are cached for
60s, identical concurrent reads share one in-flight request, and after a 429
the app stops sending requests until the cooldown expires (persisted across
reloads, honoring `Retry-After`).

## Notes / known contract quirks handled in UI

- Markets are enumerated on chain (`get_markets_page`). `localStorage`
  (`realitybet.markets.v3.<network>`) is now only a small per-browser pin list
  for ids added via “Import by id”, plus the optional `VITE_SEED_MARKETS`.
- Bets are enumerated on chain per wallet (`get_bets_by_bettor`), so **My Bets**
  works in any browser for the connected wallet.
- The GenLayer CLI cannot attach GEN to payable calls, but this UI can —
  betting/funding go through `genlayer-js writeContract({ value })`.
- Writes wait for `FINALIZED` consensus (can take minutes for AI resolution);
  contract reverts surface inline as messages, not exceptions.
