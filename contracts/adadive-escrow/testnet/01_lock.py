#!/usr/bin/env python3
"""
Step 1: Lock funds into the ADADIVE escrow (preprod).

Builds and submits a transaction that:
  - Sends (payment + min-ADA) from the client wallet to the escrow script address
  - Attaches an inline DealDatum with the deal parameters
  - Requires only the client's signature

Usage:
    python3 01_lock.py [--payment LOVELACE] [--storage-gb N] \
                       [--duration-epochs N] [--deadline-hours N] \
                       [--data-hash HEX]

Defaults:
    payment        = 10 000 000 lovelace (10 ADA)
    storage-gb     = 10
    duration-epochs = 6   (~1 month on mainnet cadence)
    deadline-hours = 48   (2 days from now)
    data-hash      = sha256("adadive-test-data") hex
"""

import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (
    load_context, load_wallet, load_script, make_datum,
    current_posix_ms, ESCROW_ADDR, MIN_ADA, info, warn, die, check_balance,
)

from pycardano import (
    Address, TransactionBuilder, TransactionOutput, Value,
)


def parse_args():
    p = argparse.ArgumentParser(description="Lock funds into ADADIVE escrow")
    p.add_argument("--payment",         type=int,   default=10_000_000,
                   help="Lovelace to escrow (default: 10_000_000)")
    p.add_argument("--storage-gb",      type=int,   default=10)
    p.add_argument("--duration-epochs", type=int,   default=6)
    p.add_argument("--deadline-hours",  type=float, default=48.0,
                   help="Hours from now until settlement deadline (default: 48)")
    p.add_argument("--data-hash",       type=str,   default=None,
                   help="Hex of data hash (default: sha256('adadive-test-data'))")
    return p.parse_args()


def main():
    args = parse_args()

    print("=" * 70)
    print("ADADIVE — Step 1: Lock funds into escrow (preprod)")
    print("=" * 70)

    # ── Load wallets ─────────────────────────────────────────────────────────
    info("Loading wallets…")
    client_skey, client_vkey, client_addr, client_vkh   = load_wallet("client")
    _, provider_vkey, _, provider_vkh                    = load_wallet("provider")
    _, oracle_vkey,   _, oracle_vkh                      = load_wallet("oracle")

    info(f"  client:   {client_addr}")
    info(f"  provider: {bytes(provider_vkey.hash()).hex()}")
    info(f"  oracle:   {bytes(oracle_vkey.hash()).hex()}")

    # ── Deal parameters ───────────────────────────────────────────────────────
    now_ms       = current_posix_ms()
    deadline_ms  = now_ms + int(args.deadline_hours * 3_600_000)
    payment      = args.payment

    if args.data_hash:
        data_hash = bytes.fromhex(args.data_hash)
    else:
        data_hash = hashlib.sha256(b"adadive-test-data").digest()

    info(f"  payment:         {payment:,} lovelace ({payment / 1_000_000:.2f} ADA)")
    info(f"  storage_gb:      {args.storage_gb}")
    info(f"  duration_epochs: {args.duration_epochs}")
    info(f"  start_time:      {now_ms} ms")
    info(f"  deadline:        {deadline_ms} ms  (+{args.deadline_hours:.1f} hours)")
    info(f"  data_hash:       {data_hash.hex()}")

    # ── Check client balance ──────────────────────────────────────────────────
    balance = check_balance(str(client_addr))
    required = payment + MIN_ADA + 2_000_000   # payment + datum storage + tx fee headroom
    info(f"  client balance:  {balance:,} lovelace ({balance / 1_000_000:.2f} ADA)")
    if balance < required:
        die(
            f"Insufficient balance: need ≥ {required:,} lovelace, "
            f"have {balance:,}.  Fund the client wallet via the preprod faucet."
        )

    # ── Build datum ───────────────────────────────────────────────────────────
    datum = make_datum(
        client_vkh      = client_vkh,
        provider_vkh    = provider_vkh,
        oracle_vkh      = oracle_vkh,
        data_hash       = data_hash,
        payment         = payment,
        storage_gb      = args.storage_gb,
        duration_epochs = args.duration_epochs,
        start_time_ms   = now_ms,
        deadline_ms     = deadline_ms,
    )

    # ── Build transaction ─────────────────────────────────────────────────────
    info("Loading chain context…")
    ctx = load_context()

    escrow_addr_obj = Address.decode(ESCROW_ADDR)

    # Total lovelace locked at the script: payment + min-ADA overhead
    lock_lovelace = payment + MIN_ADA

    builder = TransactionBuilder(ctx)
    builder.add_input_address(client_addr)
    builder.add_output(
        TransactionOutput(
            escrow_addr_obj,
            Value(lock_lovelace),
            datum=datum,
            post_alonzo=True,   # inline datum (Babbage era)
        )
    )

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
    print("✅  LOCK SUCCESSFUL")
    print("=" * 70)
    print(f"  tx hash:   {tx_hash}")
    print(f"  locked:    {lock_lovelace:,} lovelace ({lock_lovelace / 1_000_000:.2f} ADA)")
    print(f"  payment:   {payment:,} lovelace")
    print(f"  deadline:  {deadline_ms} ms")
    print(f"  explorer:  https://preprod.cardanoscan.io/transaction/{tx_hash}")
    print()
    print("Save these values for settle / refund / cancel steps:")
    print(f"  CLIENT VKH:   {client_vkh.hex()}")
    print(f"  DEADLINE MS:  {deadline_ms}")
    print("=" * 70)


if __name__ == "__main__":
    main()
