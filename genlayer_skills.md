# GenLayer Intelligent Contract Building Skills — Official Reference
> Source: `genlayer-dev@genlayerlabs` plugin (`/plugin install genlayer-dev@genlayerlabs`)
> Use this file as the authoritative checklist when writing, linting, testing, and deploying GenLayer Intelligent Contracts (e.g. RealityBet).

## 0. Plugin Install

```bash
# Step 1 — add marketplace (Claude Code)
/plugin marketplace add genlayerlabs/skills
# Codex alternative:
# codex plugin marketplace add genlayerlabs/skills

# Step 2 — install build plugin
/plugin install genlayer-dev
# Or for validator ops:
/plugin install genlayernode
# Codex: enable from plugin menu
```

Build plugins: Write Contract, GenVM Lint, Direct Tests, Integration Tests, GenLayer CLI.
Operate plugins: Validator Node Setup, Validator Management.

---

## 1. Write Contract (core skill)

Python classes that run on GenVM with built-in AI (LLM + web) capabilities.

### 1.1 Critical: Pin the Runner Version

All GenLayer networks **reject** `py-genlayer:test`, `py-genlayer:latest`, and unversioned runner aliases. Every generated contract **must start** with a pinned runner dependency header:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

- `test` and `latest` are local-development aliases for GenLayer runtime developers only.
- They may work only in a specially configured local Studio environment with a GenLayer developer env var, but they do not work on GenLayer networks and must not appear in generated user contracts.

Before returning any contract code, verify:

- [ ] First line is a pinned `Depends` runner version hash
- [ ] No `py-genlayer:test`
- [ ] No `py-genlayer:latest`
- [ ] No unversioned `py-genlayer`

### 1.2 What It Covers

- **Architecture Fit** — Decide whether GenLayer should own the consensus/settlement step or whether the work belongs in frontend/backend/off-chain LLM.
- **Runner Header** — Pinned `py-genlayer` hashes are mandatory.
- **Equivalence Principle** — Critical decision: `strict_eq` for deterministic calls, independent verification for LLM/web operations.
- **Validator Consensus** — Schema-only validators are rejected as an anti-pattern; validators must rerun, derive, compare, or verify against source data.
- **Storage Rules** — `TreeMap` instead of `dict`, `DynArray` instead of `list`, `u256` for money.
- **LLM Resilience** — Defensive parsing, key variation handling, aggressive coercion, JSON response format.
- **Cross-Contract Calls** — Synchronous reads, async writes with `emit()`, factory patterns.
- **Error Classification** — `[EXPECTED]`, `[EXTERNAL]`, `[TRANSIENT]`, `[LLM_ERROR]` each with distinct validator behavior.

### 1.3 Contract Skeleton

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

@gl.contract
class MyContract:
    owner: Address
    items: TreeMap[str, Item]

    def __init__(self):
        self.owner = gl.message.sender_account

    @gl.public.view
    def get_item(self, item_id: str) -> dict:
        return {"id": item_id}

    @gl.public.write
    def set_item(self, item_id: str, value: str):
        if gl.message.sender_account != self.owner:
            raise gl.UserError("Only owner")
```

Notes:
- Storage fields: only `TreeMap`, `DynArray`, `Address`, `u256`, `str`, `bool`, dataclasses. Never `dict`/`list` in state.
- Money: `u256` atto-scale. Never `float`.
- Dataclass evolution: always append new fields at END, never insert in middle.
- Decorators: `@gl.public.view` for reads, `@gl.public.write` for writes. Missing/incorrect decorators fail lint.

### 1.4 Runner Dependencies

| Contract Type | Dependency |
|---|---|
| Single-file Python | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Multi-file Python package | `py-genlayer-multi:06zyvrlivjga0d5jlpdbprksc0pa6jmllxvp8s20hq1l512vh5yk` |
| Embeddings / semantic search | Add `py-lib-genlayer-embeddings:0bmbm3cyfwxsyh454z53vxqjf47wz2q7smcqp1q4g4a6k2kidnyk` before `py-genlayer` in a `Seq` block |

### 1.5 Anti-Patterns (must never generate)

- `py-genlayer:test`, `py-genlayer:latest`, or unversioned `py-genlayer`
- `strict_eq()` for LLM calls — LLM outputs are non-deterministic
- Schema-only validators for LLM/web output — format checks do not verify the leader's answer
- `prompt_non_comparative` for classification/scoring/extraction decisions — use comparative validation, decisions need substantive agreement
- `dict` / `list` for storage — use `TreeMap` / `DynArray`
- `float` for money — use atto-scale `u256`
- Inserting fields in middle of dataclass — always append at END

Part of the `genlayer-dev` plugin. Install with `/plugin install genlayer-dev@genlayerlabs`.

---

## 2. GenVM Lint

Static analysis and validation. Always lint before testing.

### Commands

| Command | What It Does | Speed |
|---|---|---|
| `genvm-lint check` | Lint + validate (recommended) | ~250ms |
| `genvm-lint lint` | AST checks only | ~50ms |
| `genvm-lint validate` | SDK semantic checks | ~200ms |
| `genvm-lint schema` | Extract ABI | ~100ms |
| `genvm-lint typecheck` | Pyright/Pylance type checking | ~1s |

### What It Catches

- Forbidden imports: `os`, `sys`, `subprocess`, `random`
- Non-deterministic patterns: bare `float` operations
- Type validity: `TreeMap`, `DynArray`, `Address` usage
- Decorator correctness: `@gl.public.view`, `@gl.public.write`
- Storage field types: no `dict`/`list` in state

### Agent Workflow

1. Run `check` with `--json`
2. Parse errors
3. Fix iteratively
4. Re-run until `ok=true`

### Exit Codes

- `0` — All checks passed
- `1` — Lint or validation errors
- `2` — Contract file not found
- `3` — SDK download failed

Install: `pip install genvm-linter`

---

## 3. Direct Tests

Fast, in-memory tests. No server, no Docker, no consensus — pure logic at ~30ms per test.

### Running

```bash
pytest tests/direct/ -v
pytest tests/direct/test_specific.py::test_one -v
```

### Basic Pattern

```python
def test_set_and_get(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/my_contract.py")
    direct_vm.sender = direct_alice
    contract.set_data("hello")
    result = contract.get_data(direct_alice)
    assert result == "hello"
```

### Fixtures

| Fixture | Purpose |
|---|---|
| `direct_vm` | VMContext with cheatcodes |
| `direct_deploy` | Deploy contract function |
| `direct_alice`, `direct_bob`, `direct_charlie` | Test addresses |
| `direct_owner` | Owner address |

### Cheatcodes

- `direct_vm.sender = address` — Set transaction sender
- `direct_vm.expect_revert("msg")` — Expect a revert
- `direct_vm.prank(address)` — Temporary sender change
- `direct_vm.snapshot() / revert(id)` — State snapshots
- `direct_vm.warp("2024-06-01T12:00:00Z")` — Time travel
- `direct_vm.mock_web(regex, response)` — Mock HTTP calls
- `direct_vm.mock_llm(regex, response)` — Mock LLM calls

> Important: Direct mode runs the leader function only. Validator logic is not exercised. Use integration tests for consensus validation.

---

## 4. Integration Tests

Full consensus validation against real GenLayer environments — leader execution, validator verification, finalization.

### Running

```bash
gltest tests/integration/ -v -s
gltest tests/integration/ -v -s --network localnet
gltest tests/integration/ -v -s --network testnet_bradbury
```

### Test Pattern

```python
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

def test_full_flow():
    factory = get_contract_factory("MyContract")
    contract = factory.deploy(args=[])
    receipt = contract.set_data(args=["hello"]).transact()
    assert tx_execution_succeeded(receipt)
    result = contract.get_data(args=[contract.address]).call()
    assert result == "hello"
```

### Lifecycle vs Execution

`ACCEPTED` and `FINALIZED` are transaction lifecycle states, not proof that contract execution succeeded. A transaction can be accepted and finalized with an execution error, and failed execution applies no state changes. For deploy transactions, failed execution means no contract is created.

Always assert `tx_execution_succeeded(receipt)` before reading state, checking schema/code, or treating a missing contract as infra issue.

### Direct vs Integration

| Aspect | Direct | Integration |
|---|---|---|
| Speed | ~30ms | seconds–minutes |
| Server | No | Yes |
| Consensus | Leader only | Full + validators |
| Write methods | Return values | Return receipts |
| Mocking | Supported | Real calls |

### Environments

- GLSim — lightweight, Python natively
- Studio local — full GenVM, Docker required
- `studio.genlayer.com` — hosted, no setup, gasless, rate-limited
- Testnet Bradbury — real network, funded accounts

### Studio Rate Limits

`studio.genlayer.com` enforces per-IP limits: 60 req/min, 1000 req/hr, 10000 req/day. Hitting the limit returns HTTP 429 / `-32429`; wait for window reset, throttle batch tests, or use localnet for heavy suites.

`-32028` means pending queue full: up to 32 in-flight txs per sender, with separate per-contract cap. Wait for receipts instead of firing deploy/write txs in parallel.

When to use: validating consensus behavior, testing real web/LLM interactions, smoke tests before testnet deploy.

---

## 5. GenLayer CLI

Deploy, call, and debug intelligent contracts.

### Setup

```bash
npm install -g genlayer
```

### Core Commands

| Command | Purpose |
|---|---|
| `genlayer deploy --contract file.py` | Deploy a contract |
| `genlayer call` | Read (view) call |
| `genlayer write` | Write transaction |
| `genlayer receipt` | Get transaction receipt |
| `genlayer schema` | View contract ABI |
| `genlayer code` | View deployed source |

### Network Management

```bash
genlayer network set testnet-bradbury
genlayer network info
genlayer network list
```

Networks: `localnet`, `testnet-asimov`, `testnet-bradbury`, `mainnet`

### Studio Rate Limits

studionet is gasless but rate-limited per IP: 60 req/min, 1000 req/hr, 10000 req/day. Batch deploy/write scripts can trip HTTP 429 / `-32429`; wait for window reset, throttle submissions, or use localnet for heavy batches.

`-32028` = pending-queue cap: up to 32 in-flight txs per sender, plus separate per-contract cap. Wait for receipts between batches.

### Debugging Workflow

1. Get receipt: `genlayer receipt <txHash> --stdout --stderr`
2. Check execution result; `ACCEPTED`/`FINALIZED` can still contain execution errors
3. Check schema: `genlayer schema <address>`
4. Read source: `genlayer code <address>`
5. Try read: `genlayer call <address> <view_method>`
6. Appeal: `genlayer appeal <txHash>`

### Lifecycle vs Execution

`ACCEPTED` and `FINALIZED` mean the network accepted/finalized the transaction outcome. They do not mean contract code executed successfully. If deploy execution fails, no contract is created, so missing code/schema is expected until receipt shows execution success.

### Account Management

```bash
genlayer account create --name dev1
genlayer account use dev1
genlayer account list
genlayer account send 0x123...abc 10gen
```

---

## 6. Reference Deployments (Studio / Explorer)

Manually deployed contracts for evidence verifier, dispute, adversarial review, and consensus flows:

### Evidence Verifier

- Address: `0x913DE37be72E2D6C4Ad10AD853753C0a4cB2DfFE`
- Explorer: https://explorer-studio.genlayer.com/address/0x913DE37be72E2D6C4Ad10AD853753C0a4cB2DfFE
- Studio: https://studio.genlayer.com/?import-contract=0x913DE37be72E2D6C4Ad10AD853753C0a4cB2DfFE

### Dispute Engine

- Address: `0x9CAB521b93549C314E17a7Ed8ddEeA6BAd8f2662`
- Explorer: https://explorer-studio.genlayer.com/address/0x9CAB521b93549C314E17a7Ed8ddEeA6BAd8f2662
- Studio: https://studio.genlayer.com/?import-contract=0x9CAB521b93549C314E17a7Ed8ddEeA6BAd8f2662

### Adversarial Reviewer

- Address: `0xFB94C2A452ab97d45165B967715df988283C00A1`
- Explorer: https://explorer-studio.genlayer.com/address/0xFB94C2A452ab97d45165B967715df988283C00A1
- Studio: https://studio.genlayer.com/?import-contract=0xFB94C2A452ab97d45165B967715df988283C00A1

### Consensus Engine

- Address: `0xa0619c616895110FCa35f94136B46f60225c8974`
- Explorer: https://explorer-studio.genlayer.com/address/0xa0619c616895110FCa35f94136B46f60225c8974
- Studio: https://studio.genlayer.com/?import-contract=0xa0619c616895110FCa35f94136B46f60225c8974

---

## 7. RealityBet Checklist (apply these skills)

- [ ] Contract starts with pinned `py-genlayer` hash, uses `TreeMap`/`DynArray`/`u256`, no `dict`/`list`/`float` in storage
- [ ] LLM resolution uses comparative validation (not `strict_eq`, not schema-only, not `prompt_non_comparative`)
- [ ] Defensive LLM JSON parsing + low-confidence auto-void
- [ ] `genvm-lint check --json` passes (`ok=true`)
- [ ] Direct tests cover market lifecycle, betting, payouts, disputes (mock LLM/web)
- [ ] Integration tests assert `tx_execution_succeeded` before state reads
- [ ] Deploy via GenLayer CLI to `testnet-bradbury` / Studio, verify receipt stdout/stderr
