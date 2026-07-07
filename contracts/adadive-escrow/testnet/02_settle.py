#!/usr/bin/env python3
"""
Step 2: Settle the escrow — release payment to the provider (preprod).

On-chain rules (escrow.ak Settle branch):
  • oracle AND provider must sign
  • tx validity range must end AT OR BEFORE datum.deadline
    (must_end_before: tx_latest <= deadline)
  • at least one output pays >= datum.payment lovelace to the provider's vkh

Usage:
    python3 02_settle.py [--client-vkh HEX] [--deadline-ms N]

If --client-vkh is omitted the script scans the escrow address for the first
UTxO whose datum matches the provider wallet's address as provider_vkh — or
just grabs any UTxO whose datum was locked by the client wallet.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (
    load_context, load_wallet, load_script, make_redeemer,
    find_escrow_utxo, posix_ms_to_slot,
    ESCROW_ADDR, MIN_ADA, info, warn, die,
)

from pycardano import (
    Address, TransactionBuilder, TransactionOutput, Value, Network,
    VerificationKeyHash,
)
from pycardano.plutus import RawPlutusData
from pycardano.serialization import RawCBOR
from cbor2 import CBORTag, loads


def parse_args():
    p = argparse.ArgumentParser(description="Settle ADADIVE escrow")
    p.add_argument("--client-vkh",  type=str, default=None,
                   help="Hex VKH of the client (identifies the UTxO to spend)")
    p.add_argument("--deadline-ms", type=int, default=None,
                   help="Override deadline from datum (POSIX ms); normally read from datum")
    return p.parse_args()


def _get_datum_fields(utxo):
    """Extract CBOR fields from a UTxO's inline datum."""
    datum = utxo.output.datum
    if datum is None:
        die("No datum found in UTxO")
    
    try:
        if isinstance(datum, RawPlutusData):
            inner = datum.data
        elif isinstance(datum, RawCBOR):
            inner = loads(datum.cbor)
        else:
            die(f"Unknown datum type: {type(datum)}")
        
        if isinstance(inner, CBORTag):
            return inner.value
    except Exception as e:
        die(f"Could not decode datum: {e}")
    
    die("Datum is not a CBORTag")


def datum_deadline(utxo) -> int:
    """Extract datum.deadline (field index 8) from an escrow UTxO."""
    fields = _get_datum_fields(utxo)
    if len(fields) > 8:
        return int(fields[8])
    die("Could not read deadline from datum")


def datum_payment(utxo) -> int:
    """Extract datum.payment (field index 4) from an escrow UTxO."""
    fields = _get_datum_fields(utxo)
    if len(fields) > 4:
        return int(fields[4])
    die("Could not read payment from datum")


def datum_provider_vkh(utxo) -> bytes:
    """Extract datum.provider_vkh (field index 1) from an escrow UTxO."""
    fields = _get_datum_fields(utxo)
    if len(fields) > 1 and isinstance(fields[1], bytes):
        return fields[1]
    die("Could not read provider_vkh from datum")


def main():
    args = parse_args()

    print("=" * 70)
    print("ADADIVE — Step 2: Settle escrow (preprod)")
    print("=" * 70)

    # ── Load wallets ─────────────────────────────────────────────────────────
    info("Loading wallets…")
    provider_skey, provider_vkey, provider_addr, provider_vkh = load_wallet("provider")
    oracle_skey,   oracle_vkey,   oracle_addr,   oracle_vkh   = load_wallet("oracle")

    info(f"  provider: {provider_addr}")
    info(f"  oracle:   {oracle_addr}")

    # ── Find escrow UTxO ──────────────────────────────────────────────────────
    info("Loading chain context…")
    ctx = load_context()

    if args.client_vkh:
        client_vkh_bytes = bytes.fromhex(args.client_vkh)
    else:
        # Fall back: load client wallet to get its VKH
        try:
            _, _, _, client_vkh_bytes = load_wallet("client")
            info(f"  Using client VKH from wallet: {client_vkh_bytes.hex()}")
        except SystemExit:
            die("Pass --client-vkh HEX or ensure the client wallet exists.")

    utxo = find_escrow_utxo(ctx, client_vkh_bytes)
    if utxo is None:
        die(
            "No matching escrow UTxO found.  "
            "Run 01_lock.py first, or verify --client-vkh is correct."
        )

    # ── Read deal parameters from datum ───────────────────────────────────────
    deadline_ms = args.deadline_ms if args.deadline_ms else datum_deadline(utxo)
    payment     = datum_payment(utxo)
    prov_vkh_on_chain = datum_provider_vkh(utxo)

    info(f"  datum.deadline: {deadline_ms} ms")
    info(f"  datum.payment:  {payment:,} lovelace")

    if prov_vkh_on_chain != provider_vkh:
        warn(
            f"Datum provider_vkh ({prov_vkh_on_chain.hex()}) "
            f"!= loaded provider wallet ({provider_vkh.hex()}).  "
            "The settle tx will be signed by the loaded provider key — "
            "the validator will reject it if keys differ."
        )

    # ── Compute TTL slot ─────────────────────────────────────────────────────
    # must_end_before: tx_latest <= deadline  →  ttl = slot(deadline)
    # Do NOT use deadline + 1 — that would make tx_latest = deadline+1 > deadline.
    # But also cap TTL to within the current era (preprod era ends around slot 127958400)
    max_ttl_slot = 127958000  # A few hundred slots before era end
    ttl_slot = min(posix_ms_to_slot(deadline_ms), max_ttl_slot)
    info(f"  TTL slot (invalid_hereafter): {ttl_slot}")

    # ── Build redeemer ─────────────────────────────────────────────────────────
    redeemer = make_redeemer("settle")

    # ── Build transaction ─────────────────────────────────────────────────────
    # Settle must pay >= payment to the provider's vkh address.
    provider_payout = TransactionOutput(
        provider_addr,
        Value(payment + MIN_ADA),
    )

    builder = TransactionBuilder(ctx, ttl=ttl_slot)

    # Required signers: provider + oracle (checked by validator via `signed_by`)
    builder.required_signers = [
        VerificationKeyHash(provider_vkh),
        VerificationKeyHash(oracle_vkh),
    ]

    # Reload script to ensure it's fresh
    script = load_script()

    # Set execution units to reasonable values for estimation
    from pycardano import ExecutionUnits
    redeemer.ex_units = ExecutionUnits(10000000, 10000000000)

    builder.add_script_input(utxo, script=script, redeemer=redeemer)
    builder.add_output(provider_payout)
    # Collateral from oracle wallet (oracle pays collateral)
    builder.add_input_address(oracle_addr)

    info("Building and signing transaction…")
    tx = builder.build_and_sign(
        signing_keys=[provider_skey, oracle_skey],
        change_address=oracle_addr,
    )

    tx_hash = tx.id.payload.hex()
    info(f"  tx hash: {tx_hash}")

    # ── Submit ────────────────────────────────────────────────────────────────
    info("Submitting transaction to Blockfrost…")
    ctx.submit_tx(tx)

    print()
    print("=" * 70)
    print("✅  SETTLE SUCCESSFUL")
    print("=" * 70)
    print(f"  tx hash:    {tx_hash}")
    print(f"  paid out:   {payment:,} lovelace to provider")
    print(f"  explorer:   https://preprod.cardanoscan.io/transaction/{tx_hash}")
    print("=" * 70)


if __name__ == "__main__":
    main()
