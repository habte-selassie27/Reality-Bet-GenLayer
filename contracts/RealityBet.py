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
