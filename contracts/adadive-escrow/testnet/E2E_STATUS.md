# ADADIVE E2E Test Status

## Session Summary (2026-07-11)

### Test Results

| Test | Status | Details |
|------|--------|---------|
| Contract Rebuild | ✅ Success | Aiken v1.1.23+8949565, bytecode verified |
| Script Hash | ✅ Match | Local hash matches locally compiled code |
| Lock Transaction | ⏳ Pending | Needs fresh deployment to new address |
| Settle Transaction | ⏳ Pending | Waiting for Lock to confirm |
| Refund Transaction | ⏳ Pending | Waiting for Settle |
| Cancel Transaction | ⏳ Pending | Waiting for Lock |

### Wallets (Testnet Preprod)

| Role | Address | VKH |
|------|---------|-----|
| Client | `addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep` | `9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab` |
| Provider | `addr_test1vqj4fqvpews3sn0hzs20k96xy68l6xmnpnlcevahlhdtx5sykmhxs` | `25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352` |
| Oracle | `addr_test1vzl7xkqdzrce4rzj9v87zgldwsngu6mw05alq9dqzyjvasgaf40rl` | `bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1` |

### NEW V3 Script Information (2026-07-11 - Locally Compiled)

- **Script Address**: `addr_test1wp6ejgmlrgsplddfe4llre3hegafjt0g9qxjxyjscp4dwlgutljm3`
- **Script Hash**: `7599237f1a201fb5a9cd7ff1e637ca3a992de8280d231250c06ad77d`
- **PlutusScript Type**: PlutusScriptV3
- **Aiken Version**: v1.1.23+8949565
- **Plutus Version**: v3
- **Unit Tests**: 56/56 passed ✅
- **Bytecode Length**: 1318 bytes (raw), 2642 chars (CBOR hex)

### Contract Bytecode Verification

The H-01 Cancel-path fix is verified in the rebuilt contract:
```aiken
paid_at_least(outputs, deal.client, deal.payment)
```

### OLD V3 Script (Deprecated - 2026-07-09)

- **Old Script Address**: `addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq`
- **Old Script Hash**: `5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8`
- **Status**: Deprecated - was deployed with different bytecode than local files
- **Reason for redeployment**: Local bytecode didn't match on-chain script hash

### Known Issue: PyCardano PlutusV3Script Bug

The PyCardano library (v0.19.x) has a bug where PlutusV3Script witnesses are serialized incorrectly for Conway era validation.

**Error**: `ConwayUtxowFailure (MalformedScriptWitnesses ...)`

**Root Cause**: The witness set structure appears correct (script in key 7, redeemer in key 5), but the Cardano node rejects the PlutusV3Script format.

**Workaround Options**:
1. Use cardano-cli for settle/refund/cancel transactions
2. Wait for PyCardano update
3. Migrate to Lucid or Mesh.js for better Conway era support

### Files Modified (2026-07-09)

- `common.py`: Updated ESCROW_ADDR, SCRIPT_HASH, ESCROW_PLUTUS for V3
- `E2E_STATUS.md`: Updated with V3 contract details
- `deal_escrow.plutus`: Created with PlutusScriptV3 format
- `validators/deal_escrow.plutus`: Updated with V3 format
- `escrow.addr`: Updated with new V3 address
- `script.hash`: Updated with new V3 hash
- `PYCARDANO_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, `ANDROID_ETERNL_GUIDE.md`: Updated addresses
