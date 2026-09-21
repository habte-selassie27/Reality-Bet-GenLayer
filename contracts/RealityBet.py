# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import typing


class MarketStatus:
    OPEN = "open"
    LOCKED = "locked"
    RESOLVED = "resolved"
    VOIDED = "voided"
    DISPUTED = "disputed"


class Outcome:
    YES = "yes"
    NO = "no"
    VOID = "void"


class Category:
    SPORTS = "sports"
    POLITICS = "politics"
    CRYPTO = "crypto"
    TECH = "tech"
    SCIENCE = "science"
    CUSTOM = "custom"


@allow_storage
@dataclass
class Market:
    id: str
    creator: Address
    title: str
    description: str
    resolution_url: str
    category: str
    close_time: u256
    resolve_time: u256
    outcome: str
    status: str
    pool_yes: u256
    pool_no: u256
    fee_bps: u256
    resolved_at: u256
    resolver_note: str


@allow_storage
@dataclass
class Bet:
    id: str
    market_id: str
    bettor: Address
    side: str
    amount: u256
    claimed: bool
    placed_at: u256


@allow_storage
@dataclass
class Dispute:
    id: str
    market_id: str
    raised_by: Address
    reason: str
    resolved: bool
    outcome: str


class RealityBet(gl.Contract):
    markets: TreeMap[str, Market]
    bets: TreeMap[str, Bet]
    disputes: TreeMap[str, Dispute]
    market_bets: TreeMap[str, DynArray[str]]
    bettor_bets: TreeMap[str, DynArray[str]]
    owner: Address
    platform_fee_bps: u256
    total_volume: u256
    market_count: u256
    bet_count: u256
    dispute_count: u256

    def __init__(self):
        self.owner = gl.message.sender_address
        self.platform_fee_bps = u256(150)
        self.total_volume = u256(0)
        self.market_count = u256(0)
        self.bet_count = u256(0)
        self.dispute_count = u256(0)

    def _now(self) -> u256:
        return u256(int(datetime.now(timezone.utc).timestamp()))

    def _get_market(self, mid: str) -> Market:
        if mid not in self.markets:
            raise gl.vm.UserError("Market not found")
        return self.markets[mid]

    def _get_bet(self, bid: str) -> Bet:
        if bid not in self.bets:
            raise gl.vm.UserError("Bet not found")
        return self.bets[bid]

    def _addr_key(self, a: Address) -> str:
        return format(a, "x")

    @gl.public.write
    def create_market(
        self, title: str, description: str, resolution_url: str, category: str, close_time: u256, resolve_time: u256
    ) -> str:
        now = self._now()
        if not close_time > now:
            raise gl.vm.UserError("Close time must be future")
        if not resolve_time >= close_time:
            raise gl.vm.UserError("Resolve after close")
        if category not in [Category.SPORTS, Category.POLITICS, Category.CRYPTO, Category.TECH, Category.SCIENCE, Category.CUSTOM]:
            raise gl.vm.UserError("Invalid category")
        mid = "m" + str(int(self.market_count)) + "-" + str(int(now))
        self.market_count = u256(int(self.market_count) + 1)
        self.markets[mid] = Market(
            mid, gl.message.sender_address, title, description, resolution_url,
            category, close_time, resolve_time, "", MarketStatus.OPEN,
            u256(0), u256(0), self.platform_fee_bps, u256(0), "",
        )
        self.market_bets.get_or_insert_default(mid)
        return mid

    @gl.public.write
    def lock_market(self, market_id: str) -> bool:
        m = self._get_market(market_id)
        if not self._now() >= m.close_time:
            raise gl.vm.UserError("Market not closed yet")
        if not m.status == MarketStatus.OPEN:
            raise gl.vm.UserError("Market not open")
        m.status = MarketStatus.LOCKED
        self.markets[market_id] = m
        return True

    @gl.public.write
    def void_market(self, market_id: str) -> bool:
        m = self._get_market(market_id)
        sender = gl.message.sender_address
        if not (sender == m.creator or sender == self.owner):
            raise gl.vm.UserError("Not authorized")
        if m.status not in [MarketStatus.OPEN, MarketStatus.LOCKED]:
            raise gl.vm.UserError("Cannot void at this stage")
        m.status = MarketStatus.VOIDED
        self.markets[market_id] = m
        return True

    @gl.public.write.payable
    def fund_market(self, market_id: str) -> bool:
        m = self._get_market(market_id)
        if not m.status == MarketStatus.OPEN:
            raise gl.vm.UserError("Market not open")
        v = gl.message.value
        if not v > u256(0):
            raise gl.vm.UserError("Must send GEN")
        half = u256(int(v) // 2)
        m.pool_yes = u256(int(m.pool_yes) + int(half))
        m.pool_no = u256(int(m.pool_no) + int(v) - int(half))
        self.total_volume = u256(int(self.total_volume) + int(v))
        self.markets[market_id] = m
        return True

    @gl.public.write.payable
    def place_bet(self, market_id: str, side: str) -> str:
        m = self._get_market(market_id)
        if not m.status == MarketStatus.OPEN:
            raise gl.vm.UserError("Market not open")
        if not self._now() < m.close_time:
            raise gl.vm.UserError("Betting closed")
        s = side.lower().strip()
        if s not in [Outcome.YES, Outcome.NO]:
            raise gl.vm.UserError('Side must be yes or no')
        amount = gl.message.value
        if not amount > u256(0):
            raise gl.vm.UserError("Must send GEN")
        bettor = gl.message.sender_address
        now = self._now()
        bid = "b" + str(int(self.bet_count)) + "-" + str(int(now))
        self.bet_count = u256(int(self.bet_count) + 1)
        self.bets[bid] = Bet(bid, market_id, bettor, s, amount, False, now)
        self.market_bets.get_or_insert_default(market_id).append(bid)
        key = self._addr_key(bettor)
        self.bettor_bets.get_or_insert_default(key).append(bid)
        if s == Outcome.YES:
            m.pool_yes = u256(int(m.pool_yes) + int(amount))
        else:
            m.pool_no = u256(int(m.pool_no) + int(amount))
        self.total_volume = u256(int(self.total_volume) + int(amount))
        self.markets[market_id] = m
        return bid

    @gl.public.write
    def claim_winnings(self, bet_id: str) -> u256:
        b = self._get_bet(bet_id)
        m = self._get_market(b.market_id)
        if not b.bettor == gl.message.sender_address:
            raise gl.vm.UserError("Not your bet")
        if b.claimed:
            raise gl.vm.UserError("Already claimed")
        if not m.status == MarketStatus.RESOLVED:
            raise gl.vm.UserError("Market not resolved")
        payout = u256(0)
        if m.outcome == Outcome.VOID:
            payout = b.amount
        elif b.side == m.outcome:
            total_pool = u256(int(m.pool_yes) + int(m.pool_no))
            win_pool = m.pool_yes if m.outcome == Outcome.YES else m.pool_no
            if int(win_pool) == 0:
                payout = u256(0)
            else:
                gross = u256(int(b.amount) * int(total_pool) // int(win_pool))
                fee = u256(int(gross) * int(m.fee_bps) // 10000)
                payout = u256(int(gross) - int(fee))
                if int(fee) > 0:
                    gl.get_contract_at(self.owner).emit_transfer(value=fee)
        b.claimed = True
        self.bets[bet_id] = b
        if int(payout) > 0:
            gl.get_contract_at(b.bettor).emit_transfer(value=payout)
        return payout

    @gl.public.write
    def refund_void(self, bet_id: str) -> bool:
        b = self._get_bet(bet_id)
        m = self._get_market(b.market_id)
        if not b.bettor == gl.message.sender_address:
            raise gl.vm.UserError("Not your bet")
        if b.claimed:
            raise gl.vm.UserError("Already claimed")
        if not m.status == MarketStatus.VOIDED:
            raise gl.vm.UserError("Market not voided")
        b.claimed = True
        self.bets[bet_id] = b
        gl.get_contract_at(b.bettor).emit_transfer(value=b.amount)
        return True

    @gl.public.write
    def request_resolution(self, market_id: str) -> bool:
        m = self._get_market(market_id)
        if not self._now() >= m.resolve_time:
            raise gl.vm.UserError("Too early to resolve")
        if not m.status == MarketStatus.LOCKED:
            raise gl.vm.UserError("Must be locked first")
        self._resolve(market_id)
        return True

    def _resolve(self, market_id: str) -> None:
        m = self._get_market(market_id)
        title = m.title
        desc = m.description
        url = m.resolution_url
        cat = m.category
        prompt = (
            "You are an impartial prediction market resolver with web access.\n"
            'MARKET QUESTION: "' + title + '"\nDESCRIPTION: ' + desc + "\n"
            "CRITERIA: YES if event clearly occurred. NO if clearly NOT occurred. "
            "VOID only if ambiguous, source unavailable, or unanswerable.\n"
            "PRIMARY SOURCE: " + url + "\nCATEGORY: " + cat + "\n"
            "1.Fetch primary source.2.Search corroborating sources.3.Decide yes|no|void."
            "4.Confidence high|medium|low.5.Reason max 2 sentences.\n"
            'Respond ONLY JSON: {"outcome":"yes","confidence":"high",'
            '"reason":"...","sources_checked":["url1"]}'
        )

        def _fetch() -> str:
            web_data = gl.nondet.web.get(url)
            body = web_data.body.decode("utf-8")[:6000]
            full = prompt + "\nPAGE CONTENT:\n" + body
            res = gl.nondet.exec_prompt(full)
            if isinstance(res, dict):
                return json.dumps(res, sort_keys=True)
            cleaned = res.replace("```json", "").replace("```", "").strip()
            return json.dumps(json.loads(cleaned), sort_keys=True)

        raw = gl.eq_principle.prompt_comparative(
            _fetch, "`outcome` must be exactly the same. All other fields must be similar"
        )
