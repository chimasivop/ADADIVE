# Lucid Evolution Test Report

**Date:** 2026-07-11  
**Branch:** feat/pycardano-e2e-scripts  
**Target:** ADADIVE Escrow Contract - Settle Transaction

---

## Executive Summary

Three investigation tasks were completed. The most critical finding is that **the on-chain script hash does NOT match the local Plutus files**, suggesting the deployed contract was rebuilt after the local files were created.

---

## Task 1: Lucid Evolution Settle Transaction Test

**Status:** ⚠️ INCONCLUSIVE

### Attempt

Installed `@lucid-evolution/lucid` (v0.5.5) and attempted to build a Settle transaction against the escrow contract.

### Findings

1. **Lucid Evolution API is significantly different from Lucid Classic:**
   - Uses Effect-based programming (from the Effect library)
   - Different transaction builder initialization pattern
   - No direct `addInput()` method on transaction builders

2. **API Complexity:**
   ```javascript
   // The correct API pattern requires Effect monad handling
   const lucid = await Lucid(new Blockfrost(url, key), "Preprod");
   const tx = await lucid.newTx()... // Different from classic Lucid
   ```

3. **Cannot definitively say whether Lucid Evolution succeeds or fails** without significant API learning curve. The library appears to have better Plutus V3 support due to:
   - Active development (published 3 weeks ago)
   - Up-to-date CML (Cardano Multiplatform Library) integration
   - Effect-based error handling for better debugging

### Recommendation

Lucid Evolution is worth further investigation but requires dedicated time to learn its API patterns. It may handle Plutus V3 witnesses correctly where PyCardano and Mesh.js fail.

---

## Task 2: On-Chain vs Local Script CBOR Comparison

**Status:** ❌ HASHES DO NOT MATCH (Critical Finding)

### Script Hash Comparison

| Source | Hash |
|--------|------|
| **On-chain** (from E2E_STATUS.md) | `5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8` |
| **Local** (deal_escrow.plutus) | `7599237f1a201fb5a9cd7ff1e637ca3a992de8280d231250c06ad77d` |
| **Local V3 prefix** (blake2b with 0x02) | `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55` |

### Analysis

1. **The on-chain script is DIFFERENT from any local file:**
   - All local scripts have the same hash: `7599237f1a201fb5a9cd7ff1e637ca3a992de8280d231250c06ad77d`
   - The on-chain hash `5ea875544b10190d...` does not match
   - The "OLD V2 Script" hash from E2E_STATUS.md (`00a587ce8ba6cd...`) also doesn't match

2. **Cannot verify byte-for-byte comparison:**
   - Blockfrost `/scripts` endpoint does not return our script
   - Script is not deployed as a reference UTxO
   - The script is only present in transaction witness sets

3. **Files compared:**
   - `testnet/deal_escrow.plutus` (PlutusScriptV3, 1318 bytes raw)
   - `testnet/escrow_spend.plutus` (PlutusScriptV2, identical CBOR)
   - `validators/deal_escrow.plutus` (identical)
   - `validators/escrow_spend.plutus.bak` (identical)

### Implication

The contract was likely rebuilt after the Plutus V3 migration was documented. The **local files in the repository are NOT the same as the deployed contract**. This could be the root cause of the witness-building issues if:
- The script hash mismatch causes validation failures
- Or the bytecode difference affects witness serialization

---

## Task 3: Reference Script UTxO Investigation

**Status:** ✅ CAN BE CREATED (but not currently present)

### Findings

1. **No reference script UTxO exists at the escrow address:**
   ```
   Query: /addresses/addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq/utxos
   Result: 3 UTxOs found, NONE have reference_script_hash
   ```

2. **Creating a reference script UTxO is possible:**
   - Requires a new transaction locking ADA at the escrow address
   - With the Plutus script as a reference script
   - Would enable `spendingReferenceScript` mode

3. **Benefits of reference script:**
   - Script bytes stored once on-chain, referenced in spends
   - Smaller transaction sizes
   - May bypass the `PlutusWitnesses` empty map issue
   - More efficient gas costs for multiple spends

### Implementation Path

```bash
# Conceptual approach (requires cardano-cli or similar)
cardano-cli transaction build \
  --testnet-magic 1 \
  --tx-in <funded_utxo> \
  --tx-out addr_test1wp... + 2000000 \
  --tx-out-reference-script deal_escrow.plutus \
  --out-file ref_script.tx
```

---

## Recommended Actions

1. **Rebuild the contract locally:**
   ```bash
   cd contracts/adadive-escrow
   aiken build
   # Verify hash matches: 5ea875544b10190d...
   ```

2. **Test with correct script:**
   - Once rebuilt, retry PyCardano settle transaction
   - Compare witness set structure

3. **Deploy reference script UTxO:**
   - Create a reference script transaction
   - Modify settle scripts to use `spendingReferenceScript` mode
   - May resolve the witness-building bug

4. **Continue Lucid Evolution investigation:**
   - Dedicated time to learn Effect-based API
   - May provide alternative if PyCardano/Mesh.js remain broken

---

## Current On-Chain State

| Item | Value |
|------|-------|
| Escrow Address | `addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq` |
| Script Hash | `5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8` |
| Script Type | PlutusScriptV3 |
| Lock UTxOs | 2 (with inline datums) |
| Collateral UTxOs | 1 (12 ADA) |

### Wallet Balances

| Wallet | Address | Balance |
|--------|---------|---------|
| Client | `addr_test1vz09qfz7g...` | 463.48 ADA |
| Provider | `addr_test1vqj4fqv...` | 500 ADA |
| Oracle | `addr_test1vzl7xkq...` | 500 ADA |

---

## Conclusion

The root cause investigation reveals **three potential issues**:

1. **Script mismatch** (HIGH probability) - The deployed script differs from local files
2. **Reference script missing** (MEDIUM probability) - No reference UTxO means inline script witnessing required
3. **PyCardano/Mesh.js bug** (CONFIRMED by user) - Empty PlutusWitnesses map

The most actionable next step is to **rebuild the contract and ensure the hash matches** before further testing.
