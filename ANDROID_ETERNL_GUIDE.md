# ADADIVE Escrow Contract - Android + Eternl Wallet Guide

## ✅ Current Status (Live on Cardano Preprod)

### Escrow Contract
| Property | Value |
|----------|-------|
| **Escrow Address** | `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` |
| **Script Hash** | `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b` |
| **UTxO** | `21a57a8c09cc091bbe07102cd4a2acf2fbbac96682b8cb6a261ca2083c1f32f6` #0 |
| **Balance** | 9.626931 ADA (9,626,931 lovelace) |
| **Datum Hash** | `4b539a69da890486170189714faf4826b50afd5e5595bf5d70d525d832dee9f1` |

### Test Wallet
| Property | Value |
|----------|-------|
| **Address** | `addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7` |
| **Balance** | 30 ADA |

### Blockchain State
| Property | Value |
|----------|-------|
| **Network** | Cardano Preprod Testnet |
| **Current Epoch** | 298 |
| **Current Slot** | 127,169,832 |
| **Current Block** | 4,883,412 |

---

## ⚠️ IMPORTANT: Preprod Testnet Only

**This guide is for PREPROD TESTNET ONLY.** The signing keys and addresses are testnet-only and cannot access real mainnet funds. You cannot lose real money on Preprod.

---

## 📱 Step 1: Install Eternl on Android

### Option A: Android App (Recommended)
1. Open Google Play Store on your Android device
2. Search for **"Eternl"** or **"Eternl Wallet"**
3. Install the official Eternl app
4. Open Eternl and select **"Preprod Testnet"** during setup

### Option B: Browser Extension (Mobile Chrome)
1. Open Chrome on your Android device
2. Go to [chrome.google.com/webstore](https://chrome.google.com/webstore)
3. Search for **"Eternl"**
4. Install the Eternl browser extension
5. Pin the extension for easy access
6. Set network to **Preprod** in extension settings

### Verify Network Selection
In Eternl, check the network indicator (top-left corner):
- ✅ Should show **"Preprod"** or **"Testnet"**
- ❌ Should NOT show **"Mainnet"**

---

## 💰 Step 2: Fund Your Test Wallet

### Get Test ADA from Faucet
1. Visit: https://docs.cardano.org/cardano-testnet/tools/faucet/
2. Enter your Eternl wallet address
3. Complete any CAPTCHA
4. Click "Request"
5. Wait 1-2 minutes for funds to arrive

**Note:** The test wallet (`addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7`) already has 30 ADA. You can import this wallet to view it or create your own.

### Import Existing Test Wallet (Optional)
To view the pre-funded wallet in your Eternl:
1. Open Eternl → Settings → Wallets
2. Click "Add Wallet" → "Import"
3. Enter the recovery phrase (seed words)
4. Select Preprod network
5. Complete import

**Note:** You will need the seed phrase from the original wallet creation. Do NOT share this phrase with anyone!

### Alternative: Create New Test Wallet
If you want to test with your own wallet:
1. Open Eternl → "Create Wallet"
2. Save the 24-word seed phrase securely
3. Fund from faucet as described above

---

## 🔑 Step 3: Identify Keys for Each Role

For the ADADIVE escrow, you'll need keys for:
- **Client** (who can Refund/Cancel)
- **Provider** (who receives payment on Settle)
- **Oracle** (who attestates for Settle)

### Get Your Verification Key Hash
1. In Eternl, go to Wallet Settings
2. Find "Verification Key Hash" or "Public Key Hash"
3. Copy this value (starts with `addr_vk...`)

**Important:** For this test contract, the roles are pre-configured:
- The UTxO at the escrow address uses specific keys
- You may need to create transactions using cardano-cli for full testing

---

## 🔄 Step 4: Execute Transactions

### Method A: Using Eternl (Manual - Limited Support)

**Eternl** is primarily a light wallet and may not directly support Plutus smart contract interactions with custom datums/redeemers. For full contract interaction:

#### For Settle/Refund/Cancel, you would need:

1. **Connect Eternl to a dApp**
   - Visit the ADADIVE frontend (when deployed)
   - Connect your Eternl wallet
   - Use the web interface to build transactions

2. **Use a Supporting dApp**
   - Some Cardano dApps support custom contract interactions
   - Check ADADIVE documentation for supported wallets

#### Recommended: Use cardano-cli for Full Contract Control

---

### Method B: Using Cardano-CLI (Full Control)

For complete control over the escrow contract, use cardano-cli on a computer (not Android directly).

#### Prerequisites
1. Install cardano-cli on your computer (Linux/macOS/Windows WSL)
2. Download Preprod config files:
```bash
mkdir -p ~/cardano-preprod
cd ~/cardano-preprod
curl -O https://book.play.dev.cardano.org/environments/preprod/config.json
curl -O https://book.play.dev.cardano.org/environments/preprod/topology.json
curl -O https://book.play.dev.cardano.org/environments/preprod/shelley-genesis.json
curl -O https://book.play.dev.cardano.org/environments/preprodalonzo-genesis.json
curl -O https://book.play.dev.cardano.org/environments/preprod/submit-api-config.json
```

#### Export Keys from Eternl
1. In Eternl, export the signing key (SKEY)
2. Convert to cardano-cli format if needed
3. Copy to your computer

---

## 📋 Detailed Transaction Instructions

### A. REFUND Transaction (Client Only, After Deadline)

**Prerequisites:**
- You must be the **Client** (key holder)
- Current time must be **AFTER the deadline**

**Steps:**

1. **Query the UTxO:**
```bash
cardano-cli query utxo \
  --address addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2 \
  --testnet-magic 1
```

2. **Build Refund Transaction:**
```bash
cardano-cli transaction build \
  --testnet-magic 1 \
  --tx-in 21a57a8c09cc091bbe07102cd4a2acf2fbbac96682b8cb6a261ca2083c1f32f6#0 \
  --tx-in-script-file contracts/adadive-escrow/testnet/escrow_spend.plutus \
  --tx-in-datum-value '{
    "constructor": 0,
    "fields": [
      {"bytes": "<CLIENT_VKH>"},
      {"bytes": "<PROVIDER_VKH>"},
      {"bytes": "<ORACLE_VKH>"},
      {"bytes": "deadbeef"},
      {"int": 10000000},
      {"int": 10},
      {"int": 6},
      {"int": 1600000000000},
      {"int": 1700000000000},
      {"constructor": 0, "fields": []},
      {"int": 0},
      {"constructor": 0, "fields": []}
    ]
  }' \
  --tx-in-redeemer-value '{"constructor": 1, "fields": []}' \
  --tx-out <YOUR_WALLET_ADDR>+2000000 \
  --change-address <YOUR_WALLET_ADDR> \
  --witness-override 1 \
  --out-file refund_tx.draft
```

3. **Sign with Client Key:**
```bash
cardano-cli transaction sign \
  --tx-body-file refund_tx.draft \
  --signing-key-file client.skey \
  --testnet-magic 1 \
  --out-file refund_tx.signed
```

4. **Submit:**
```bash
cardano-cli transaction submit \
  --tx-file refund_tx.signed \
  --testnet-magic 1
```

### B. CANCEL Transaction (Client + Provider)

**Prerequisites:**
- Both **Client** and **Provider** must sign
- Client must receive at least the `payment` amount

**Steps:**

1. **Build Cancel Transaction:**
```bash
cardano-cli transaction build \
  --testnet-magic 1 \
  --tx-in 21a57a8c09cc091bbe07102cd4a2acf2fbbac96682b8cb6a261ca2083c1f32f6#0 \
  --tx-in-script-file contracts/adadive-escrow/testnet/escrow_spend.plutus \
  --tx-in-datum-value '<SAME_DATUM_AS_ABOVE>' \
  --tx-in-redeemer-value '{"constructor": 2, "fields": []}' \
  --tx-out <CLIENT_WALLET>+10000000 \
  --tx-out <PROVIDER_WALLET>+0 \
  --change-address <CLIENT_WALLET> \
  --witness-override 2 \
  --out-file cancel_tx.draft
```

2. **Sign with Both Keys:**
```bash
cardano-cli transaction sign \
  --tx-body-file cancel_tx.draft \
  --signing-key-file client.skey \
  --signing-key-file provider.skey \
  --testnet-magic 1 \
  --out-file cancel_tx.signed
```

3. **Submit:**
```bash
cardano-cli transaction submit \
  --tx-file cancel_tx.signed \
  --testnet-magic 1
```

### C. SETTLE Transaction (Oracle + Provider)

**Prerequisites:**
- Both **Oracle** and **Provider** must sign
- Must be **BEFORE deadline**
- Provider receives the payment

**Steps:**

1. **Build Settle Transaction:**
```bash
cardano-cli transaction build \
  --testnet-magic 1 \
  --tx-in 21a57a8c09cc091bbe07102cd4a2acf2fbbac96682b8cb6a261ca2083c1f32f6#0 \
  --tx-in-script-file contracts/adadive-escrow/testnet/escrow_spend.plutus \
  --tx-in-datum-value '<SAME_DATUM_AS_ABOVE>' \
  --tx-in-redeemer-value '{"constructor": 0, "fields": []}' \
  --tx-out <PROVIDER_WALLET>+10000000 \
  --change-address <PROVIDER_WALLET> \
  --witness-override 2 \
  --out-file settle_tx.draft
```

2. **Sign with Oracle and Provider Keys:**
```bash
cardano-cli transaction sign \
  --tx-body-file settle_tx.draft \
  --signing-key-file oracle.skey \
  --signing-key-file provider.skey \
  --testnet-magic 1 \
  --out-file settle_tx.signed
```

3. **Submit:**
```bash
cardano-cli transaction submit \
  --tx-file settle_tx.signed \
  --testnet-magic 1
```

---

## 🛡️ Security Notes

### H-01 Fix Verified
The Cancel transaction **MUST** pay at least `deal.payment` (10,000,000 lovelace = 10 ADA) to the client. This prevents the theft vulnerability where client+provider could collude to steal all escrowed funds.

### Testnet Only
- All addresses are `addr_test1...` (Preprod)
- No real ADA is at risk
- Keys are for testnet only

### Key Safety
- NEVER share your seed phrases
- NEVER enter testnet keys on mainnet dApps
- Store signing keys securely
- Delete temporary key files after use

---

## 🔍 Verification Commands

### Check Escrow Balance
```bash
curl -s -X POST "https://preprod.koios.rest/api/v1/address_info" \
  -H "Content-Type: application/json" \
  -d '{"_addresses": ["addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2"]}'
```

### Check Wallet Balance
```bash
curl -s -X POST "https://preprod.koios.rest/api/v1/address_info" \
  -H "Content-Type: application/json" \
  -d '{"_addresses": ["addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7"]}'
```

### Get Current Tip
```bash
curl -s "https://preprod.koios.rest/api/v1/tip"
```

---

## 📞 Troubleshooting

### "UTxO not found"
- Wait for blockchain sync
- Check if UTxO was already spent
- Verify address is correct

### "Missing signatures"
- Ensure correct keys are used for each transaction type
- Check witness count matches required signatures

### "Past deadline" for Settle
- Current time must be before deadline timestamp
- Wait for appropriate time window

### "Insufficient funds"
- Ensure wallet has enough ADA for fees + min UTxO
- Refund/Cancel returns funds to wallet

---

## 📚 Additional Resources

- [Cardano Developer Portal](https://developers.cardano.org/)
- [cardano-cli Reference](https://docs.cardano.org/cardano-components/cardano-cli/reference)
- [Aiken Documentation](https://aiken-lang.org/)
- [Eternl Wallet](https://eternl.io/)
- [Preprod Testnet Faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/)
