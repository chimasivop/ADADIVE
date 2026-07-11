#!/usr/bin/env python3
"""
Step 3: Refund the escrow back to the client after the deadline (preprod).

On-chain rules (escrow.ak Refund branch):
  • client must sign
  • tx validity range must START strictly AFTER datum.deadline
    (must_start_after: deadline < tx_earliest)
  • at least one output pays >= datum.payment lovelace to the client's vkh

This script will fail if deadline has not yet passed.  Check the deadline
from the datum and wait until after it has passed on-chain.

Usage:
    python3 03_refund.py [--client-vkh HEX] [--deadline-ms N]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (
    load_context, load_wallet, load_script, make_redeemer,
    find_escrow_utxo, posix_ms_to_slot, current_posix_ms,
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


def parse_args():
    p = argparse.ArgumentParser(description="Refund ADADIVE escrow after deadline")
    p.add_argument("--client-vkh",  type=str, default=None,
                   help="Hex VKH of the client (identifies the UTxO to spend)")
    p.add_argument("--deadline-ms", type=int, default=None,
                   help="Override deadline from datum (POSIX ms)")
    return p.parse_args()


def main():
    args = parse_args()

    print("=" * 70)
    print("ADADIVE — Step 3: Refund escrow after deadline (preprod)")
    print("=" * 70)

    # ── Load client wallet ───────────────────────────────────────────────────
    info("Loading wallets…")
    client_skey, client_vkey, client_addr, client_vkh = load_wallet("client")
    info(f"  client: {client_addr}")

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
    deadline_ms = args.deadline_ms if args.deadline_ms else _datum_int(utxo, 8, "deadline")
    payment     = _datum_int(utxo, 4, "payment")

    info(f"  datum.deadline: {deadline_ms} ms")
    info(f"  datum.payment:  {payment:,} lovelace")

    # ── Guard: warn if deadline hasn't passed ─────────────────────────────────
    now_ms = current_posix_ms()
    if now_ms <= deadline_ms:
        remaining_s = (deadline_ms - now_ms) / 1000
        warn(
            f"Deadline has NOT yet passed "
            f"({remaining_s:.0f} seconds remaining on-chain).  "
            "The transaction will be rejected by the validator.  "
            "Wait until after the deadline and re-run."
        )

    # ── Compute validity_start slot ───────────────────────────────────────────
    # must_start_after: deadline < tx_earliest
    # → validity_start (invalid_before) must be > slot(deadline)
    # We add 1 slot to ensure strict inequality.
    validity_start_slot = posix_ms_to_slot(deadline_ms) + 1
    info(f"  validity_start (invalid_before): {validity_start_slot}")

    # ── Load script ───────────────────────────────────────────────────────────
    script = load_script()

    # ── Build redeemer ────────────────────────────────────────────────────────
    redeemer = make_redeemer("refund")

    # ── Build transaction ─────────────────────────────────────────────────────
    # Refund must pay >= payment to the client's vkh address.
    client_refund = TransactionOutput(
        client_addr,
        Value(payment + MIN_ADA),
    )

    builder = TransactionBuilder(ctx, validity_start=validity_start_slot)

    # Required signers: client only
    builder.required_signers = [VerificationKeyHash(client_vkh_bytes)]

    builder.add_script_input(utxo, script=script, redeemer=redeemer)
    builder.add_output(client_refund)
    # Client also provides collateral
    builder.add_input_address(client_addr)

    info("Building and signing transaction…")
    tx = builder.build_and_sign(
        signing_keys=[client_skey],
        change_address=client_addr,
    )

    tx_hash = tx.id.payload.hex()
    info(f"  tx hash: {tx_hash}")

    # ── Submit ────────────────────────────────────────────────────────────────
    info("Submitting transaction to Blockfrost…")
    ctx.submit_tx(tx)

    print()
    print("=" * 70)
    print("✅  REFUND SUCCESSFUL")
    print("=" * 70)
    print(f"  tx hash:    {tx_hash}")
    print(f"  refunded:   {payment:,} lovelace to client")
    print(f"  explorer:   https://preprod.cardanoscan.io/transaction/{tx_hash}")
    print("=" * 70)


if __name__ == "__main__":
    main()
