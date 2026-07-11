# ADADIVE Escrow E2E Testing Status

**Last Updated:** 2026-07-11T19:00:00Z  
**Branch:** `feat/pycardano-e2e-scripts`  
**Status:** 🔴 PIVOTED - Switching to Mesh.js due to PyCardano Plutus V3 reliability issues

---

## Repository Context

This document tracks the ADADIVE escrow contract E2E testing on Cardano Preprod.
**We have pivoted from PyCardano to Mesh.js** due to low-level Plutus V3 bugs in PyCardano.

**Repository:** `ADADIVE`  
**Contract:** `contracts/adadive-escrow/`  
**Mesh.js Scripts:** `test-wallet/tx/mesh-settle/`  
**Testnet Blockfrost API:** `https://cardano-preprod.blockfrost.io/api/v0`

---

## ⚠️ IMPORTANT: PyCardano Support Abandoned

**Date:** 2026-07-11

After discovering **two distinct Plutus V3 bugs** in PyCardano:
1. `_ScriptRef.to_primitive()` failure with Plutus V3 scripts
2. Previous `MalformedScriptWitnesses` errors

**Decision:** We are no longer pursuing PyCardano for this project. PyCardano's Plutus V3 support is unreliable at a low level.

**New Approach:** Mesh.js with cardano-serialization-lib

---

## Contract Information

### Script Details (V3 - Active)
- **Script File:** `testnet/deal_escrow.plutus`
- **Script Type:** PlutusScriptV3
- **Script Hash (Blake2b-224):** `5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8`
- **Escrow Address:** `addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq`

### Previous V2 Contract (Deprecated)
- **Old Script Hash:** `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`
- **Old Address:** `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2`

---

## New Wallet Keys (Mesh.js Format)

**⚠️ KEY MATERIAL GENERATED - SAVE SECURELY**

Wallets have been generated in Mesh.js-compatible format (hex-encoded private keys).

### Wallet Addresses and VKH

| Role    | Address | VKH (hex) |
|---------|---------|-----------|
| Provider| `addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze` | `2447db07e3b73b00d3cb9b271e42f4e475d882d0683ece437c68367d` |
| Oracle  | `addr_test1qzgqy6matteypul5lm2qm5slvkqkyywxx770tscmgrz5ydvsqf4h6khjgrelflk5phfp7evpvgguvdau7hp3ksx9gg6syjmkgc` | `90026b7d5af240f3f4fed40dd21f65816211c637bcf5c31b40c54235` |
| Client  | `addr_test1qqzhypzf627yh0ymrhsrf0uhykhyfq5ue0la5799n8vyh0s9wgzyn54ufw7fk80qxjlewfdwgjpfejllmfu2txwcfwlqp8geuk` | `05720449d2bc4bbc9b1de034bf9725ae44829ccbffda78a599d84bbe` |

### Key Storage Location
**Directory:** `contracts/adadive-escrow/testnet/keys/{provider,oracle,client}/`

Each wallet has:
- `keys.json` - Full key material in JSON format
- `.env` - Environment variable format for easy loading

---

## ✅ WALLETS FUNDED (2026-07-11)

**Successfully transferred ADA from old funded wallet to new Mesh.js wallets:**

| Role    | Address | Balance |
|---------|---------|---------|
| Provider| `addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze` | **950.00 ADA** |
| Oracle  | `addr_test1qzgqy6matteypul5lm2qm5slvkqkyywxx770tscmgrz5ydvsqf4h6khjgrelflk5phfp7evpvgguvdau7hp3ksx9gg6syjmkgc` | **504.57 ADA** |
| Client  | `addr_test1qqzhypzf627yh0ymrhsrf0uhykhyfq5ue0la5799n8vyh0s9wgzyn54ufw7fk80qxjlewfdwgjpfejllmfu2txwcfwlqp8geuk` | **504.57 ADA** |

**Old wallet key material recovered and saved to:**
- `contracts/adadive-escrow/testnet/keys/old/client.json`
- `contracts/adadive-escrow/testnet/keys/old/provider.json`
- `contracts/adadive-escrow/testnet/keys/old/oracle.json`

---

## Mesh.js Scripts

### Available Scripts

```bash
cd /workspace/project/ADADIVE/test-wallet/tx/mesh-settle

# Generate new wallets (if needed)
npm run generate-wallets

# Create reference script UTxO at escrow address
npm run reference-script

# Settle transaction (after funding and locking)
npm run settle:v2
```

### Key Files

| File | Purpose |
|------|---------|
| `generate_wallet.ts` | Generate Mesh.js-compatible wallets |
| `reference-script.ts` | Create reference script UTxO |
| `settle-v2.ts` | Settle transaction with new wallets |
| `settle.ts` | Original settle with external keys |

---

## Setup Instructions

### 1. Fund Wallets
Use the Cardano Preprod Faucet to fund the addresses listed above.

### 2. Create Reference Script UTxO
```bash
cd /workspace/project/ADADIVE/test-wallet/tx/mesh-settle
npm run reference-script
```

### 3. Lock Funds (via PyCardano or cardano-cli)
```bash
cd /workspace/project/ADADIVE/contracts/adadive-escrow/testnet
python3 01_lock.py
```

### 4. Settle Transaction (via Mesh.js)
```bash
cd /workspace/project/ADADIVE/test-wallet/tx/mesh-settle
npm run settle:v2
```

---

## Current UTxO State (Pre-funding)

No UTxOs currently exist for the new wallets. The escrow address has the following from previous tests:

```
Escrow Address: addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq
Script Hash: 5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8

Previous UTxOs (from V2 contract - address differs):
  - 0b5703f7caf13649a36ec908ec5a1f0d88f82a44a79c903070e2b25dfadb71a0#0
    (This UTxO is at the OLD V2 address - not usable)
```

---

## Previous PyCardano Results

### Completed Tasks (PyCardano)
- ✅ Lock transaction works
- ✅ Script loading and hash verification
- ✅ Redeemer encoding with tag 121
- ✅ Datum parsing from UTxOs
- ✅ TTL/time handling

### Failed Tasks (PyCardano)
- ❌ Settle transaction - `MalformedScriptWitnesses` error
- ❌ Second V3 bug: `_ScriptRef.to_primitive()` failure

### Root Cause (PyCardano)
PyCardano has low-level Plutus V3 serialization bugs that cannot be reliably worked around without modifying the library itself.

---

## References

- [Mesh.js Documentation](https://meshjs.dev/)
- [Cardano Serialization Lib](https://www.npmjs.com/package/@emurgo/cardano-serialization-lib-nodejs)
- [Cardano Testnet Faucet](https://docs.cardano.org/cardano-testnet/tools/faucet)
- [Blockfrost API](https://docs.blockfrost.io/)
- [Aiken Documentation](https://aiken-lang.org/)
