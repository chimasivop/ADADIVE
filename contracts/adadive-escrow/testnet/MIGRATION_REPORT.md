# ADADIVE Escrow — PyCardano E2E Migration Report

**Session date:** 2026-07-07  
**Branch to create:** `feat/pycardano-e2e-scripts`  
**Reason for migration:** Replit bash sandbox hit `fork: Resource temporarily unavailable`
(ulimit -u exhausted); git commit/push could not be executed from within Replit.

---

## 1. Files Created This Session

All files were written and confirmed saved by the Replit write tool.

### New Python E2E scripts

| File | Lines | Purpose |
|------|-------|---------|
| `contracts/adadive-escrow/testnet/common.py` | 257 | Shared helpers: Blockfrost context, wallet loading, datum/redeemer builders, slot conversion, UTxO scanner |
| `contracts/adadive-escrow/testnet/00_setup_wallets.py` | 98 | Generate client/provider/oracle PaymentKeyPair keypairs |
| `contracts/adadive-escrow/testnet/01_lock.py` | 160 | Lock ADA into escrow with inline DealDatum; client signs |
| `contracts/adadive-escrow/testnet/02_settle.py` | 186 | Settle: oracle+provider co-sign, pay provider, TTL≤deadline |
| `contracts/adadive-escrow/testnet/03_refund.py` | 155 | Refund: client reclaims after deadline, invalid_before>deadline |
| `contracts/adadive-escrow/testnet/04_cancel.py` | 155 | Cancel: client+provider sign, client receives ≥payment back |

### New documentation

| File | Purpose |
|------|---------|
| `contracts/adadive-escrow/testnet/PYCARDANO_GUIDE.md` | Full usage guide: contract rules, CBOR encoding tables, troubleshooting |
| `contracts/adadive-escrow/testnet/MIGRATION_REPORT.md` | This file |

### New memory files

| File | Purpose |
|------|---------|
| `.agents/memory/MEMORY.md` | Agent persistent memory index |
| `.agents/memory/pycardano-preprod.md` | cbor2 fix, Constr encoding, slot conversion, API quirks |

---

## 2. Files Modified This Session

None of the existing project files were modified. The following previously-existing
files were read for reference but not changed:

- `contracts/adadive-escrow/testnet/tx/lock_tx.sh` (reference for contract logic)
- `contracts/adadive-escrow/testnet/tx/settle_tx.sh` (reference)
- `contracts/adadive-escrow/testnet/tx/refund_tx.sh` (reference)
- `contracts/adadive-escrow/testnet/tx/cancel_tx.sh` (reference)
- `contracts/adadive-escrow/testnet/01_deploy_validator.py` (reference for BF key)
- `contracts/adadive-escrow/testnet/DEPLOYMENT_GUIDE.md` (reference)
- `contracts/adadive-escrow/lib/adadive/types.ak` (datum field reference)
- `contracts/adadive-escrow/lib/adadive/escrow.ak` (validator logic reference)
- `contracts/adadive-escrow/testnet/escrow_spend.plutus` (script cborHex)

---

## 3. Features Implemented

### Core infrastructure (`common.py`)
- `load_context()` — `BlockFrostChainContext` for Cardano preprod via project_id
- `load_wallet(name)` — load skey/vkey/addr/vkh from `~/cardano-wallet/<name>/`
- `load_script()` — parse `escrow_spend.plutus` (cardano-cli envelope format), decode
  cborHex once with cbor2, return `PlutusV2Script`, verify hash on-chain
- `make_datum(…)` — build `RawPlutusData(CBORTag(121, [12 fields]))` matching exact
  `DealDatum` field order from `types.ak`
- `make_redeemer(action)` — Settle=CBORTag(121,[]), Refund=CBORTag(122,[]),
  Cancel=CBORTag(123,[]) via `Redeemer(data=RawPlutusData(…))`
- `posix_ms_to_slot(ms)` — dynamic slot conversion using Blockfrost `/blocks/latest`
  (1 slot = 1 s on preprod; no hardcoded genesis constant)
- `current_posix_ms()` — current chain time from Blockfrost
- `find_escrow_utxo(context, client_vkh)` — scan UTxOs at escrow address, match
  inline datum field[0] against client VKH bytes
- `check_balance(address)` — lovelace balance via Blockfrost `/addresses/`

### Lock (`01_lock.py`)
- Argparse CLI (payment, storage-gb, duration-epochs, deadline-hours, data-hash)
- Pre-flight balance check before building tx
- `TransactionBuilder.add_input_address` + `add_output` with `post_alonzo=True`
  for inline datum (Babbage era)
- Prints CLIENT VKH and DEADLINE MS for use in subsequent scripts
- Cardanoscan link on success

### Settle (`02_settle.py`)
- Reads deadline from inline datum (or `--deadline-ms` override)
- TTL = `slot(deadline)` exactly — satisfies `must_end_before: tx_latest ≤ deadline`
- `required_signers = [provider_vkh, oracle_vkh]`
- Provider wallet provides collateral via `add_input_address`
- Key mismatch warning if loaded provider != datum provider_vkh

### Refund (`03_refund.py`)
- `validity_start = slot(deadline) + 1` — satisfies `must_start_after: deadline < tx_earliest`
- Deadline-not-yet-passed guard with countdown warning
- Client wallet provides collateral

### Cancel (`04_cancel.py`)
- No time constraint; `required_signers = [client_vkh, provider_vkh]`
- Output returns `≥ payment` to client (guards against Cancel collusion)
- Key mismatch warning for provider

### Wallet generation (`00_setup_wallets.py`)
- `PaymentKeyPair.generate()` for client, provider, oracle
- Saves `.skey`, `.vkey`, `.addr` to `~/cardano-wallet/<name>/`
- `--force` flag to regenerate
- Prints faucet URL and funding instructions

---

## 4. Syntax / Logic Issues Fixed During Review

Three bugs were caught and patched during the code-review pass (before this commit):

| Bug | File | Fix |
|-----|------|-----|
| `script.hash().payload.hex()` — `.payload` may not exist on `ScriptHash` | `common.py:94` | Changed to `bytes(script.hash()).hex()` |
| `utxo.input.transaction_id.payload.hex()` — same risk | `common.py:237` | Changed to `str(utxo.input.transaction_id)` |
| `import time` unused | `01_lock.py:27` | Removed |

---

## 5. TODOs / Unfinished Work

The following items were **not** completed and should be addressed in the new environment:

### High priority — must test before merging

| # | Item |
|---|------|
| T1 | Run `python3 -m py_compile` on all 6 scripts to confirm zero syntax errors |
| T2 | Run `00_setup_wallets.py` and verify keypairs are written correctly |
| T3 | Run `01_lock.py --payment 5000000 --deadline-hours 0.1` and confirm tx on Cardanoscan |
| T4 | Run `02_settle.py` within the deadline and confirm provider receives funds |
| T5 | Run `01_lock.py` again, wait for deadline to pass, run `03_refund.py` |
| T6 | Run `01_lock.py` again, run `04_cancel.py`, confirm client receives funds |
| T7 | Verify `load_script()` hash check passes (computed == `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b`) |

### Medium priority — may need adjustment based on runtime behaviour

| # | Item |
|---|------|
| T8 | **Execution units**: If PyCardano cannot auto-evaluate via Blockfrost, patch `make_redeemer` to pass explicit `ExecutionUnits(mem=500_000, steps=200_000_000)`. See PYCARDANO_GUIDE.md Troubleshooting section. |
| T9 | **Collateral selection**: Verify PyCardano automatically selects a collateral UTxO from `add_input_address`. If not, add explicit `builder.collaterals = [some_non_script_utxo]`. |
| T10 | **Script reference UTxO**: The Plutus script is currently passed inline to each spend tx (not via a reference UTxO), which increases tx size and cost. Deploy a reference UTxO at the escrow address and switch to `script=None` + pass the UTxO ref. |
| T11 | **Inline datum on spend**: Verify `context.utxos()` correctly returns `RawPlutusData` for inline datums (Blockfrost may return datum as a hash + separate datum in some API versions). |
| T12 | **`context.submit_tx` method name**: Verify the exact method name. Some PyCardano versions use `submit_tx(tx)`, others `submit_tx(tx.to_cbor())`. |

### Low priority — nice to have

| # | Item |
|---|------|
| T13 | Add `--dry-run` flag to skip submission (useful for testing datum/redeemer encoding) |
| T14 | Persist lock output (client VKH, deadline ms, tx hash) to a JSON file for automated chaining |
| T15 | Script to list all active escrow UTxOs at the escrow address |

---

## 6. Assumptions Made (Code Not Executed)

| # | Assumption | Risk if wrong |
|---|-----------|---------------|
| A1 | `BlockFrostChainContext(BF_KEY, network=Network.TESTNET)` auto-detects preprod from the "preprod" key prefix | Would need to add `base_url="https://cardano-preprod.blockfrost.io/api/v0"` |
| A2 | `context.utxos(address_string)` accepts a str address, not only an `Address` object | Would need `context.utxos(Address.decode(ESCROW_ADDR))` |
| A3 | `Redeemer(data=RawPlutusData(…))` is valid — no tag/index needed for `add_script_input` | PyCardano may require `Redeemer(tag=RedeemerTag.SPEND, index=0, data=…)` |
| A4 | `context.submit_tx(tx)` accepts a `Transaction` object | May need `context.submit_tx(tx.to_cbor())` or `.to_cbor_hex()` |
| A5 | `builder.add_input_address(addr)` causes PyCardano to also use those UTxOs as collateral automatically | May need explicit `builder.collaterals = [utxo]` |
| A6 | `cbor2.loads(bytes.fromhex(cborHex))` gives the correct raw script bytes (1-level decode) | The cborHex might not be double-CBOR; if so, use `bytes.fromhex(cborHex)` directly |
| A7 | `builder.required_signers = [...]` (attribute assignment) works after construction | May need to pass in constructor: `TransactionBuilder(ctx, required_signers=[...])` |
| A8 | PyCardano auto-evaluates Plutus execution units via Blockfrost (no manual budget needed) | If not, pass `ExecutionUnits(mem=500_000, steps=200_000_000)` in `make_redeemer` |

---

## 7. Commands to Run in the New Environment

### Step 0 — Install dependencies

```bash
pip install pycardano requests
pip install "cbor2==5.6.5" --force-reinstall   # CRITICAL: must run AFTER pycardano
```

> **Why the force-reinstall?** pycardano installs `cbor2pure` which depends on
> `CBORDecodeValueError` from cbor2 ≥ 5.5.0. The default pip resolution often
> picks an older cbor2. Force-reinstalling 5.6.5 fixes the circular import.

### Step 1 — Git: create branch and commit

```bash
cd /path/to/workspace   # or wherever the repo is cloned

git checkout -b feat/pycardano-e2e-scripts

git add \
  contracts/adadive-escrow/testnet/common.py \
  contracts/adadive-escrow/testnet/00_setup_wallets.py \
  contracts/adadive-escrow/testnet/01_lock.py \
  contracts/adadive-escrow/testnet/02_settle.py \
  contracts/adadive-escrow/testnet/03_refund.py \
  contracts/adadive-escrow/testnet/04_cancel.py \
  contracts/adadive-escrow/testnet/PYCARDANO_GUIDE.md \
  contracts/adadive-escrow/testnet/MIGRATION_REPORT.md \
  .agents/memory/MEMORY.md \
  .agents/memory/pycardano-preprod.md

git commit -m "feat(escrow): add PyCardano E2E test scripts for preprod

Replaces the cardano-cli shell scripts with pure-Python equivalents
using PyCardano + Blockfrost, runnable entirely inside Replit (or any
environment with pip) without a local node or cardano-cli binary.

Scripts added:
- common.py        shared helpers (context, wallets, datum, redeemer,
                   slot conversion, UTxO lookup)
- 00_setup_wallets.py  generate client/provider/oracle keypairs
- 01_lock.py       lock ADA into escrow with inline DealDatum
- 02_settle.py     oracle+provider co-sign, pay provider before deadline
- 03_refund.py     client reclaims after deadline (invalid_before guard)
- 04_cancel.py     mutual cancellation, client receives payment back

Contract: PlutusV2 spend validator (Aiken), script hash
  85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b
Network:  Cardano preprod via Blockfrost

Key implementation notes:
- Constr(N,[]) encoded as cbor2.CBORTag(121+N, []) via RawPlutusData
- Script cborHex decoded once (cbor2.loads) before PlutusV2Script
- Slot conversion calibrated dynamically from Blockfrost /blocks/latest
- Settle TTL = slot(deadline), NOT slot(deadline)+1
- Refund invalid_before = slot(deadline)+1 for strict inequality
- cbor2==5.6.5 required (cbor2pure circular import fix)

Docs: PYCARDANO_GUIDE.md, MIGRATION_REPORT.md"

git push -u origin feat/pycardano-e2e-scripts
```

### Step 2 — Syntax check

```bash
cd contracts/adadive-escrow/testnet
python3 -m py_compile common.py 00_setup_wallets.py 01_lock.py 02_settle.py 03_refund.py 04_cancel.py
echo "Syntax OK"
```

### Step 3 — Smoke test (wallet generation)

```bash
python3 00_setup_wallets.py
```

### Step 4 — Full E2E test (short deadline for speed)

```bash
# Lock 5 ADA with 6-minute deadline
python3 01_lock.py --payment 5000000 --deadline-hours 0.1

# Settle (within 6 min) — note the client VKH printed above
python3 02_settle.py

# OR: wait 6 min then refund
python3 03_refund.py

# OR: cancel at any time
python3 04_cancel.py
```

---

## 8. Contract Reference

| Item | Value |
|------|-------|
| Network | Cardano Preprod |
| Script hash | `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b` |
| Escrow address | `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` |
| Script file | `contracts/adadive-escrow/testnet/escrow_spend.plutus` |
| Blockfrost key | env `BLOCKFROST_PROJECT_ID` (default embedded in `common.py`) |
| Wallet dir | `~/cardano-wallet/{client,provider,oracle}/` |
| Explorer | https://preprod.cardanoscan.io |

---

## 9. Why This Cannot Be Committed from Replit Right Now

The Replit sandbox hit `fork: Resource temporarily unavailable` — a kernel-level
`ulimit -u` (max processes) exhaustion. This caused every `bash` and
`code_execution` tool call to fail with a 500 error for the duration of the
session. All file writes were confirmed successful (Replit's write tool does not
go through the shell), so **all files exist on disk and are ready to commit**.

The `git checkout`, `git add`, `git commit`, and `git push` commands above are
exact and complete; paste them verbatim in the new environment after cloning or
pulling the repo.
