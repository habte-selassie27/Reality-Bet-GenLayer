import json
from datetime import datetime, timezone


def _ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _make_market(contract, close_ts, resolve_ts, categories=None):
    return contract.create_market(
        "Will BTC close above $100k on Dec 31 2025?",
        "Resolves YES if BTC closes above 100k.",
        "https://coinmarketcap.com/currencies/bitcoin/",
        categories if categories is not None else ["crypto"],
        close_ts,
        resolve_ts,
    )


def _setup_open_market(direct_vm, contract):
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    return _make_market(contract, now + 1000, now + 2000)


# Every test below resolves its market at 01:00, which is when the 24h dispute
# window opens. Payouts stay locked until that window closes, so claims must
# warp past it first.
_RESOLVED_AT = "2025-01-01T01:00:00Z"
_DISPUTE_WINDOW = 86400


def _past_dispute_window(direct_vm):
    direct_vm.warp("2025-01-02T01:00:01Z")


# An emitted transfer is async: it either lands on the settlement layer or it
# fails. The contract records the payee's on-chain balance before every emit
# and re-reads it at recovery time, so a test must model BOTH outcomes to be
# meaningful: an un-credited balance (delivery genuinely failed) or a credited
# one (the transfer landed). "_past_settle_grace" moves past the window in
# which a fresh emit could still land, making a non-delivery report valid.
_SETTLE_GRACE = 3600


def _past_settle_grace(direct_vm, from_iso):
    ts = _ts(from_iso) + _SETTLE_GRACE
    direct_vm.warp(
        datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def _addr_bytes(addr):
    """Normalise any address form (calldata hex str / Address / bytes) to the
    raw bytes key the VM balance ledger uses."""
    if isinstance(addr, (bytes, bytearray)):
        return bytes(addr)
    s = str(addr).lower()
    if s.startswith("0x"):
        s = s[2:]
    return bytes.fromhex(s)


def _hex(addr):
    """Address fixtures vary by genlayer-test version (bytes, str, Address),
    while the contract's string views expect 0x-hex. Normalise either form."""
    if isinstance(addr, (bytes, bytearray)):
        return "0x" + bytes(addr).hex()
    s = str(addr)
    return s if s.startswith("0x") else "0x" + s


def _mock_resolution(direct_vm, outcome, confidence="high"):
    direct_vm.mock_web(".*", {"status": 200, "body": "<html>BTC price $105000</html>"})
    direct_vm.mock_llm(".*", json.dumps({
        "outcome": outcome,
        "confidence": confidence,
        "reason": "Event confirmed by primary source.",
        "sources_checked": ["https://coinmarketcap.com/currencies/bitcoin/"],
    }))


def test_create_market(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    m = contract.get_market(mid)
    assert m["title"].startswith("Will BTC")
    assert m["status"] == "open"
    assert m["outcome"] == ""
    assert m["pool_yes"] == 0 and m["pool_no"] == 0
    assert m["resolver_confidence"] == "" and m["resolver_sources"] == ""
    assert m["categories"] == ["crypto"]
    assert m["category"] == "crypto"


def test_create_market_multi_categories(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    mid = _make_market(contract, now + 1000, now + 2000, ["crypto", "finance", "economy"])
    m = contract.get_market(mid)
    assert m["categories"] == ["crypto", "finance", "economy"]
    assert m["category"] == "crypto"


def test_create_market_dedupes_and_caps_categories(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    mid = _make_market(
        contract, now + 1000, now + 2000,
        ["Crypto", "crypto", "sports", "tech", "science", "world", "custom"],
    )
    m = contract.get_market(mid)
    assert m["categories"] == ["crypto", "sports", "tech", "science", "world"]


def test_create_market_invalid_category_reverts(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    with direct_vm.expect_revert("Invalid category"):
        _make_market(contract, now + 1000, now + 2000, ["crypto", "not-a-category"])
    with direct_vm.expect_revert("At least one category"):
        _make_market(contract, now + 1000, now + 2000, [])


def test_place_bet_yes_no(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 3000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    assert bid_yes != bid_no
    odds = contract.get_odds(mid)
    assert odds["pool_yes"] == 1000
    assert odds["pool_no"] == 3000
    assert odds["total_pool"] == 4000
    assert odds["yes"] == 25 and odds["no"] == 75


def test_lock_market(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    with direct_vm.expect_revert("not closed"):
        contract.lock_market(mid)
    direct_vm.warp("2025-01-01T00:20:00Z")
    assert contract.lock_market(mid) is True
    assert contract.get_market(mid)["status"] == "locked"


def test_resolve_yes_pays_winner(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes")
    assert contract.request_resolution(mid) is True
    m = contract.get_market(mid)
    assert m["outcome"] == "yes"
    assert m["resolver_confidence"] == "high"
    assert "coinmarketcap.com" in m["resolver_sources"]
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    payout = int(contract.claim_winnings(bid_yes))
    # gross=(6000*10000)//6000=10000, fee=10000*150//10000=150, net=9850
    assert payout == 9850
    # Paying out after the window freezes the market without a finalize call.
    assert contract.get_market(mid)["finalized"] is True


def test_resolve_no_pays_winner(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 2000
    contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 8000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "no")
    contract.request_resolution(mid)
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_bob
    payout = int(contract.claim_winnings(bid_no))
    # gross=(8000*10000)//8000=10000, fee=150, net=9850
    assert payout == 9850


def test_resolve_void_refunds(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 5000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "void")
    contract.request_resolution(mid)
    assert contract.get_market(mid)["outcome"] == "void"
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 5000


def test_low_confidence_voids(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes", confidence="low")
    contract.request_resolution(mid)
    m = contract.get_market(mid)
    assert m["outcome"] == "void"
    assert "Low confidence" in m["resolver_note"]
    assert m["resolver_confidence"] == "low"
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 1000


def test_duplicate_claim_reverts(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    contract.claim_winnings(bid)
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(bid)


def test_dispute_flow(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    direct_vm.sender = direct_alice
    did = contract.raise_dispute(mid, "Primary source misread")
    assert contract.get_market(mid)["status"] == "disputed"
    direct_vm.sender = direct_owner
    assert contract.resolve_dispute(did, True, "no", "Manual review: event did not occur") is True
    m = contract.get_market(mid)
    assert m["status"] == "resolved" and m["outcome"] == "no"
    d = contract.get_dispute(did)
    assert d["resolved"] is True and d["outcome"] == "upheld"


def test_loser_gets_zero(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_bob
    assert int(contract.claim_winnings(bid_no)) == 0


def test_fee_split(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    assert contract.set_fee(200) is True
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 3000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1000
    contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp("2025-01-01T01:00:00Z")
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    assert contract.get_market(mid)["fee_bps"] == 200
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    payout = int(contract.claim_winnings(bid_yes))
    # gross=(3000*4000)//3000=4000, fee=4000*200//10000=80, net=3920
    assert payout == 3920


def test_market_ids_page_newest_first(direct_vm, direct_deploy, direct_owner):
    """11 markets so the newest id (m10) would sort before m2 as a plain string."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    created = [_make_market(contract, now + 1000, now + 2000) for _ in range(11)]

    assert len(created) == 11
    assert contract.get_market_ids(0, 11) == list(reversed(created))
    assert contract.get_market_ids(0, 3) == created[-1:-4:-1]
    assert contract.get_market_ids(10, 5) == [created[0]]
    assert contract.get_market_ids(99, 5) == []
    assert contract.get_market_ids(0, 999) == list(reversed(created))  # capped at 50

    page = contract.get_markets_page(0, 2)
    assert [m["id"] for m in page] == created[-1:-3:-1]
    assert page[0]["title"].startswith("Will BTC")
    assert page[0]["status"] == "open"


def test_market_bets_detailed_newest_first(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)

    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 3000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0

    assert contract.get_market_bets(mid) == [bid_yes, bid_no]
    detailed = contract.get_market_bets_detailed(mid)
    assert [b["id"] for b in detailed] == [bid_no, bid_yes]
    assert detailed[1]["side"] == "yes" and detailed[1]["amount"] == 1000
    assert detailed[0]["side"] == "no" and detailed[0]["amount"] == 3000
    assert detailed[0]["claimed"] is False
    assert contract.get_market_bets_detailed("m-does-not-exist") == []


def test_bets_by_bettor_matches_raw_and_hex(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    """Regression: get_bettor_bets stripped 0x from the query but not from the
    stored key, so it never matched and always returned [] — which is why the
    frontend fell back to scanning every market it knew about."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 3000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0

    alice_bets = contract.get_bets_by_bettor(_hex(direct_alice))
    assert len(alice_bets) == 1
    assert alice_bets[0]["id"] == bid_yes
    assert alice_bets[0]["side"] == "yes"
    assert alice_bets[0]["market_id"] == mid

    # The address as stored on chain, and the same value without its 0x prefix,
    # must both resolve.
    alice_hex = alice_bets[0]["bettor"]
    assert contract.get_bettor_bets(alice_hex) == [bid_yes]
    bare = alice_hex[2:] if alice_hex.startswith("0x") else alice_hex
    assert contract.get_bettor_bets(bare) == [bid_yes]
    assert [b["id"] for b in contract.get_bets_by_bettor(bare)] == [bid_yes]

    assert [b["id"] for b in contract.get_bets_by_bettor(_hex(direct_bob))] == [bid_no]
    assert contract.get_bets_by_bettor("0xdeadbeef") == []


def test_claims_locked_until_dispute_window_closes(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """Resolve → early claim blocked → disputed outcome change → solvent payout.

    This is the full payout-safety path: no money may move while the outcome is
    still appealable, a dispute may still flip the outcome, and the payout that
    follows follows the *final* outcome and is frozen from then on.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    assert contract.request_resolution(mid) is True

    m = contract.get_market(mid)
    assert m["status"] == "resolved" and m["outcome"] == "yes"
    assert m["finalized"] is False
    assert m["claims_open"] is False
    assert m["dispute_deadline"] == _ts(_RESOLVED_AT) + _DISPUTE_WINDOW

    # 1. Early claim is rejected — resolved is not the same as final.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("payouts locked"):
        contract.claim_winnings(bid_yes)
    assert contract.get_bet(bid_yes)["claimed"] is False
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Dispute window still open"):
        contract.finalize_market(mid)

    # 2. The losing side disputes inside the window and the outcome flips.
    direct_vm.sender = direct_bob
    did = contract.raise_dispute(mid, "Source misread: the event did not occur")
    assert contract.get_market(mid)["status"] == "disputed"
    with direct_vm.expect_revert("Market not resolved"):
        contract.claim_winnings(bid_no)

    direct_vm.sender = direct_owner
    assert contract.resolve_dispute(did, True, "no", "Manual review flipped it") is True
    m = contract.get_market(mid)
    assert m["status"] == "resolved" and m["outcome"] == "no"
    assert m["finalized"] is True   # dispute finally resolved → payouts open now
    assert m["claims_open"] is True

    # 3. Payouts follow the final outcome and stay solvent: the 4000 NO stake
    #    takes the 10000 pool minus the 1.5% fee, and the YES stake wins nothing.
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid_yes)) == 0
    direct_vm.sender = direct_bob
    payout_no = int(contract.claim_winnings(bid_no))
    assert payout_no == 9850  # gross 4000*10000//4000 = 10000, fee 150
    assert payout_no <= 6000 + 4000
    assert 6000 + 4000 - payout_no == 150

    # 4. Funds moved, so the outcome is sealed: no second claim, no force
    #    resolve, no re-resolution, no fresh dispute.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(bid_yes)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Invalid state"):
        contract.force_resolve(mid, "yes", "flip after payout")
    with direct_vm.expect_revert("Market not disputed"):
        contract.re_resolve(mid)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("outcome locked"):
        contract.raise_dispute(mid, "second bite")
    assert contract.get_market(mid)["outcome"] == "no"


def test_finalize_unlocks_payouts_after_window(direct_vm, direct_deploy, direct_owner, direct_alice):
    """An undisputed market: locked through the window, then finalize (or a
    later claim) freezes it and the fee split still lands."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)

    with direct_vm.expect_revert("payouts locked"):
        contract.claim_winnings(bid)
    _past_dispute_window(direct_vm)
    assert contract.finalize_market(mid) is True
    assert contract.get_market(mid)["finalized"] is True
    assert int(contract.claim_winnings(bid)) == 985  # gross 1000, fee 15
    with direct_vm.expect_revert("Market already finalized"):
        contract.finalize_market(mid)
    # A claim made after the window freezes the market too, so a late dispute
    # cannot reopen it.
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("outcome locked"):
        contract.raise_dispute(mid, "too late")


def test_ai_void_refunds_locked_until_window(direct_vm, direct_deploy, direct_owner, direct_alice):
    """A void *resolution* is still a resolution: refunds wait for the window,
    then return the whole stake (no fee) instead of paying a winner."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 5000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "void")
    contract.request_resolution(mid)

    m = contract.get_market(mid)
    assert m["status"] == "resolved" and m["outcome"] == "void"
    assert m["claims_open"] is False
    with direct_vm.expect_revert("payouts locked"):
        contract.claim_winnings(bid)

    _past_dispute_window(direct_vm)
    assert contract.get_market(mid)["claims_open"] is True
    assert int(contract.claim_winnings(bid)) == 5000
    assert contract.get_bet(bid)["claimed"] is True


def test_creator_void_refunds_immediately(direct_vm, direct_deploy, direct_owner, direct_alice):
    """Deliberate exemption: void_market is terminal — no outcome can ever be
    set on that market — so there is nothing to dispute and refunds are open."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 2000
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0

    direct_vm.sender = direct_owner
    assert contract.void_market(mid) is True
    assert contract.get_market(mid)["claims_open"] is True
    direct_vm.sender = direct_alice
    assert contract.refund_void(bid) is True
    assert contract.get_bet(bid)["claimed"] is True
    # Still no way to move money a second time on a voided market.
    with direct_vm.expect_revert("Already claimed"):
        contract.refund_void(bid)


def test_rejected_dispute_unlocks_payouts_immediately(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """The other half of the payout gate: a *finally resolved* dispute opens
    claims straight away, without waiting out a second 24h window."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)

    direct_vm.sender = direct_bob
    did = contract.raise_dispute(mid, "I disagree with the source")
    direct_vm.sender = direct_owner
    assert contract.resolve_dispute(did, False, "", "No basis for the dispute") is True
    m = contract.get_market(mid)
    assert m["outcome"] == "yes"
    assert m["finalized"] is True
    assert m["claims_open"] is True          # same second as the ruling

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid_yes)) == 9850
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("outcome locked"):
        contract.raise_dispute(mid, "second bite")


def test_force_resolve_dangling_dispute_cannot_land_after_payout(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """force_resolve leaves the ruling dispute unresolved behind it. That stale
    dispute must never be enforceable — least of all after money moved — and
    the forced outcome gets a fresh window of its own."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)

    direct_vm.sender = direct_alice
    did = contract.raise_dispute(mid, "Primary source misread")
    direct_vm.sender = direct_owner
    assert contract.force_resolve(mid, "no", "Manual override") is True

    # Market is resolved again, so the stale dispute can no longer be ruled on.
    with direct_vm.expect_revert("Dispute no longer active"):
        contract.resolve_dispute(did, True, "yes", "land it after the force")

    # The forced outcome restarts the window: payouts stay locked inside it.
    direct_vm.sender = direct_bob
    assert contract.get_market(mid)["claims_open"] is False
    with direct_vm.expect_revert("payouts locked"):
        contract.claim_winnings(bid_no)

    _past_dispute_window(direct_vm)
    assert int(contract.claim_winnings(bid_no)) == 9850

    # Funds moved: every remaining outcome path is shut, stale dispute included.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("outcome locked"):
        contract.raise_dispute(mid, "again")
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Market finalized"):
        contract.resolve_dispute(did, True, "yes", "flip after payout")
    assert contract.get_market(mid)["outcome"] == "no"


def test_re_resolve_gives_fresh_window_and_kills_stale_dispute(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """re_resolve re-decides the outcome, so it must re-lock payouts for a full
    window, and the dispute that triggered it must not be resolvable later."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)

    direct_vm.sender = direct_bob
    did = contract.raise_dispute(mid, "Re-run the AI")
    direct_vm.sender = direct_owner
    assert contract.re_resolve(mid) is True
    m = contract.get_market(mid)
    assert m["status"] == "resolved"
    assert m["claims_open"] is False              # fresh window after the re-run
    assert m["finalized"] is False

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("payouts locked"):
        contract.claim_winnings(bid_no)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Dispute no longer active"):
        contract.resolve_dispute(did, True, "yes", "stale ruling")

    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_bob
    contract.claim_winnings(bid_no)               # exactly once
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(bid_no)
    assert contract.get_market(mid)["finalized"] is True


def test_only_one_dispute_can_ever_land_an_outcome(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """Two disputes can exist across a force_resolve, but only one ruling may
    take effect — otherwise the same pool could be paid out on both sides."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 6000
    bid_yes = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 4000
    bid_no = contract.place_bet(mid, "no")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)

    direct_vm.sender = direct_bob
    did_1 = contract.raise_dispute(mid, "First challenge")
    direct_vm.sender = direct_owner
    contract.force_resolve(mid, "no", "Manual override")
    direct_vm.sender = direct_alice
    did_2 = contract.raise_dispute(mid, "Second challenge")

    direct_vm.sender = direct_owner
    assert contract.resolve_dispute(did_1, True, "yes", "First ruling lands") is True
    with direct_vm.expect_revert("Market finalized"):
        contract.resolve_dispute(did_2, True, "no", "Second ruling must not")
    assert contract.get_market(mid)["outcome"] == "yes"

    # One pool, one winner set: 9850 out of the 10000 staked, loser gets 0.
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid_yes)) == 9850
    direct_vm.sender = direct_bob
    assert int(contract.claim_winnings(bid_no)) == 0
    assert 9850 + 0 <= 6000 + 4000

# ── Payout safety: at most once ───────────────────────────────────
#
# Every payout leaves via emit_transfer(on='finalized'), whose child
# transaction runs after the state change commits. GenLayer exposes no
# delivery-status API for an emitted transfer, so the contract cannot learn
# whether a past emit landed — and the recipient's balance is not a
# substitute, because funds that arrive and are then spent are
# indistinguishable from funds that never arrived.
#
# So these tests never try to "prove" non-delivery. They prove the stronger
# structural property that makes proving it unnecessary: an entitlement is
# emitted exactly once, whatever the balance does afterwards. The decisive
# case is DELIVERED-THEN-SPENT, where the payee's balance ends up BELOW the
# amount received — precisely what a balance-delta check reads as "never
# delivered", and precisely how a duplicate payment used to happen.


def _capture_transfers(direct_vm, deliver=False):
    """Install a gl_call hook that records every PostMessage (value transfer).

    deliver=True simulates a successful settlement: the recipient's on-chain
    balance is credited with the transferred value. deliver=False leaves
    balances untouched, i.e. a transfer that was emitted but never landed.
    Either way the hook swallows the emit, so a test can then move balances
    around freely to model a payee who spends what they received.
    """
    emitted = []

    def hook(vm, request):
        if isinstance(request, dict) and "PostMessage" in request:
            e = request["PostMessage"]
            emitted.append(e)
            if deliver:
                key = _addr_bytes(e["address"])
                vm._balances[key] = vm._balances.get(key, 0) + int(e["value"])
            return {"ok": None}
        return None

    direct_vm._gl_call_hook = hook
    return emitted


def _payouts_to(emitted, addr):
    return [e for e in emitted if str(e["address"]).lower() == _hex(addr).lower()]


def _emits_of(emitted, addr, value):
    """Emits to `addr` carrying exactly `value` — used when other emits (e.g.
    the platform fee) also land on the same address and must not be confused
    with entitlement transfers."""
    addr_hex = _hex(addr).lower()
    return [e for e in emitted
            if str(e["address"]).lower() == addr_hex and int(e["value"]) == value]


def _balance(direct_vm, addr):
    return int(direct_vm._balances.get(_addr_bytes(addr), 0))


def _set_balance(direct_vm, addr, value):
    """Drive the payee's balance to exactly `value`.

    This is how a real recipient's balance stops reflecting a payout they
    already received: they spend it, or unrelated value moves through the
    account in either direction.
    """
    direct_vm._balances[_addr_bytes(addr)] = int(value)


def _resolved_yes_market(direct_vm, contract, stake=1000, bettor=None, counter=None):
    """One YES bettor, market resolved YES, payouts unlocked. Yields (mid, bet_id).

    `counter` is an optional (address, amount, side) placed before the market
    locks, for cases that need a second pool participant.
    """
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = bettor
    direct_vm.value = stake
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    if counter is not None:
        who, amount, side = counter
        direct_vm.sender = who
        direct_vm.value = amount
        contract.place_bet(mid, side)
        direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    _past_dispute_window(direct_vm)
    return mid, bid


def test_delivered_payout_is_emitted_once_and_kept_that_way(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Case 1 of 3 — the transfer lands and the payee keeps the funds.

    This is the only shape a balance check could ever read correctly, and it
    must not be what makes the payout safe. Exactly one emit is ever possible,
    whether or not anyone reports anything.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert _balance(direct_vm, direct_alice) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # A non-delivery report is still accepted as a claim — it moves no money.
    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    b = contract.get_bet(bid)
    assert b["non_delivery_reported"] is True
    assert b["payout_status"] == "attempted"
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Confirmation closes it and clears the report.
    assert contract.confirm_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "delivered"
    assert contract.get_bet(bid)["non_delivery_reported"] is False
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Terminal: nothing re-opens a delivered entitlement.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("No unconfirmed payout to confirm"):
        contract.confirm_payout(bid)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("No open payout to write off"):
        contract.write_off_payout(bid)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_delivered_payout_then_spent_is_never_emitted_again(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Case 2 of 3 — THE decisive case: the transfer lands, then the payee
    spends it.

    The balance now sits BELOW the amount received, which is exactly what a
    balance-delta check cannot tell apart from "the transfer never arrived".
    A retry gated on that reading pays a second time to a payee who was
    already paid. Here the payout is emitted once and stays that way: through
    the report, through the write-off that pays nothing, and through a later
    balance that climbs to an enormous figure.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert _balance(direct_vm, direct_alice) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # The payee moves the money on. Their balance is now BELOW the amount
    # received — the precise shape a "balance did not grow" rule misreads as a
    # failed transfer.
    _set_balance(direct_vm, direct_alice, 0)
    assert _balance(direct_vm, direct_alice) < 985

    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["non_delivery_reported"] is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Neither closing route may mint a second payment.
    direct_vm.sender = direct_owner
    assert contract.write_off_payout(bid) is True      # accounting only
    assert contract.get_bet(bid)["payout_status"] == "written_off"
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert _balance(direct_vm, direct_alice) == 0

    # ...and no later balance movement can re-open it either.
    _past_settle_grace(direct_vm, "2025-01-03T01:00:01Z")
    _set_balance(direct_vm, direct_alice, 10 ** 30)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert _balance(direct_vm, direct_alice) == 10 ** 30


def test_no_payee_balance_shape_can_unlock_a_second_payout(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Balance sweep: whatever the payee's balance reads, one emit.

    A delivered payout is walked through every shape a payee can leave an
    account in — fully spent, partly spent, replenished above the amount
    received, dust, enormous. Some of those shapes a balance-delta check would
    have called "not delivered" and paid again; others it would have called
    "delivered" and blocked. The emit count never leaves 1 either way, and the
    entitlement survives every one of these shapes still open.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 1

    shapes = [0, 1, 500, 984, 985, 1970, 10 ** 6, 10 ** 30]
    for i, shape in enumerate(shapes):
        # The balance is driven to `shape` after the payout landed.
        _set_balance(direct_vm, direct_alice, shape)
        assert _balance(direct_vm, direct_alice) == shape

        # Each pass re-files the report, so every shape is tested against the
        # full report path rather than a single observation.
        _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
        direct_vm.sender = direct_alice
        assert contract.report_failed_payout(bid) is True
        assert contract.get_bet(bid)["non_delivery_reported"] is True
        assert len(_payouts_to(emitted, direct_alice)) == 1

        direct_vm.sender = direct_owner
        # The owner could close the books at any point in the sweep and still
        # never pay — which is exactly why the emit count is 1 throughout.
        assert contract.get_bet(bid)["payout_status"] == "attempted"
        assert len(_payouts_to(emitted, direct_alice)) == 1

    # The entitlement was never closed out by any of it, and closing it now
    # still moves no money.
    direct_vm.sender = direct_owner
    assert contract.write_off_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "written_off"
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_failed_payout_is_never_re_emitted_and_can_be_closed(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Case 3 of 3 — the transfer genuinely fails.

    With no delivery-status API and no trustworthy balance signal, the
    contract cannot tell this apart from a transfer the payee went on to
    spend. So it must not guess, and must not pay twice. The failed attempt
    stays visible and closable, and the entitlement is emitted exactly once.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=False)   # never lands
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    b = contract.get_bet(bid)
    assert b["payout_status"] == "attempted" and b["payout"] == 985
    assert _balance(direct_vm, direct_alice) == 0
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # The payee's report is recorded, and moves no money.
    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["non_delivery_reported"] is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # The owner closes the books without paying — the write-off is the honest
    # outcome for an attempt that provably never landed, and it issues no
    # replacement transfer.
    direct_vm.sender = direct_owner
    assert contract.write_off_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "written_off"
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert _balance(direct_vm, direct_alice) == 0

    # Written off is terminal, and no amount of balance movement revives it.
    _past_settle_grace(direct_vm, "2025-01-03T01:00:01Z")
    _set_balance(direct_vm, direct_alice, 10 ** 30)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("No unconfirmed payout to confirm"):
        contract.confirm_payout(bid)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("No open payout to write off"):
        contract.write_off_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_contract_exposes_no_method_that_can_re_emit(
    direct_vm, direct_deploy, direct_owner
):
    """The at-most-once guarantee is structural, not conditional.

    There is no re-emit entry point to gate in the first place: the
    balance-delta evidence, its verifier/guardian machinery, and every
    recovery method built on them are gone. Reintroducing a duplicate payment
    would require adding a method back, not weakening a check — so there is no
    threshold a future edit can quietly lower.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    for name in (
        "recover_payout", "recover_refund", "recover_funding_refund",
        "authorize_recovery", "reject_recovery",
        "authorize_funding_recovery", "reject_funding_recovery",
        "set_recovery_guardian",
    ):
        assert not hasattr(contract, name), name


def test_non_delivery_report_is_payee_only_and_grace_gated(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """Reporting stays the payee's alone, and inside the settle grace it is
    noise rather than evidence — a fresh emit could still land, so the report
    waits instead of flagging a race."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=False)
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985

    # Inside the grace the transfer may still be in flight.
    with direct_vm.expect_revert("Transfer still settling"):
        contract.report_failed_payout(bid)

    # Nobody may file it for the payee — the owner included.
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Only the payee can report non-delivery"):
        contract.report_failed_payout(bid)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the payee can report non-delivery"):
        contract.report_failed_payout(bid)

    # Past the grace the payee's own report is accepted — and still pays
    # nothing.
    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    direct_vm.sender = direct_alice
    assert contract.report_failed_payout(bid) is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Repeating it is harmless: the flag is already set and no money moves.
    _past_settle_grace(direct_vm, "2025-01-03T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_write_off_is_owner_only_and_never_pays(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """The write-off is accounting, so it is owner-gated — and it must never
    become a back door to the money, which is why it carries no value path at
    all. The payee can confirm their own delivery but cannot write off."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=False)
    _mid, bid = _resolved_yes_market(direct_vm, contract, bettor=direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only owner"):
        contract.write_off_payout(bid)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only owner"):
        contract.write_off_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1

    direct_vm.sender = direct_owner
    assert contract.write_off_payout(bid) is True
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert _balance(direct_vm, direct_alice) == 0


def test_owner_as_payee_gets_exactly_one_payout(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The owner-bettor is the self-dealing case, and it is now moot by
    construction: the owner cannot report for them, verify for them, or pay
    them twice — only close the books. The platform fee and the entitlement
    are separate emits, so count the entitlement alone."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(
        direct_vm, contract, stake=1000, bettor=direct_owner,
        counter=(direct_alice, 1000, "no"),
    )

    direct_vm.sender = direct_owner
    assert int(contract.claim_winnings(bid)) == 1970
    assert len(_emits_of(emitted, direct_owner, 1970)) == 1

    # The owner can report as the payee; it pays nothing.
    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    assert len(_emits_of(emitted, direct_owner, 1970)) == 1

    # And can write the entitlement off — which also issues no transfer.
    assert contract.write_off_payout(bid) is True
    assert len(_emits_of(emitted, direct_owner, 1970)) == 1

    # The market outcome is untouched by any of it.
    assert contract.get_market(_mid)["outcome"] == "yes"


def test_void_refund_emitted_once_even_when_spent(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Same at-most-once guarantee on the voided-market refund path, with the
    payee spending the refund before reporting."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1200
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    emitted = _capture_transfers(direct_vm, deliver=True)
    direct_vm.sender = direct_alice
    assert contract.refund_void(bid) is True
    assert _balance(direct_vm, direct_alice) == 1200
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Spent straight back out — the shape that used to unlock a second refund.
    _set_balance(direct_vm, direct_alice, 7)
    _past_settle_grace(direct_vm, "2025-01-01T00:00:00Z")
    assert contract.report_failed_payout(bid) is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    assert contract.confirm_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "delivered"
    assert len(_payouts_to(emitted, direct_alice)) == 1
    with direct_vm.expect_revert("Already claimed"):
        contract.refund_void(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_funding_refund_emitted_once_even_when_spent(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """And on the funding-refund path: a delivered refund that the funder
    spends down cannot be refunded a second time, at any balance."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 600
    contract.fund_market(mid)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    emitted = _capture_transfers(direct_vm, deliver=True)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 600
    assert _balance(direct_vm, direct_alice) == 600
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Funder spends it all, then receives unrelated value.
    _set_balance(direct_vm, direct_alice, 0)
    _past_settle_grace(direct_vm, "2025-01-01T00:00:00Z")
    assert contract.report_failed_funding_refund(fids[0]) is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    direct_vm.sender = direct_owner
    assert contract.write_off_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refund_status"] == "written_off"
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # A second refund is refused outright, whatever the balance says.
    _set_balance(direct_vm, direct_alice, 10 ** 30)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Refund already requested"):
        contract.refund_funding(fids[0])
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert _balance(direct_vm, direct_alice) == 10 ** 30


def test_failed_funding_refund_is_written_off_not_re_sent(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """A funding refund that genuinely fails is flagged and closed, never
    re-sent — the deposit is recorded on-chain the whole time, so it is
    never an anonymous, unrecoverable transfer."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 500
    contract.fund_market(mid)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    emitted = _capture_transfers(direct_vm, deliver=False)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 500
    f = contract.get_funding(fids[0])
    assert f["refunded"] is False and f["refund_status"] == "attempted"
    assert len(_payouts_to(emitted, direct_alice)) == 1

    _past_settle_grace(direct_vm, "2025-01-01T00:00:00Z")
    assert contract.report_failed_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["non_delivery_reported"] is True
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # Confirmation clears the report; the write-off closes without paying.
    direct_vm.sender = direct_owner
    assert contract.write_off_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refund_status"] == "written_off"
    assert contract.get_funding(fids[0])["refunded"] is False
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_funding_refund_report_is_funder_only(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    """Nobody but the funder may flag a refund as undelivered, and nobody —
    the owner included — can turn that flag into a payment."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 400
    contract.fund_market(mid)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    emitted = _capture_transfers(direct_vm, deliver=False)
    direct_vm.sender = direct_alice
    contract.refund_funding(fids[0])

    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Only the funder can report non-delivery"):
        contract.report_failed_funding_refund(fids[0])
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the funder can report non-delivery"):
        contract.report_failed_funding_refund(fids[0])
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Not authorized"):
        contract.confirm_funding_refund(fids[0])
    assert len(_payouts_to(emitted, direct_alice)) == 1


def test_fund_market_records_entitlement_and_void_refunds(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """`fund_market` records a redeemable entitlement per deposit, so a
    voided market returns the liquidity instead of locking it away — emitted
    exactly once, and consumed only once delivery is confirmed."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 500
    assert contract.fund_market(mid) is True
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    assert len(fids) == 1
    f = contract.get_funding(fids[0])
    assert f["amount"] == 500
    assert f["funder"].lower() == _hex(direct_alice).lower()
    assert f["refunded"] is False
    odds = contract.get_odds(mid)
    assert odds["pool_yes"] + odds["pool_no"] == 500
    with direct_vm.expect_revert("Funding not refundable yet"):
        contract.refund_funding(fids[0])
    direct_vm.sender = direct_owner
    contract.void_market(mid)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 500
    # Not consumed before delivery: `refunded` stays False until confirmed.
    assert contract.get_funding(fids[0])["refunded"] is False
    assert contract.get_funding(fids[0])["refund_status"] == "attempted"
    with direct_vm.expect_revert("Refund already requested"):
        contract.refund_funding(fids[0])
    assert contract.confirm_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refunded"] is True
    assert contract.get_funding(fids[0])["refund_status"] == "delivered"
    with direct_vm.expect_revert("Already refunded"):
        contract.refund_funding(fids[0])


def test_refund_funding_rejects_non_funder(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 400
    contract.fund_market(mid)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    direct_vm.sender = direct_owner
    contract.void_market(mid)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Not your funding"):
        contract.refund_funding(fids[0])