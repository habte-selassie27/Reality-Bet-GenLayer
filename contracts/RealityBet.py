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
