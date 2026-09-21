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
