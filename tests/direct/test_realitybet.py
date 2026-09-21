import json
from datetime import datetime, timezone


def _ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _make_market(contract, close_ts, resolve_ts):
    return contract.create_market(
        "Will BTC close above $100k on Dec 31 2025?",
        "Resolves YES if BTC closes above 100k.",
        "https://coinmarketcap.com/currencies/bitcoin/",
        "crypto",
        close_ts,
        resolve_ts,
    )


def _setup_open_market(direct_vm, contract):
    direct_vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    return _make_market(contract, now + 1000, now + 2000)


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
    assert contract.get_market(mid)["outcome"] == "yes"
    direct_vm.sender = direct_alice
    payout = int(contract.claim_winnings(bid_yes))
    # gross=(6000*10000)//6000=10000, fee=10000*150//10000=150, net=9850
    assert payout == 9850


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
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 5000
