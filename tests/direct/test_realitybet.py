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


def _capture_transfers(direct_vm):
    """Install a gl_call hook that records every PostMessage (value transfer)."""
    emitted = []

    def hook(vm, request):
        if isinstance(request, dict) and "PostMessage" in request:
            emitted.append(request["PostMessage"])
            return {"ok": None}
        return None

    direct_vm._gl_call_hook = hook
    return emitted


def _payouts_to(emitted, addr):
    return [e for e in emitted if str(e["address"]).lower() == _hex(addr).lower()]


def test_fund_market_records_entitlement_and_void_recovers(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
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
    # Recovery without a request + owner authorization is rejected.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    assert contract.confirm_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refunded"] is True
    assert contract.get_funding(fids[0])["refund_status"] == "delivered"
    with direct_vm.expect_revert("Already refunded"):
        contract.refund_funding(fids[0])


def test_fund_market_void_outcome_resolution_recovers(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 700
    contract.fund_market(mid)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid)
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "void", "low")
    contract.request_resolution(mid)
    m = contract.get_market(mid)
    assert m["status"] == "resolved" and m["outcome"] == "void"
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 700


def test_failed_funding_refund_recovery_is_owner_gated(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
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

    emitted = _capture_transfers(direct_vm)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 600
    assert contract.get_funding(fids[0])["refunded"] is False
    assert contract.get_funding(fids[0])["refund_status"] == "attempted"
    assert len(emitted) == 1 and int(emitted[0]["value"]) == 600

    # A funder's own failure report moves no money: it only requests recovery.
    assert contract.report_failed_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refund_status"] == "recovery_requested"
    assert len(emitted) == 1

    # Recovery without the owner's on-chain authorization is rejected —
    # self-reported non-delivery can never trigger a re-emission.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    assert len(emitted) == 1

    # The owner separately verifies non-delivery (explorer/ledger balance)
    # and authorizes on-chain; the funder then gets exactly one recovery emit.
    direct_vm.sender = direct_owner
    assert contract.authorize_funding_recovery(fids[0], True) is True
    assert contract.get_funding(fids[0])["refund_status"] == "failed"
    assert contract.get_funding(fids[0])["authorized"] is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_funding_refund(fids[0])) == 600
    assert contract.get_funding(fids[0])["refund_status"] == "recovered"
    assert contract.get_funding(fids[0])["authorized"] is False  # spent
    assert len(emitted) == 2 and int(emitted[1]["value"]) == 600

    # The authorization is consumed: a second recovery is impossible even if
    # a "failed" status were left over, and nothing reopens without a fresh
    # owner gate.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    assert len(emitted) == 2

    # After delivery is confirmed the entitlement is fully consumed.
    assert contract.confirm_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refunded"] is True
    with direct_vm.expect_revert("Already refunded"):
        contract.refund_funding(fids[0])
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])


def test_owner_denial_returns_refund_to_attempted(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The owner's deny is also an independent verification: "the transfer did
    land" — and it reopens exactly the confirm-late-delivery path, nothing else."""
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
    direct_vm.sender = direct_alice
    contract.refund_funding(fids[0])
    contract.report_failed_funding_refund(fids[0])

    direct_vm.sender = direct_owner
    # Deny = "I verified the refund DID land" → back to attempted.
    assert contract.authorize_funding_recovery(fids[0], False) is True
    assert contract.get_funding(fids[0])["refund_status"] == "attempted"
    assert contract.get_funding(fids[0])["authorized"] is False

    # Denial authorizes nothing: recovery is still impossible.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])

    # ...but confirming a late delivery now works again.
    assert contract.confirm_funding_refund(fids[0]) is True
    assert contract.get_funding(fids[0])["refunded"] is True


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


def test_failed_payout_recovery_is_owner_gated(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """A self-reported delivery failure can never trigger a second payout.

    The bettor's report only *requests* recovery; the recorded entitlement is
    re-emitted solely after the owner independently verifies non-delivery
    (explorer/ledger balance) and authorizes it on-chain — and each
    authorization is spent by exactly one recovery transfer.
    """
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
    _past_dispute_window(direct_vm)

    emitted = _capture_transfers(direct_vm)
    direct_vm.sender = direct_alice
    payout = int(contract.claim_winnings(bid))
    assert payout == 985
    b = contract.get_bet(bid)
    assert b["claimed"] is True and b["payout"] == 985
    assert b["payout_status"] == "attempted"
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert int(_payouts_to(emitted, direct_alice)[0]["value"]) == 985

    # With no failure reported there is no recovery request: re-emission is
    # rejected, not silently allowed.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)

    # The bettor attests non-delivery — this moves NO money, it only flags
    # the entitlement as recovery_requested so the owner can review it.
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "recovery_requested"
    assert len(_payouts_to(emitted, direct_alice)) == 1  # nothing re-emitted

    # Recovery still rejected without the owner's separate authorization.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # The owner independently verifies non-delivery, then authorizes on-chain.
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    b = contract.get_bet(bid)
    assert b["payout_status"] == "failed"
    assert b["authorized"] is True

    # Now — and only now — the recorded entitlement is re-emitted exactly once.
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985
    b = contract.get_bet(bid)
    assert b["payout_status"] == "recovered"
    assert b["authorized"] is False  # authorization consumed by that one emit
    assert len(_payouts_to(emitted, direct_alice)) == 2
    assert int(_payouts_to(emitted, direct_alice)[1]["value"]) == 985

    # The spent authorization cannot be reused: a second recovery is rejected
    # even though the transfer is in "recovered".
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 2

    # Once delivery is confirmed the entitlement is locked against replays.
    assert contract.confirm_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "delivered"
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(bid)


def test_owner_cannot_authorize_without_a_request(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The authorization gate is never a bypass: it only decides a *pending*
    payee request, so the owner cannot authorize a transfer nobody reported —
    and cannot unilaterally re-open an attempted transfer either."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 900
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    direct_vm.warp(_RESOLVED_AT)
    _mock_resolution(direct_vm, "yes")
    contract.request_resolution(mid)
    _past_dispute_window(direct_vm)
    direct_vm.sender = direct_alice
    contract.claim_winnings(bid)  # attempted, no request filed

    # Owner cannot authorize a recovery that was never requested.
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("No recovery requested for this payout"):
        contract.authorize_recovery(bid, True)


def test_failed_refund_recovery_is_owner_gated(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Same two-party gate on the voided-market refund path."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    mid = _setup_open_market(direct_vm, contract)
    direct_vm.sender = direct_alice
    direct_vm.value = 1200
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    emitted = _capture_transfers(direct_vm)
    direct_vm.sender = direct_alice
    assert contract.refund_void(bid) is True
    assert contract.get_bet(bid)["payout"] == 1200
    assert contract.get_bet(bid)["payout_status"] == "attempted"
    assert len(emitted) == 1 and int(emitted[0]["value"]) == 1200

    # The bettor's report only requests recovery — no transfer is re-emitted.
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "recovery_requested"
    assert len(emitted) == 1

    # Without the owner's authorization there is no recovery emit.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_refund(bid)
    assert len(emitted) == 1

    # The owner verifies non-delivery and authorizes; exactly one re-emission.
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_refund(bid)) == 1200
    assert contract.get_bet(bid)["payout_status"] == "recovered"
    assert contract.get_bet(bid)["authorized"] is False
    assert len(emitted) == 2 and int(emitted[1]["value"]) == 1200

    # The spent authorization cannot be reused.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_refund(bid)
    assert len(emitted) == 2

    # Confirming delivery locks the entitlement for good.
    assert contract.confirm_payout(bid) is True
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("Already claimed"):
        contract.refund_void(bid)


def test_payee_cannot_self_authorized_recovery_on_any_path(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """Fraud matrix: no payee-only action sequence on any of the three transfer
    paths can produce more than the original single emission. Every re-emission
    requires an owner authorization that only verifies non-delivery — modeled
    here as the owner's on-chain decision after the payee request."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm)

    # ── payout path ───────────────────────────────────────────────
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
    _past_dispute_window(direct_vm)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985

    # The entire payee-only toolset can never move a second transfer: a
    # report only flags recovery_requested (repeat reports revert), recovery
    # without authorization reverts, and the payee cannot self-authorize.
    assert contract.report_failed_payout(bid) is True
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)  # already requested
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    with direct_vm.expect_revert("Only owner"):
        contract.authorize_recovery(bid, True)  # payee can't self-authorize
    assert len(_payouts_to(emitted, direct_alice)) == 1
    assert contract.get_bet(bid)["payout_status"] == "recovery_requested"

    # ...and the owner, exercising independent verification, can unlock the
    # single recovery the report requested. The authorization is then spent.
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 2
    assert contract.get_bet(bid)["authorized"] is False

    # A second cycle needs a NEW report AND a NEW owner verification, one
    # authorization per re-emitted transfer — never a runaway replay loop.
    assert contract.report_failed_payout(bid) is True
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 3
    # ...and the same spent-authorization rule still binds afterwards.
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 3

    # ── voided-market refund path ─────────────────────────────────
    direct_vm.warp("2025-01-03T00:00:00Z")
    now = _ts("2025-01-03T00:00:00Z")
    mid2 = _make_market(contract, now + 1000, now + 2000)
    direct_vm.sender = direct_alice
    direct_vm.value = 800
    bid2 = contract.place_bet(mid2, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.void_market(mid2)
    direct_vm.sender = direct_alice
    assert contract.refund_void(bid2) is True

    # Payee-only sequence: report and recover all rejected. (Count includes
    # the refund's original emission, so 4 right now.)
    assert contract.report_failed_payout(bid2) is True
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_refund(bid2)
    assert len(_payouts_to(emitted, direct_alice)) == 4

    # The report is honored only after the owner verifies non-delivery.
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid2, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_refund(bid2)) == 800
    assert contract.get_bet(bid2)["authorized"] is False
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_refund(bid2)
    assert len(_payouts_to(emitted, direct_alice)) == 5

    # ── funding refund path ───────────────────────────────────────
    direct_vm.warp("2025-01-05T00:00:00Z")
    now = _ts("2025-01-05T00:00:00Z")
    mid3 = _make_market(contract, now + 1000, now + 2000)
    direct_vm.sender = direct_alice
    direct_vm.value = 300
    contract.fund_market(mid3)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid3)
    direct_vm.sender = direct_owner
    contract.void_market(mid3)
    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 300
    assert contract.report_failed_funding_refund(fids[0]) is True
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    direct_vm.sender = direct_owner
    assert contract.authorize_funding_recovery(fids[0], True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_funding_refund(fids[0])) == 300
    assert contract.get_funding(fids[0])["authorized"] is False
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    assert len(_payouts_to(emitted, direct_alice)) == 7

    # The market outcome itself is untouched by all of this.
    assert contract.get_market(mid)["outcome"] == "yes"
    assert contract.get_market(mid2)["status"] == "voided"
    assert contract.get_market(mid3)["status"] == "voided"


def test_owner_authorization_gates_every_recovery(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The two-party protocol in full: payee request, owner verification,
    single re-emission, repeatable only through the same gate.

    A transfer that fails twice is never stranded: the owner simply authorizes
    a second cycle after verifying the second failure too. What no payee can
    ever do is shortcut the gate — which is why no self-reported failure can
    mint a second payout or refund.
    """
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm)

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
    _past_dispute_window(direct_vm)

    # Attempt 1 fails → payee report (request only) → owner verifies and
    # authorizes → recovery emits attempt 2, which fails too.
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "recovery_requested"
    assert len(_payouts_to(emitted, direct_alice)) == 1

    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985          # attempt 2
    assert contract.get_bet(bid)["payout_status"] == "recovered"
    assert contract.get_bet(bid)["authorized"] is False      # spent
    assert len(_payouts_to(emitted, direct_alice)) == 2

    # Double-failed: the payee reports again, but the report alone still moves
    # nothing — recovery stays gated.
    assert contract.report_failed_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "recovery_requested"
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 2

    # The owner verifies the second failure and authorizes again.
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985          # attempt 3
    assert contract.get_bet(bid)["payout_status"] == "recovered"
    assert contract.get_bet(bid)["authorized"] is False
    assert len(_payouts_to(emitted, direct_alice)) == 3

    # Each further failure needs a fresh request plus a fresh owner
    # verification — never stuck, never self-serve.
    assert contract.report_failed_payout(bid) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985          # attempt 4
    assert len(_payouts_to(emitted, direct_alice)) == 4

    # Confirming delivery still closes the entitlement for good — no owner
    # path or payee report can ever re-open a delivered transfer.
    assert contract.confirm_payout(bid) is True
    assert contract.get_bet(bid)["payout_status"] == "delivered"
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("No recovery requested for this payout"):
        contract.authorize_recovery(bid, True)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No unconfirmed payout to report"):
        contract.report_failed_payout(bid)
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_payout(bid)


def test_owner_authorization_gates_refunds_too(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The same two-party protocol on the other two transfer paths: a
    voided-market refund and a funding refund that each fail twice are never
    stranded (the owner re-authorizes after each verified failure), while the
    payee alone can never move money past the original emit."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm)

    # ── voided-market refund path (recover_refund) ───────────────
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    mid = _make_market(contract, now + 1000, now + 2000)
    direct_vm.sender = direct_alice
    direct_vm.value = 800
    bid = contract.place_bet(mid, "yes")
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.void_market(mid)

    direct_vm.sender = direct_alice
    assert contract.refund_void(bid) is True                  # attempt 1
    assert contract.report_failed_payout(bid) is True         # request only
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_refund(bid)) == 800           # attempt 2
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_refund(bid)

    # Second failure: request again, owner verifies and authorizes again.
    assert contract.report_failed_payout(bid) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid, True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_refund(bid)) == 800           # attempt 3
    assert len(_payouts_to(emitted, direct_alice)) == 3

    # ── funding refund path (report_failed_funding_refund) ───────
    direct_vm.warp("2025-01-03T00:00:00Z")
    now2 = _ts("2025-01-03T00:00:00Z")
    mid2 = _make_market(contract, now2 + 1000, now2 + 2000)
    direct_vm.sender = direct_alice
    direct_vm.value = 300
    contract.fund_market(mid2)
    direct_vm.value = 0
    fids = contract.get_market_fundings(mid2)
    direct_vm.sender = direct_owner
    contract.void_market(mid2)

    direct_vm.sender = direct_alice
    assert int(contract.refund_funding(fids[0])) == 300       # attempt 1
    assert contract.report_failed_funding_refund(fids[0]) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_funding_recovery(fids[0], True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_funding_refund(fids[0])) == 300  # attempt 2
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])

    # Second failure: request again, owner verifies and authorizes again.
    assert contract.report_failed_funding_refund(fids[0]) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_funding_recovery(fids[0], True) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_funding_refund(fids[0])) == 300  # attempt 3
    assert contract.get_funding(fids[0])["refund_status"] == "recovered"
    assert len(_payouts_to(emitted, direct_alice)) == 6

    # The funder alone still cannot authorize — the gate is owner-only.
    assert contract.report_failed_funding_refund(fids[0]) is True
    with direct_vm.expect_revert("Only owner"):
        contract.authorize_funding_recovery(fids[0], True)
    with direct_vm.expect_revert("Recovery not authorized by owner"):
        contract.recover_funding_refund(fids[0])
    assert len(_payouts_to(emitted, direct_alice)) == 6
