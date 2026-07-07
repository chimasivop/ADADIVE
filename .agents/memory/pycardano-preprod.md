---
name: PyCardano preprod API quirks
description: Version fixes, Constr encoding, script loading, and slot conversion for PyCardano on Cardano preprod in Replit.
---

## cbor2 / cbor2pure version conflict

`pip install pycardano` installs cbor2pure which imports `CBORDecodeValueError` from cbor2, but older cbor2 doesn't have it.

**Fix:** `pip install "cbor2==5.6.5" --force-reinstall` (must run AFTER pycardano install).

**Why:** cbor2pure is a zero-C fallback shim; it wraps cbor2 and needs ≥5.5.0. The Replit pip wrapper installs an older cbor2 by default.

**How to apply:** Any time pycardano is installed in a fresh Replit environment, run the cbor2 force-reinstall immediately after.

## Constr → CBORTag encoding

Aiken `Constr(N, fields)` maps to `cbor2.CBORTag(121 + N, fields)` for N = 0..6.  
Do NOT use `from pycardano import Constr` — it doesn't exist in this version.  
Use `from cbor2 import CBORTag` and wrap fields in `RawPlutusData(data=CBORTag(...))`.

Redeemer mapping: Settle = CBORTag(121,[]), Refund = CBORTag(122,[]), Cancel = CBORTag(123,[]).

## Script loading (escrow_spend.plutus)

cardano-cli envelope format: `cborHex = hex(CBOR(script_bytes))`.  
Decode ONCE before passing to PyCardano:
```python
script_bytes = cbor2.loads(bytes.fromhex(d["cborHex"]))
script = PlutusV2Script(script_bytes)
```
Hash verification: `script.hash().payload.hex()` should match known SCRIPT_HASH.

## Slot / POSIX-ms conversion

Use Blockfrost `/blocks/latest` dynamically:
```python
slot_of_posix_ms(ms) = latest_slot + (ms // 1000 - latest_time_unix_s)
```
1 slot = 1 second on preprod (post-Shelley). Hardcoding genesis is fragile.

## Settle TTL rule (critical)

Aiken `must_end_before: tx_latest <= deadline`.  
Set `invalid_hereafter = slot(deadline)` — NOT `slot(deadline) + 1`.  
+1 makes tx_latest > deadline and the validator rejects.

## Refund validity_start rule

Aiken `must_start_after: deadline < tx_earliest`.  
Set `invalid_before = slot(deadline) + 1` to ensure strict inequality.

## TransactionBuilder API (this PyCardano version)

Key confirmed signatures:
- `TransactionBuilder(ctx, ttl=N, validity_start=N, required_signers=[...])`
- `builder.add_input_address(addr)` — adds UTxOs from address as inputs/collateral
- `builder.add_script_input(utxo, script=script, redeemer=redeemer)` — index auto-managed
- `builder.build_and_sign(signing_keys=[...], change_address=addr)` → Transaction
- `TransactionOutput(addr, Value(lovelace), datum=RawPlutusData(...), post_alonzo=True)`
- `VerificationKeyHash(bytes)` — 28-byte constructor
