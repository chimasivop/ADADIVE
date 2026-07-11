#!/usr/bin/env python3
"""
Step 4: Cancel the escrow by mutual agreement (preprod).

On-chain rules (escrow.ak Cancel branch):
  • client AND provider must sign
  • at least one output pays >= datum.payment lovelace to the client's vkh
  • no time constraint — can be done at any point in the deal lifecycle

Usage:
    python3 04_cancel.py [--client-vkh HEX]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (
    load_context, load_wallet, load_script, make_redeemer,
    find_escrow_utxo,
    MIN_ADA, info, warn, die,
)

from pycardano import (
    TransactionBuilder, TransactionOutput, Value, VerificationKeyHash,
)
from pycardano.plutus import RawPlutusData
from pycardano.serialization import RawCBOR
from cbor2 import CBORTag, loads


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


def _datum_int(utxo, idx: int, name: str) -> int:
    fields = _get_datum_fields(utxo)
    if len(fields) > idx:
        return int(fields[idx])
    die(f"Could not read {name} from datum")


def _datum_vkh(utxo, idx: int, name: str) -> bytes:
    fields = _get_datum_fields(utxo)
    if len(fields) > idx and isinstance(fields[idx], bytes):
        return fields[idx]
    die(f"Could not read {name} from datum")


def parse_args():
    p = argparse.ArgumentParser(description="Cancel ADADIVE escrow by mutual agreement")
    p.add_argument("--client-vkh", type=str, default=None,
                   help="Hex VKH of the client (identifies the UTxO to spend)")
    return p.parse_args()


def main():
    args = parse_args()

    print("=" * 70)
    print("ADADIVE — Step 4: Cancel escrow (preprod)")
    print("=" * 70)

    # ── Load wallets ─────────────────────────────────────────────────────────
    info("Loading wallets…")
    client_skey,   client_vkey,   client_addr,   client_vkh   = load_wallet("client")
    provider_skey, provider_vkey, provider_addr, provider_vkh = load_wallet("provider")

    info(f"  client:   {client_addr}")
    info(f"  provider: {provider_addr}")

    if args.client_vkh:
        client_vkh_bytes = bytes.fromhex(args.client_vkh)
    else:
        client_vkh_bytes = client_vkh

    # ── Load context and find UTxO ────────────────────────────────────────────
    info("Loading chain context…")
    ctx = load_context()

    utxo = find_escrow_utxo(ctx, client_vkh_bytes)
    if utxo is None:
        die(
            "No matching escrow UTxO found.  "
            "Run 01_lock.py first, or verify --client-vkh is correct."
        )

    # ── Read deal parameters from datum ───────────────────────────────────────
    payment         = _datum_int(utxo, 4, "payment")
    prov_vkh_datum  = _datum_vkh(utxo, 1, "provider_vkh")

    info(f"  datum.payment:      {payment:,} lovelace")
    info(f"  datum.provider_vkh: {prov_vkh_datum.hex()}")

    if prov_vkh_datum != provider_vkh:
        warn(
            f"Datum provider_vkh ({prov_vkh_datum.hex()}) "
            f"!= loaded provider wallet ({provider_vkh.hex()}).  "
            "The validator requires the on-chain provider key — the tx will "
            "be rejected unless you use the correct provider wallet."
        )

    # ── Load script ───────────────────────────────────────────────────────────
    script = load_script()

    # ── Build redeemer ────────────────────────────────────────────────────────
    redeemer = make_redeemer("cancel")

    # ── Build transaction ─────────────────────────────────────────────────────
    # Cancel must return >= payment to the client (protects client from
    # collusion: provider can't drain the escrow via Cancel).
    client_return = TransactionOutput(
        client_addr,
        Value(payment + MIN_ADA),
    )

    builder = TransactionBuilder(ctx)

    # Required signers: client + provider
    builder.required_signers = [
        VerificationKeyHash(client_vkh_bytes),
        VerificationKeyHash(provider_vkh),
    ]

    builder.add_script_input(utxo, script=script, redeemer=redeemer)
    builder.add_output(client_return)
    # Client provides collateral (and covers tx fees via change)
    builder.add_input_address(client_addr)

    info("Building and signing transaction…")
    tx = builder.build_and_sign(
        signing_keys=[client_skey, provider_skey],
        change_address=client_addr,
    )

    tx_hash = tx.id.payload.hex()
    info(f"  tx hash: {tx_hash}")

    # ── Submit ────────────────────────────────────────────────────────────────
    info("Submitting transaction to Blockfrost…")
    ctx.submit_tx(tx)

    print()
    print("=" * 70)
    print("✅  CANCEL SUCCESSFUL")
    print("=" * 70)
    print(f"  tx hash:    {tx_hash}")
    print(f"  returned:   {payment:,} lovelace to client")
    print(f"  explorer:   https://preprod.cardanoscan.io/transaction/{tx_hash}")
    print("=" * 70)


if __name__ == "__main__":
    main()
