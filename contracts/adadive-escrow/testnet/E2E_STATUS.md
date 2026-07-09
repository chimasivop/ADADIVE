# ADADIVE E2E Test Status

## Last Session Summary (2026-07-09)

### Test Results

| Test | Status | Details |
|------|--------|---------|
| Fund Wallets | ✅ Success | All 3 wallets funded (500 ADA each) |
| Lock Transaction | ✅ Success | TX: `fb6e9d62955a04a7524b914ce5854850ce20a9bcdd35f8c948d7a8dcb77e409d` |
| Settle Transaction | ❌ Failed | MalformedScriptWitnesses error (OLD V2 CONTRACT) |

### Wallets (Testnet Preprod)

| Role | Address | VKH |
|------|---------|-----|
| Client | `addr_test1vq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` | `9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab` |
| Provider | `addr_test1vqj4fqvpews3sn0hzs20k96xy68l6xmnpnlcevahlhdtx5sykmhxs` | `25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352` |
| Oracle | `addr_test1vzl7xkqdzrce4rzj9v87zgldwsngu6mw05alq9dqzyjvasgaf40rl` | `bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1` |

### NEW V3 Script Information (2026-07-09)

- **Script Address**: `addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq`
- **Script Hash**: `5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8`
- **PlutusScript Type**: PlutusScriptV3
- **Aiken Version**: v1.1.23+8949565
- **Plutus Version**: v3

### OLD V2 Script (Deprecated)

- **Old Script Address**: `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2`
- **Old Script Hash**: `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`
- **Status**: UTxOs still exist but MalformedScriptWitnesses error prevents settlement

### Issue Resolution (2026-07-09)

The `MalformedScriptWitnesses` error was caused by hash mismatch between the deployed script and PyCardano-generated witnesses.

**Resolution Steps:**
1. ✅ Rebuilt contract with Aiken V3
2. ✅ Created PlutusScriptV3 format file
3. ✅ Updated PyCardano code to use PlutusV3Script
4. ✅ Computed new V3 address
5. ⏳ Deploy new V3 contract to Preprod
6. ⏳ Run E2E tests

### Next Steps

1. **Deploy V3 Contract**:
   ```bash
   # Verify script address
   ~/cardano-cli address build --payment-script-file validators/deal_escrow.plutus --testnet-magic 1
   
   # Fund the new address with test ADA
   ```

2. **Run E2E Tests**:
   ```bash
   cd /workspace/project/ADADIVE/contracts/adadive-escrow/testnet
   python3 01_lock.py --client-vkh 9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab --deadline-ms 1783682146000
   python3 02_settle.py --client-vkh 9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab --deadline-ms 1783682146000
   ```

### Files Modified (2026-07-09)

- `common.py`: Updated ESCROW_ADDR, SCRIPT_HASH, ESCROW_PLUTUS, load_script() for V3
- `E2E_STATUS.md`: Updated with new V3 contract details
- `deal_escrow.plutus`: Created with PlutusScriptV3 format
- `validators/deal_escrow.plutus`: Updated with V3 format
