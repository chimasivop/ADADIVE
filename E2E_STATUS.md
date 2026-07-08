# ADADIVE Escrow E2E Testing Status

**Last Updated:** 2026-07-08T09:16:00Z  
**Branch:** `feat/pycardano-e2e-scripts`  
**Status:** 🔴 IN PROGRESS - MalformedScriptWitnesses root cause identified

---

## Repository Context

This document tracks the PyCardano E2E testing of the ADADIVE escrow contract on Cardano Preprod.
The PyCardano scripts are a Python port of the original Aiken escrow contract.

**Repository:** `ADADIVE`  
**Contract:** `contracts/adadive-escrow/`  
**Scripts Directory:** `contracts/adadive-escrow/testnet/`  
**Testnet Blockfrost API:** `https://cardano-preprod.blockfrost.io/api/v0`

---

## Contract Information

### Script Details
- **Script File:** `testnet/escrow_spend.plutus`
- **Script Type:** PlutusScriptV2
- **Script Hash (Blake2b-224):** `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`
- **Escrow Address:** `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2`

### PlutusData Constructor Tags
- Tag 121 (0x79) is used for all constructors in Aiken-compiled Plutus scripts
- DealDatum uses tag 121 with 12 fields
- DealRedeemer uses tag 121 with [constructor_index, [fields]]

### Redeemer Encoding
```
Settle = [0, []] wrapped in tag 121 = d8 79 82 00 80
Refund  = [1, []] wrapped in tag 121 = d8 79 82 01 80  
Cancel = [2, []] wrapped in tag 121 = d8 79 82 02 80
```

---

## Wallet Information

| Role    | Address                                    | VKH (hex)                              |
|---------|-------------------------------------------|----------------------------------------|
| Client  | addr_test1vpxrrmdy622c5pr9n6rdw85el85... | 4c31eda4d2958a04659e86d71e99f9e97dd56f0a |
| Provider| addr_test1vz8gc69wd8vafex4hgfph8tkfcf... | 8e8c68ae69d9d4e4d5ba121b9d764e1275c07b5f |
| Oracle  | addr_test1vq429gqyf48wnt53zz65gy6mwkx... | 2aa2a0044d4ee9ae9110b544135b758df11ebb4e |

**Wallet Directory:** `~/cardano-wallet/{client,provider,oracle}/`

---

## Completed Tasks

### ✅ Lock Transaction (01_lock.py)
- Successfully creates escrow UTxOs with inline datums
- Uses `make_datum()` with tag 121 for OracleAttested/Locked variants
- Payment amount + MIN_ADA (2 ADA minimum) works correctly
- **Latest Lock TX:** `0b5703f7caf13649a36ec908ec5a1f0d88f82a44a79c903070e2b25dfadb71a0`

### ✅ Script Loading
- Fixed `load_script()` to decode CBOR envelope from cborHex
- Uses `cbor2.loads()` to extract raw Plutus script bytes (1318 bytes)
- Script hash verification passes: `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`

### ✅ Redeemer Encoding
- Fixed `make_redeemer()` to use RawCBOR with correct bytes
- Tag 121 (0x79) is used for PlutusData constructors
- Constructor index is embedded in array: `[constructor_index, [fields]]`
- Correct CBOR: `d8 79 82 00 80` for Settle

### ✅ PyCardano DeepCopy Patches
- Added `_patch_pycardano_deepcopy()` in common.py
- Patches `RawPlutusData.__deepcopy__` and `PlutusV2Script.__deepcopy__`
- Fixes `__deepcopy__` failure using direct byte copying

### ✅ Datum Parsing
- Updated `find_escrow_utxo()` to handle both RawPlutusData and RawCBOR datum types
- Correctly decodes inline datums from UTxOs

### ✅ TTL/Time Handling
- Added max TTL cap (127958000) to stay within current era
- Prevents "PastHorizon" errors from TTL beyond era end

---

## Pending Tasks

### 🔴 Fix Settle Transaction (02_settle.py)
**Status:** BLOCKED - MalformedScriptWitnesses error

The settle transaction builds and signs successfully, but fails at submission with:
```
ConwayUtxowFailure (MalformedScriptWitnesses (NonEmptySet (fromList [ScriptHash "00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55"])))
```

**What we verified:**
- ✅ Script hash matches on-chain value
- ✅ Script is included in PlutusV2 witnesses
- ✅ Script starts with `01 01` (PlutusV2 version)
- ✅ Redeemer CBOR is correct: `d8 79 82 00 80`
- ✅ Execution units are set (when specified)
- ✅ Required signers include provider and oracle

**What might be wrong:**
1. Plutus script serialization format in transaction witnesses
2. Redeemer data format within the witness set
3. Script data hash mismatch
4. Transaction body format issues

### 🔴 Fix Refund Transaction (03_refund.py)
**Status:** NOT TESTED - Waiting for settle to work

### 🔴 Fix Cancel Transaction (04_cancel.py)
**Status:** NOT TESTED - Waiting for settle to work

---

## Current UTxO State

```
Found 3 UTxOs at escrow address:
  1. 21a57a8c09cc091bbe07102cd4a2acf2fbbac96682b8cb6a261ca2083c1f32f6#0
     - Datum hash only (no inline datum)
     - Value: 9,626,931 lovelace
     
  2. 92949c3707d591d2356e391363bfd8ba234a3cb1bc77cfb59df961ae01de3c88#0
     - Inline datum (expired deadline: 1783451855000)
     - Value: 7,000,000 lovelace
     - CANNOT BE SETTLED (deadline passed)
     
  3. 0b5703f7caf13649a36ec908ec5a1f0d88f82a44a79c903070e2b25dfadb71a0#0
     - Inline datum (deadline: 1783711353000)
     - Value: 7,000,000 lovelace
     - THIS IS THE ACTIVE ESCROW UTxO
```

---

## Key Commands to Run

### Test Settle Transaction
```bash
cd /workspace/project/ADADIVE/contracts/adadive-escrow/testnet
python3 << 'EOF'
import sys, os, requests
sys.path.insert(0, '.')
from common import (
    load_context, load_wallet, load_script, make_redeemer,
    BF_KEY, BF_URL, posix_ms_to_slot, info
)
from pycardano import (
    TransactionBuilder, TransactionOutput, Value, VerificationKeyHash,
    UTxO, TransactionInput, Address, TransactionId, ExecutionUnits
)
from pycardano.plutus import RawCBOR

tx_hash = "0b5703f7caf13649a36ec908ec5a1f0d88f82a44a79c903070e2b25dfadb71a0"

# Load wallets
provider_skey, provider_vkey, provider_addr, provider_vkh = load_wallet("provider")
oracle_skey, oracle_vkey, oracle_addr, oracle_vkh = load_wallet("oracle")
ctx = load_context()

# Get UTxO from Blockfrost
response = requests.get(f"{BF_URL}/txs/{tx_hash}/utxos", headers={"project_id": BF_KEY})
data = response.json()
output = data["outputs"][0]

address = Address.from_primitive(output["address"])
amount = Value(coin=int(output["amount"][0]["quantity"]))
datum_bytes = bytes.fromhex(output["inline_datum"])
datum = RawCBOR(cbor=datum_bytes)

tx_input = TransactionInput(transaction_id=TransactionId(bytes.fromhex(tx_hash)), index=0)
tx_output = TransactionOutput(address=address, amount=amount, datum=datum)
utxo = UTxO(input=tx_input, output=tx_output)

# Build transaction
redeemer = make_redeemer("settle")
redeemer.ex_units = ExecutionUnits(10000000, 10000000000)  # Set execution units
script = load_script()

builder = TransactionBuilder(ctx, ttl=127958000)
builder.required_signers = [
    VerificationKeyHash(provider_vkh),
    VerificationKeyHash(oracle_vkh),
]
builder.add_script_input(utxo, script=script, redeemer=redeemer)
builder.add_output(TransactionOutput(provider_addr, Value(7000000)))
builder.add_input_address(oracle_addr)

# Build and sign
tx = builder.build_and_sign(
    signing_keys=[provider_skey, oracle_skey],
    change_address=oracle_addr,
)

print(f"Transaction ID: {tx.id.payload.hex()}")

# Submit
response = requests.post(
    f"{BF_URL}/tx/submit",
    headers={"project_id": BF_KEY, "Content-Type": "application/cbor"},
    data=bytes.fromhex(tx.to_cbor_hex())
)
print(f"Response: {response.status_code}")
print(response.text[:500] if response.status_code != 200 else "SUCCESS!")
EOF
```

### Debug Transaction Structure
```bash
cd /workspace/project/ADADIVE/contracts/adadive-escrow/testnet
python3 << 'EOF'
# Check transaction witnesses structure
from pycardano import Transaction
tx = Transaction.from_cbor("...")  # Use actual tx CBOR hex
print(tx.transaction_witness_set)
EOF
```

---

## Root Cause Analysis: MalformedScriptWitnesses Error

### Investigation Summary (2026-07-08)

After deep analysis of the Plutus script serialization and hash computation, the following findings were identified:

### A. Script Hash Computation Methods

| Method | Prefix | Bytes Used | Computed Hash |
|--------|--------|------------|---------------|
| Aiken Blueprint | `03` (V3) | CBOR-encoded | `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b` |
| PyCardano (V2) | `02` (V2) | Raw bytes | `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55` |
| Deployed Script | N/A | N/A | `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55` |

### B. Key Findings

1. **Aiken.toml Configuration**: The Aiken build is configured with `plutus = "v3"`, which means Aiken uses prefix `03` with CBOR-encoded script bytes for hash computation.

2. **escrow_spend.plutus File**: The Plutus script file has:
   - Type: `PlutusScriptV2`
   - Bytecode: Starts with `01 01` (Plutus V2 format)
   - This indicates the bytecode was compiled for Plutus V2, not V3

3. **Hash Mismatch**: Aiken's blueprint hash (`85ed...`) differs from the PyCardano-computed hash (`00a5...`) because:
   - Aiken uses CBOR-encoded bytes with V3 prefix
   - PyCardano uses raw decoded bytes with V2 prefix

4. **Deployed Contract**: The on-chain contract hash is `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`, which matches the PyCardano V2 approach.

### C. Plausible Root Cause

The `MalformedScriptWitnesses` error likely stems from a **Plutus version mismatch**:

- The Aiken build is configured for V3 but produces V2 bytecode
- The escrow_spend.plutus file has `PlutusScriptV2` type but the aiken.toml says `plutus = "v3"`
- This inconsistency may cause the Cardano node to reject the script during validation

### D. Recommended Fix Options

#### Option 1: Rebuild with Consistent V2 Settings
Rebuild the Aiken contract with `plutus = "v2"` in aiken.toml:
```toml
plutus = "v2"  # Change from "v3"
```
Then deploy a new reference script at a new address.

#### Option 2: Use V3 Script Format
Update PyCardano to use `PlutusV3Script` with CBOR-encoded bytes:
```python
from pycardano import PlutusV3Script, plutus_script_hash

# Use CBOR-encoded bytes for V3
script = PlutusV3Script(cbor_bytes)  # Not decoded bytes
```

### E. Current State

- The PyCardano code uses `PlutusV2Script` with raw decoded bytes
- The script hash `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55` matches the on-chain deployed contract
- The ESCROW_ADDR `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` is correct

### F. Next Steps

1. **Verify bytecode format**: Run `aiken build` and compare the compiled bytecode with escrow_spend.plutus
2. **Check Aiken version**: Ensure Aiken version supports Plutus V3 properly
3. **Deploy new reference script**: If needed, deploy a fresh reference script with consistent settings
4. **Re-run E2E tests**: After fixing, re-run the complete Lock → Settle → Refund → Cancel flow

---

## Known Issues

### Issue 1: MalformedScriptWitnesses
**Error:** Node rejects script with hash `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`
**Status:** UNRESOLVED
**Notes:** Script is included in witnesses but node doesn't accept it. Possible causes:
- Script serialization format in witnesses
- Redeemer/witness format mismatch
- Transaction body format issues

### Issue 2: PyCardano DeepCopy Bug
**Error:** `__deepcopy__` failing in `RawPlutusData.__deepcopy__`
**Status:** ✅ FIXED - Added patches in `common.py`

### Issue 3: Wrong Redeemer Tag
**Error:** Initially used tags 0/1/2 instead of tag 121
**Status:** ✅ FIXED - Now uses `RawCBOR` with correct bytes

### Issue 4: TTL Slot Expiration
**Error:** "OutsideValidityIntervalUTxO" when TTL passed
**Status:** ✅ FIXED - Added max TTL cap (127958000)

---

## Files Modified

| File | Changes |
|------|---------|
| `testnet/common.py` | Script loading, redeemer encoding, deepcopy patches, datum parsing |
| `testnet/02_settle.py` | TTL capping, execution unit handling |
| `testnet/03_refund.py` | TTL capping (minimal) |
| `testnet/04_cancel.py` | TTL capping (minimal) |

---

## Next Steps for Resume

1. **Primary Goal:** Fix the MalformedScriptWitnesses error in settle transaction
   - Investigate transaction serialization format
   - Try different execution unit estimation approaches
   - Compare with working lock transaction structure

2. **Secondary Goals:**
   - Test refund flow (after settle works)
   - Test cancel flow (after settle works)
   - Verify all validator rules work on-chain

3. **Debug Commands:**
   ```bash
   # Check if PyCardano version has known issues
   pip show pycardano
   
   # Verify script hash matches on-chain
   python3 -c "from pycardano import PlutusV2Script, plutus_script_hash; print(plutus_script_hash(PlutusV2Script(bytes.fromhex('...'))"
   ```

---

## Environment Variables

```
BLOCKFROST_KEY=<blockfrost-preprod-key>
```

---

## References

- [PyCardano Documentation](https://pycardano.readthedocs.io/)
- [Cardano Plutus Docs](https://docs.cardano.org/plutus/economic-model/)
- [Aiken Documentation](https://aiken-lang.org/)
- [Blockfrost API](https://docs.blockfrost.io/)
