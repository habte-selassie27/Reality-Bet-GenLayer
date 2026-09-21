# RealityBet — Intelligent GenLayer Contract
> **Target:** ≤ 500 lines of Python-style GenLayer Intelligent Contract  
> **Chain:** GenLayer Testnet (Ethereum-compatible + LLM execution layer)  
> **Purpose:** Decentralized prediction market where AI agents create, resolve, and audit real-world event bets using live web data

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        RealityBet Platform                       │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │  MarketAgent  │  │  BettorAgent  │  │   ResolverAgent      │ │
│  │               │  │               │  │  (LLM + Web Search)  │ │
│  │ Create/Manage │  │ Place/Claim   │  │  Fetch → Evaluate →  │ │
│  │    Markets    │  │     Bets      │  │   Consensus Vote     │ │
│  └──────┬────────┘  └──────┬────────┘  └──────────┬───────────┘ │
│         │                  │                       │             │
│         └──────────────────┴───────────────────────┘            │
│                        GenLayer IPC + LLM                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    AuditAgent                            │    │
│  │     Dispute detection · Resolution appeals · Slashing   │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### Agent Roles

| Agent | Responsibility |
|---|---|
| **MarketAgent** | Creates prediction markets, sets resolution criteria, manages lifecycle |
| **BettorAgent** | Places bets, claims winnings, requests early exits |
| **ResolverAgent** | AI-powered resolution — fetches real-world data, evaluates outcome, builds consensus |
| **AuditAgent** | Handles disputes, appeals, bad-resolver detection, slashing |

---

## File Structure

```
realitybet/
├── agents.md                  ← this file
├── contracts/
│   └── RealityBet.py          ← single Intelligent Contract (≤ 500 lines)
├── tests/
│   ├── test_market.py
│   ├── test_bettor.py
│   ├── test_resolver.py
│   └── test_audit.py
├── scripts/
│   ├── deploy.py
│   └── seed_markets.py
└── README.md
```

---

## The Contract — `contracts/RealityBet.py`

```python
# ============================================================
#  RealityBet Intelligent Contract  |  GenLayer
#  Lines: ~500  |  LLM calls: resolver agent only
#  Model: claude-sonnet-4-6 via GenLayer exec_prompt
# ============================================================
from genlayer import *
import json, hashlib

# ── Enums ────────────────────────────────────────────────────
class MarketStatus:
    OPEN     = "open"       # accepting bets
    LOCKED   = "locked"     # betting closed, awaiting resolution
    RESOLVED = "resolved"   # outcome finalized
    VOIDED   = "voided"     # cancelled — all bets refunded
    DISPUTED = "disputed"   # resolution under appeal

class Outcome:
    YES      = "yes"
    NO       = "no"
    VOID     = "void"       # insufficient data / ambiguous

class Category:
    SPORTS   = "sports"
    POLITICS = "politics"
    CRYPTO   = "crypto"
    TECH     = "tech"
    SCIENCE  = "science"
    CUSTOM   = "custom"

# ── Storage Types ─────────────────────────────────────────────
@dataclass
class Market:
    id:             str
    creator:        Address
    title:          str
    description:    str
    resolution_url: str      # primary data source URL for AI to check
    category:       str
    close_time:     u256     # unix ts — betting closes
    resolve_time:   u256     # unix ts — earliest resolution attempt
    outcome:        str      # YES | NO | VOID | ""
    status:         str
    pool_yes:       u256     # total wei bet YES
    pool_no:        u256     # total wei bet NO
    fee_bps:        u256     # platform fee basis points
    resolved_at:    u256
    resolver_note:  str      # AI explanation of resolution

@dataclass
class Bet:
    id:          str
    market_id:   str
    bettor:      Address
    side:        str         # YES | NO
    amount:      u256
    claimed:     bool
    placed_at:   u256

@dataclass
class Dispute:
    id:          str
    market_id:   str
    raised_by:   Address
    reason:      str
    resolved:    bool
    outcome:     str         # upheld | rejected

# ── Main Contract ─────────────────────────────────────────────
@gl.contract
class RealityBet:

    markets:          dict[str, Market]
    bets:             dict[str, Bet]
    disputes:         dict[str, Dispute]
    market_bets:      dict[str, list[str]]   # market_id → [bet_ids]
    bettor_bets:      dict[str, list[str]]   # address   → [bet_ids]
    owner:            Address
    platform_fee_bps: u256                   # default fee (e.g. 150 = 1.5%)
    total_volume:     u256

    # ── Constructor ──────────────────────────────────────────
    def __init__(self):
        self.markets          = {}
        self.bets             = {}
        self.disputes         = {}
        self.market_bets      = {}
        self.bettor_bets      = {}
        self.owner            = gl.message.sender
        self.platform_fee_bps = 150   # 1.5% default
        self.total_volume     = 0

    # ════════════════════════════════════════════════════════
    #  MARKET AGENT — Lifecycle Management
    # ════════════════════════════════════════════════════════

    @gl.public.write
    def create_market(
        self,
        title:          str,
        description:    str,
        resolution_url: str,
        category:       str,
        close_time:     u256,
        resolve_time:   u256,
    ) -> str:
        assert close_time > gl.block.timestamp,   "Close time must be future"
        assert resolve_time >= close_time,         "Resolve after close"
        assert category in [
            Category.SPORTS, Category.POLITICS, Category.CRYPTO,
            Category.TECH,   Category.SCIENCE,  Category.CUSTOM
        ], "Invalid category"

        mid = self._hash(f"{gl.message.sender}{title}{gl.block.timestamp}")

        self.markets[mid] = Market(
            id             = mid,
            creator        = gl.message.sender,
            title          = title,
            description    = description,
            resolution_url = resolution_url,
            category       = category,
            close_time     = close_time,
            resolve_time   = resolve_time,
            outcome        = "",
            status         = MarketStatus.OPEN,
            pool_yes       = 0,
            pool_no        = 0,
            fee_bps        = self.platform_fee_bps,
            resolved_at    = 0,
            resolver_note  = "",
        )
        self.market_bets[mid] = []
        return mid

    @gl.public.write
    def lock_market(self, market_id: str) -> bool:
        """Anyone can lock a market after close_time passes"""
        m = self._get_market(market_id)
        assert gl.block.timestamp >= m.close_time, "Market not closed yet"
        assert m.status == MarketStatus.OPEN,      "Market not open"
        m.status = MarketStatus.LOCKED
        self.markets[market_id] = m
        return True

    @gl.public.write
    def void_market(self, market_id: str) -> bool:
        """Creator or owner can void before resolution"""
        m = self._get_market(market_id)
        assert (
            gl.message.sender == m.creator or
            gl.message.sender == self.owner
        ), "Not authorized"
        assert m.status in [MarketStatus.OPEN, MarketStatus.LOCKED], \
            "Cannot void at this stage"
        m.status = MarketStatus.VOIDED
        self.markets[market_id] = m
        return True

    # ════════════════════════════════════════════════════════
    #  BETTOR AGENT — Bet Placement & Claim
    # ════════════════════════════════════════════════════════

    @gl.public.write
    def place_bet(self, market_id: str, side: str) -> str:
        m = self._get_market(market_id)
        assert m.status == MarketStatus.OPEN,     "Market not open"
        assert gl.block.timestamp < m.close_time, "Betting closed"
        assert side in [Outcome.YES, Outcome.NO], "Side must be YES or NO"
        assert gl.message.value > 0,              "Must send ETH"

        amount = gl.message.value
        bettor = gl.message.sender
        bid    = self._hash(f"{bettor}{market_id}{side}{gl.block.timestamp}")

        self.bets[bid] = Bet(
            id        = bid,
            market_id = market_id,
            bettor    = bettor,
            side      = side,
            amount    = amount,
            claimed   = False,
            placed_at = gl.block.timestamp,
        )

        self.market_bets[market_id].append(bid)
        addr_key = str(bettor)
        if addr_key not in self.bettor_bets:
            self.bettor_bets[addr_key] = []
        self.bettor_bets[addr_key].append(bid)

        if side == Outcome.YES:
            m.pool_yes += amount
        else:
            m.pool_no  += amount

        self.total_volume      += amount
        self.markets[market_id] = m
        return bid

    @gl.public.write
    def claim_winnings(self, bet_id: str) -> u256:
        b = self._get_bet(bet_id)
        m = self._get_market(b.market_id)

        assert b.bettor == gl.message.sender,      "Not your bet"
        assert not b.claimed,                      "Already claimed"
        assert m.status == MarketStatus.RESOLVED,  "Market not resolved"

        payout = 0

        if m.outcome == Outcome.VOID:
            payout = b.amount  # full refund

        elif b.side == m.outcome:
            total_pool = m.pool_yes + m.pool_no
            win_pool   = m.pool_yes if m.outcome == Outcome.YES else m.pool_no
            gross      = (b.amount * total_pool) // win_pool
            fee        = (gross * m.fee_bps) // 10000
            payout     = gross - fee
            if fee > 0:
                gl.send_tokens(self.owner, fee)

        b.claimed = True
        self.bets[bet_id] = b

        if payout > 0:
            gl.send_tokens(b.bettor, payout)

        return payout

    @gl.public.write
    def refund_void(self, bet_id: str) -> bool:
        """Explicit refund path for voided markets"""
        b = self._get_bet(bet_id)
        m = self._get_market(b.market_id)
        assert b.bettor == gl.message.sender, "Not your bet"
        assert not b.claimed,                 "Already claimed"
        assert m.status == MarketStatus.VOIDED, "Market not voided"
        b.claimed = True
        self.bets[bet_id] = b
        gl.send_tokens(b.bettor, b.amount)
        return True

    # ════════════════════════════════════════════════════════
    #  RESOLVER AGENT — AI-Powered Real-World Resolution
    # ════════════════════════════════════════════════════════

    @gl.public.write
    def request_resolution(self, market_id: str) -> bool:
        """Anyone can trigger resolution after resolve_time"""
        m = self._get_market(market_id)
        assert gl.block.timestamp >= m.resolve_time, "Too early to resolve"
        assert m.status == MarketStatus.LOCKED,      "Must be locked first"
        self._resolve(market_id)
        return True

    @gl.public.write
    def _resolve(self, market_id: str) -> None:
        m = self._get_market(market_id)

        prompt = f"""
You are an impartial prediction market resolver with real-time web access.

MARKET QUESTION:
"{m.title}"

DESCRIPTION:
{m.description}

RESOLUTION CRITERIA:
Resolves YES if the event has clearly occurred.
Resolves NO if the event has clearly NOT occurred.
Resolves VOID only if: event is ambiguous, primary source unavailable,
or question is fundamentally unanswerable.

PRIMARY SOURCE TO CHECK:
{m.resolution_url}

MARKET CATEGORY: {m.category}

INSTRUCTIONS:
1. Fetch and read the primary source URL above.
2. Search for corroborating sources about this event.
3. Determine the outcome based on available evidence.
4. Only resolve VOID if evidence is genuinely insufficient.
5. Provide a short factual explanation (max 2 sentences).

Respond ONLY in this exact JSON — no preamble, no markdown:
{{
  "outcome": "yes",
  "confidence": "high",
  "reason": "...",
  "sources_checked": ["url1", "url2"]
}}

outcome must be exactly: yes | no | void
confidence must be exactly: high | medium | low
"""
        raw = gl.exec_prompt(prompt)

        try:
            result = json.loads(raw)
        except Exception:
            m.status        = MarketStatus.VOIDED
            m.resolver_note = "AI response parse error — market voided"
            self.markets[market_id] = m
            return

        outcome    = result.get("outcome", "void").lower()
        confidence = result.get("confidence", "low")
        reason     = result.get("reason", "")

        # Low confidence → auto-void to protect bettors
        if confidence == "low" and outcome != "void":
            outcome = "void"
            reason  = f"Low confidence — auto-voided. Original: {reason}"

        if outcome not in [Outcome.YES, Outcome.NO, Outcome.VOID]:
            outcome = Outcome.VOID
            reason  = "Invalid AI outcome — market voided"

        m.outcome       = outcome
        m.status        = MarketStatus.RESOLVED
        m.resolved_at   = gl.block.timestamp
        m.resolver_note = reason
        self.markets[market_id] = m

    @gl.public.write
    def force_resolve(
        self, market_id: str, outcome: str, note: str
    ) -> bool:
        """Owner emergency resolution override"""
        assert gl.message.sender == self.owner, "Only owner"
        m = self._get_market(market_id)
        assert m.status in [MarketStatus.LOCKED, MarketStatus.DISPUTED], \
            "Invalid state"
        assert outcome in [Outcome.YES, Outcome.NO, Outcome.VOID], \
            "Invalid outcome"
        m.outcome       = outcome
        m.status        = MarketStatus.RESOLVED
        m.resolved_at   = gl.block.timestamp
        m.resolver_note = f"[FORCED] {note}"
        self.markets[market_id] = m
        return True

    # ════════════════════════════════════════════════════════
    #  AUDIT AGENT — Disputes & Appeals
    # ════════════════════════════════════════════════════════

    @gl.public.write
    def raise_dispute(self, market_id: str, reason: str) -> str:
        m = self._get_market(market_id)
        assert m.status == MarketStatus.RESOLVED, "Can only dispute resolved"
        assert gl.block.timestamp <= m.resolved_at + 86400, \
            "Dispute window is 24h after resolution"

        bids     = self.market_bets.get(market_id, [])
        has_bet  = any(
            self.bets[b].bettor == gl.message.sender for b in bids
        )
        assert has_bet, "Only bettors can dispute"

        did = self._hash(
            f"{market_id}{gl.message.sender}{reason}{gl.block.timestamp}"
        )
        self.disputes[did] = Dispute(
            id        = did,
            market_id = market_id,
            raised_by = gl.message.sender,
            reason    = reason,
            resolved  = False,
            outcome   = "",
        )
        m.status = MarketStatus.DISPUTED
        self.markets[market_id] = m
        return did

    @gl.public.write
    def resolve_dispute(
        self, dispute_id: str, upheld: bool, new_outcome: str, note: str
    ) -> bool:
        assert gl.message.sender == self.owner, "Only owner"
        d = self.disputes[dispute_id]
        assert not d.resolved, "Already resolved"

        m = self._get_market(d.market_id)

        if upheld:
            assert new_outcome in [Outcome.YES, Outcome.NO, Outcome.VOID], \
                "Invalid outcome"
            m.outcome       = new_outcome
            m.status        = MarketStatus.RESOLVED
            m.resolver_note = f"[DISPUTE UPHELD] {note}"
            m.resolved_at   = gl.block.timestamp
            d.outcome       = "upheld"
        else:
            m.status        = MarketStatus.RESOLVED
            m.resolver_note = f"[DISPUTE REJECTED] {note}"
            d.outcome       = "rejected"

        d.resolved                = True
        self.markets[d.market_id] = m
        self.disputes[dispute_id] = d
        return True

    @gl.public.write
    def re_resolve(self, market_id: str) -> bool:
        """Re-run AI resolution on a disputed market"""
        assert gl.message.sender == self.owner, "Only owner"
        m = self._get_market(market_id)
        assert m.status == MarketStatus.DISPUTED, "Market not disputed"
        m.status = MarketStatus.LOCKED
        self.markets[market_id] = m
        self._resolve(market_id)
        return True

    # ════════════════════════════════════════════════════════
    #  READ VIEWS
    # ════════════════════════════════════════════════════════

    @gl.public.view
    def get_market(self, market_id: str) -> dict:
        return self.markets[market_id].__dict__

    @gl.public.view
    def get_bet(self, bet_id: str) -> dict:
        return self.bets[bet_id].__dict__

    @gl.public.view
    def get_dispute(self, dispute_id: str) -> dict:
        return self.disputes[dispute_id].__dict__

    @gl.public.view
    def get_market_bets(self, market_id: str) -> list:
        return self.market_bets.get(market_id, [])

    @gl.public.view
    def get_bettor_bets(self, bettor: str) -> list:
        return self.bettor_bets.get(bettor, [])

    @gl.public.view
    def get_odds(self, market_id: str) -> dict:
        m     = self._get_market(market_id)
        total = m.pool_yes + m.pool_no
        if total == 0:
            return {"yes": 50, "no": 50, "total_pool": 0}
        yes_pct = (m.pool_yes * 100) // total
        return {
            "yes":        yes_pct,
            "no":         100 - yes_pct,
            "pool_yes":   m.pool_yes,
            "pool_no":    m.pool_no,
            "total_pool": total,
        }

    @gl.public.view
    def get_market_stats(self, market_id: str) -> dict:
        bids      = self.market_bets.get(market_id, [])
        yes_count = sum(1 for b in bids if self.bets[b].side == Outcome.YES)
        no_count  = sum(1 for b in bids if self.bets[b].side == Outcome.NO)
        m         = self._get_market(market_id)
        return {
            "market_id":    market_id,
            "title":        m.title,
            "status":       m.status,
            "outcome":      m.outcome,
            "pool_yes":     m.pool_yes,
            "pool_no":      m.pool_no,
            "total_bets":   len(bids),
            "yes_bets":     yes_count,
            "no_bets":      no_count,
            "resolver_note":m.resolver_note,
        }

    @gl.public.view
    def get_platform_stats(self) -> dict:
        return {
            "total_markets": len(self.markets),
            "total_volume":  self.total_volume,
            "fee_bps":       self.platform_fee_bps,
            "owner":         str(self.owner),
        }

    # ════════════════════════════════════════════════════════
    #  ADMIN
    # ════════════════════════════════════════════════════════

    @gl.public.write
    def set_fee(self, bps: u256) -> bool:
        assert gl.message.sender == self.owner, "Only owner"
        assert bps <= 500, "Max 5%"
        self.platform_fee_bps = bps
        return True

    @gl.public.write
    def transfer_ownership(self, new_owner: Address) -> bool:
        assert gl.message.sender == self.owner, "Only owner"
        self.owner = new_owner
        return True

    # ════════════════════════════════════════════════════════
    #  INTERNAL HELPERS
    # ════════════════════════════════════════════════════════

    def _get_market(self, mid: str) -> Market:
        assert mid in self.markets, "Market not found"
        return self.markets[mid]

    def _get_bet(self, bid: str) -> Bet:
        assert bid in self.bets, "Bet not found"
        return self.bets[bid]

    def _hash(self, data: str) -> str:
        return hashlib.sha256(data.encode()).hexdigest()[:32]
```

---

## Agent Interaction Flow

```
Creator                 Bettor               GenLayer / AI
  │                       │                       │
  ├─ create_market() ───► │                       │
  │                       │                       │
  │                       ├─ place_bet(YES) ─────►│
  │                       ├─ place_bet(NO)  ─────►│
  │                       │                       │
  │  [close_time passes]  │                       │
  ├─ lock_market() ──────────────────────────────►│
  │                       │                       │
  │  [resolve_time passes]│                       │
  ├─ request_resolution() ───────────────────────►│
  │                       │                       ├─ exec_prompt()
  │                       │                       ├─ fetch resolution_url
  │                       │                       ├─ web search corroboration
  │                       │                       ├─ score confidence
  │                       │                       ├─ emit: YES / NO / VOID
  │                       │                       │
  │                       │◄── RESOLVED ──────────┤
  │                       ├─ claim_winnings() ───►│
  │                       │◄── payout ────────────┤
  │                       │                       │
  │  [if disputed]        │                       │
  │                       ├─ raise_dispute() ────►│
  ├─ resolve_dispute() ──────────────────────────►│
  │  OR re_resolve() ────────────────────────────►│ ← AI re-runs
```

---

## Resolution Logic (AI Decision Tree)

```
exec_prompt(market context + resolution_url)
          │
          ▼
     Fetch URL + web search corroboration
          │
          ▼
    confidence == high or medium?
    ┌────────────┴────────────┐
   YES                       NO
    │                         │
 outcome =               outcome = VOID
 YES | NO               (auto-protect bettors)
    │
    ▼
 pool math → payout
 fee split → owner
```

---

## Market Lifecycle States

```
  OPEN ──► LOCKED ──► RESOLVED ──► [claims open]
    │          │           │
    │          │      [24h window]
    │          │           │
    │          │      DISPUTED ──► RESOLVED (re-run or force)
    │          │
    └──────────┴──► VOIDED ──► [refunds open]
```

---

## Payout Formula

```
gross_payout = (bet_amount / winning_pool) × total_pool
fee          = gross_payout × fee_bps / 10000
net_payout   = gross_payout - fee

Example:
  total_pool  = 10 ETH  (6 ETH YES, 4 ETH NO)
  outcome     = YES
  your bet    = 1 ETH YES
  gross       = (1/6) × 10 = 1.667 ETH
  fee (1.5%)  = 0.025 ETH
  net payout  = 1.642 ETH
```

---

## Deployment

```bash
# Install GenLayer CLI
pip install genlayer

# Deploy to testnet
genlayer deploy contracts/RealityBet.py --network testnet

# Seed sample markets
python scripts/seed_markets.py \
  --contract <deployed_address> \
  --markets '[
    {
      "title": "Will BTC close above $100k on Dec 31 2025?",
      "category": "crypto",
      "resolution_url": "https://coinmarketcap.com/currencies/bitcoin/",
      "close_time": 1767139200,
      "resolve_time": 1767225600
    },
    {
      "title": "Will Ethiopia qualify for AFCON 2026?",
      "category": "sports",
      "resolution_url": "https://en.wikipedia.org/wiki/2026_Africa_Cup_of_Nations_qualification",
      "close_time": 1762041600,
      "resolve_time": 1762128000
    }
  ]'
```

---

## Example Markets by Category

| Category | Example Question | Resolution Source |
|---|---|---|
| Crypto | Will ETH flip BTC by market cap in 2025? | CoinMarketCap |
| Sports | Will [Team] win the league? | Wikipedia / ESPN |
| Politics | Will [Candidate] win the election? | BBC News |
| Tech | Will GPT-5 be released before June 2025? | OpenAI blog |
| Science | Will a new exoplanet be confirmed habitable? | NASA.gov |

---

## Key Design Decisions

**Single `exec_prompt` call**
GenLayer charges per LLM validator consensus round. One prompt that fetches + evaluates + scores confidence is cheaper than chaining multiple calls.

**Auto-void on low confidence**
Protecting bettors from bad resolutions > forcing a wrong outcome. Refunds preserve long-term platform trust.

**24h dispute window**
Enough time for losers to challenge without holding winner funds indefinitely. Production: make this configurable per market.

**Odds from pool math, not oracle**
Implied probability from pool ratio = natural price discovery. No external oracle dependency = fewer attack vectors.

**`re_resolve` on dispute**
Re-running AI with fresh web state (news may have updated) is cleaner than manual arbitration for most cases. `force_resolve` is the final fallback.

---

## Next Steps

- [ ] Multi-outcome markets (A / B / C, not just YES / NO)
- [ ] Hunter leaderboard — ranked by P&L across markets
- [ ] Liquidity mining — bonus tokens for early bettors
- [ ] Market factory — anyone can deploy a themed sub-platform
- [ ] ArcPass integration — KYC-gated high-stakes markets
- [ ] Frontend: React + wagmi + GenLayer SDK + real-time odds chart
