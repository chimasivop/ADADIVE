# ADADIVE E2E Test Status

## Last Session Summary (2026-07-08)

### Test Results

| Test | Status | Details |
|------|--------|---------|
| Fund Wallets | ✅ Success | All 3 wallets funded (500 ADA each) |
| Lock Transaction | ✅ Success | TX: `fb6e9d62955a04a7524b914ce5854850ce20a9bcdd35f8c948d7a8dcb77e409d` |
| Settle Transaction | ❌ Failed | MalformedScriptWitnesses error |

### Wallets (Testnet Preprod)

| Role | Address | VKH |
|------|---------|-----|
| Client | `addr_test1vq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` | `9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab` |
| Provider | `addr_test1vqj4fqvpews3sn0hzs20k96xy68l6xmnpnlcevahlhdtx5sykmhxs` | `25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352` |
| Oracle | `addr_test1vzl7xkqdzrce4rzj9v87zgldwsngu6mw05alq9dqzyjvasgaf40rl` | `bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1` |

### Script Information

- **Script Address**: `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2`
- **Script Hash**: `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`
- **Lock TX**: `fb6e9d62955a04a7524b914ce5854850ce20a9bcdd35f8c948d7a8dcb77e409d`
- **Escrow Amount**: 12,000,000 lovelace (10 ADA + 2 ADA min ADA)
- **Payment**: 10,000,000 lovelace

### Issue: MalformedScriptWitnesses Error

The settle transaction fails with `MalformedScriptWitnesses` error for script hash `00a587ce8ba6cd9899269fcfff6474ca3852d6a449f43f38bd2b9f55`.

**Root Cause**: The contract was compiled with Aiken using `plutus = "v3"` but the bytecode format is V2. Aiken 1.1.x only supports V3 Plutus. The lock transaction succeeded because it doesn't use script witnesses, but the settle transaction requires script validation.

### Next Steps

1. **Option A - Rebuild Contract**:
   ```bash
   # Install cardano-cli
   cd contracts/adadive-escrow
   aiken build
   cardano-cli address build --payment-script-file validators/deal_escrow.plutus --testnet-magic 1
   ```

2. **Option B - Use cardano-cli for Settlement**:
   Build the settle transaction using cardano-cli instead of PyCardano.

### Files Modified

- `common.py`: Added (disabled) CIP-0057 witness key patch
- `show_wallets.py`: Created wallet display utility
- `aiken.toml`: Contains `plutus = "v3"` (only option in Aiken 1.1.x)

### Commands to Resume

```bash
cd /workspace/project/ADADIVE/contracts/adadive-escrow/testnet

# Run lock (if UTxO is gone)
python3 01_lock.py --client-vkh 9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab --deadline-ms 1783682146000

# Run settle (currently failing)
python3 02_settle.py --client-vkh 9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab --deadline-ms 1783682146000
```
