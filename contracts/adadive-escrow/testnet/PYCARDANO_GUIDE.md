# ADADIVE Escrow — PyCardano E2E Test Guide

Run the full lock → settle / refund / cancel lifecycle on **Cardano Preprod**
entirely inside Replit — no `cardano-cli`, no local node required.

## Prerequisites

```bash
pip install pycardano cbor2 requests
```

Set your Blockfrost preprod project ID (optional — a default key is embedded):

```bash
export BLOCKFROST_PROJECT_ID=preprod<your-key>
```

## File Map

| File | Purpose |
|------|---------|
| `common.py` | Shared helpers (context, wallets, datum/redeemer builders, slot conversion) |
| `00_setup_wallets.py` | Generate client / provider / oracle keypairs |
| `01_lock.py` | Lock ADA into the escrow with an inline `DealDatum` |
| `02_settle.py` | Settle: oracle + provider co-sign, pay provider before deadline |
| `03_refund.py` | Refund: client reclaims after deadline with no settlement |
| `04_cancel.py` | Cancel: client + provider mutually unwind at any time |

---

## Step-by-Step

### 0 — Generate wallets

```bash
python3 00_setup_wallets.py
```

Writes to `~/cardano-wallet/{client,provider,oracle}/`.  
Fund each wallet via the **Preprod Faucet**:  
<https://docs.cardano.org/cardano-testnets/tools/faucet>

- **client** — needs ≥ 15 tADA (escrowed payment + fees + collateral)
- **provider** — needs ≥ 5 tADA (collateral for Settle tx)
- **oracle** — needs ≥ 5 tADA (collateral for Settle tx)

To regenerate overwriting existing keys:

```bash
python3 00_setup_wallets.py --force
```

---

### 1 — Lock funds

```bash
python3 01_lock.py
```

Optional flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--payment` | `10000000` | Lovelace escrowed for the provider |
| `--storage-gb` | `10` | GB the provider committed to |
| `--duration-epochs` | `6` | Deal duration in epochs |
| `--deadline-hours` | `48` | Hours from now until settlement deadline |
| `--data-hash` | sha256("adadive-test-data") | Hex of the IPFS CID / data hash |

Example — short deadline for quick testing:

```bash
python3 01_lock.py --payment 5000000 --deadline-hours 0.1
```

The script prints the **client VKH** and **deadline ms** — save them for the
next steps.

---

### 2a — Settle (before deadline)

```bash
python3 02_settle.py
```

Or with an explicit client VKH if client wallet is on a different machine:

```bash
python3 02_settle.py --client-vkh <hex>
```

**Contract rules enforced:**
- Oracle **and** provider must sign (`required_signers` in the tx body).
- `invalid_hereafter` (TTL) is set to `slot(deadline)` — satisfies  
  `must_end_before: tx_latest ≤ deadline`.  
  ⚠️ Do **not** use `deadline + 1`; that would make `tx_latest > deadline`
  and the validator would reject it.
- Provider receives ≥ `datum.payment` lovelace.

---

### 2b — Refund (after deadline)

```bash
python3 03_refund.py
```

**Contract rules enforced:**
- Only the client signs.
- `invalid_before` (validity start) is set to `slot(deadline) + 1` — satisfies  
  `must_start_after: deadline < tx_earliest`.
- Client receives ≥ `datum.payment` lovelace.

The script warns if the deadline has not yet passed on-chain.

---

### 2c — Cancel (mutual, any time)

```bash
python3 04_cancel.py
```

**Contract rules enforced:**
- Client **and** provider must sign.
- Client receives ≥ `datum.payment` lovelace (prevents Cancel collusion).
- No time constraint.

---

## Datum Encoding

```
DealDatum = Constr(0, [           -- CBORTag(121, [...])
  client_vkh,                     -- ByteArray (28 bytes)
  provider_vkh,                   -- ByteArray (28 bytes)
  oracle_vkh,                     -- ByteArray (28 bytes)
  data_hash,                      -- ByteArray
  payment,                        -- Int (lovelace)
  storage_gb,                     -- Int
  duration_epochs,                -- Int
  start_time_ms,                  -- Int (POSIX ms)
  deadline_ms,                    -- Int (POSIX ms)
  OracleAttested,                 -- Constr(0,[]) = CBORTag(121,[])
  0,                              -- challenge_window (v1 = 0)
  Locked,                         -- Constr(0,[]) = CBORTag(121,[])
])
```

## Redeemer Encoding

| Action | Aiken | CBORTag |
|--------|-------|---------|
| Settle | `Constr(0, [])` | `CBORTag(121, [])` |
| Refund | `Constr(1, [])` | `CBORTag(122, [])` |
| Cancel | `Constr(2, [])` | `CBORTag(123, [])` |

## Contract Address (Preprod)

```
addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2
```

Script hash: `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b`  
Explorer: <https://preprod.cardanoscan.io/contract/85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b>

---

## Troubleshooting

### "Script hash mismatch"
The `escrow_spend.plutus` file doesn't match the expected on-chain validator.
Re-run the Aiken build and redeploy.

### "No matching escrow UTxO found"
- Make sure `01_lock.py` was run and the transaction was confirmed (1–2 min).
- Pass `--client-vkh` explicitly if the client wallet is different from the
  wallet used when locking.

### "Insufficient balance"
Fund the indicated wallet via the preprod faucet and wait for confirmation.

### Settle rejected with "deadline check failed"
You used `ttl = deadline + 1`; the Aiken `must_end_before` check is `≤`, so
`tx_latest` must be **≤ deadline**, not `deadline + 1`.

### Refund rejected with "before deadline"
The on-chain clock has not yet passed the deadline.  Wait and retry.

### Execution unit errors
If PyCardano's auto-evaluation fails, you can patch `common.py`'s
`make_redeemer` to pass explicit `ExecutionUnits`:

```python
from pycardano.plutus import ExecutionUnits
Redeemer(data=..., ex_units=ExecutionUnits(mem=500_000, steps=200_000_000))
```
