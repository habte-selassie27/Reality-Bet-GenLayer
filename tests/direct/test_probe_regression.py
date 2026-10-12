"""Reproduction of the reported failed-transfer recovery flaw.

The payout lands, the payee spends it, and the contract's delivery check
re-reads the payee's balance against the baseline recorded before the emit.
A balance that has since been spent sits BELOW that baseline, which is
indistinguishable from a transfer that never arrived — so the full recovery
protocol pays the payee a second time.

This test asserts the CURRENT (defective) behaviour. It is the evidence that
the delivered-then-spent path really does double-pay; it is removed in the
same series as the fix.
"""
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from test_realitybet import (  # noqa: E402
    _addr_bytes, _capture_transfers, _hex, _make_market, _mock_resolution,
    _past_dispute_window, _past_settle_grace, _payouts_to, _RESOLVED_AT, _ts,
)


def _balance(vm, addr):
    return int(vm._balances.get(_addr_bytes(addr), 0))


def _set_balance(vm, addr, value):
    """The payee moves the money on: their balance stops showing the payout."""
    vm._balances[_addr_bytes(addr)] = int(value)


def _resolved_yes_market(vm, contract, bettor):
    vm.warp("2025-01-01T00:00:00Z")
    now = _ts("2025-01-01T00:00:00Z")
    mid = _make_market(contract, now + 1000, now + 2000)
    vm.sender = bettor
    vm.value = 1000
    bid = contract.place_bet(mid, "yes")
    vm.value = 0
    vm.warp("2025-01-01T00:20:00Z")
    contract.lock_market(mid)
    vm.warp(_RESOLVED_AT)
    _mock_resolution(vm, "yes")
    contract.request_resolution(mid)
    _past_dispute_window(vm)
    return mid, bid


def test_recover_payout_double_pays_after_the_payee_spends(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The transfer DELIVERS, the payee spends it, and recovery pays them again."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(direct_vm, contract, direct_alice)

    # The payout lands: 985 credited to the bettor.
    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert _balance(direct_vm, direct_alice) == 985
    assert len(_payouts_to(emitted, direct_alice)) == 1

    # The bettor spends it. Balance is now BELOW the amount received — the
    # exact shape the balance check reads as "the transfer never landed".
    _set_balance(direct_vm, direct_alice, 0)

    # The full recovery protocol: payee report -> owner authorization -> retry.
    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid) is True
    direct_vm.sender = direct_alice
    assert int(contract.recover_payout(bid)) == 985

    # DUPLICATE PAYMENT: one 985 entitlement, two 985 transfers.
    assert len(_payouts_to(emitted, direct_alice)) == 2
    assert sum(int(e["value"]) for e in _payouts_to(emitted, direct_alice)) == 1970


def test_recover_payout_is_blocked_only_while_funds_are_credited(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    """The only case the balance check ever handled: funds still credited."""
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/RealityBet.py")
    emitted = _capture_transfers(direct_vm, deliver=True)
    _mid, bid = _resolved_yes_market(direct_vm, contract, direct_alice)

    direct_vm.sender = direct_alice
    assert int(contract.claim_winnings(bid)) == 985
    assert _balance(direct_vm, direct_alice) == 985

    _past_settle_grace(direct_vm, "2025-01-02T01:00:01Z")
    assert contract.report_failed_payout(bid) is True
    direct_vm.sender = direct_owner
    assert contract.authorize_recovery(bid) is True
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Delivery observed on-chain"):
        contract.recover_payout(bid)
    assert len(_payouts_to(emitted, direct_alice)) == 1