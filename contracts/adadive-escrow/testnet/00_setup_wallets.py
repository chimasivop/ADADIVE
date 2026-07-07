#!/usr/bin/env python3
"""
Step 0: Generate test wallets (client, provider, oracle) for preprod E2E tests.

Creates keypairs in ~/cardano-wallet/{client,provider,oracle}/ and prints
their addresses so you can fund them via the Cardano Preprod Faucet.

Usage:
    python3 00_setup_wallets.py

Requirements:
    pip install pycardano cbor2 requests
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WALLET_DIR, info, warn, die

from pycardano import (
    PaymentKeyPair,
    PaymentVerificationKey,
    Address,
    Network,
)


WALLETS = ["client", "provider", "oracle"]


def setup_wallet(name: str, force: bool = False):
    wdir = os.path.join(WALLET_DIR, name)
    os.makedirs(wdir, exist_ok=True)

    skey_path = os.path.join(wdir, f"{name}.skey")
    vkey_path = os.path.join(wdir, f"{name}.vkey")
    addr_path = os.path.join(wdir, f"{name}.addr")

    if os.path.exists(skey_path) and not force:
        warn(f"Wallet '{name}' already exists — skipping (use --force to overwrite)")
        skey = __import__("pycardano").PaymentSigningKey.load(skey_path)
        vkey = PaymentVerificationKey.from_signing_key(skey)
        addr = Address(payment_part=vkey.hash(), network=Network.TESTNET)
        return str(addr)

    pair = PaymentKeyPair.generate()
    pair.signing_key.save(skey_path)
    pair.verification_key.save(vkey_path)

    vkey = PaymentVerificationKey.from_signing_key(pair.signing_key)
    addr = Address(payment_part=vkey.hash(), network=Network.TESTNET)
    addr_str = str(addr)

    with open(addr_path, "w") as f:
        f.write(addr_str)

    info(f"Created wallet '{name}':")
    info(f"  skey → {skey_path}")
    info(f"  vkey → {vkey_path}")
    info(f"  addr → {addr_str}")
    return addr_str


def main():
    force = "--force" in sys.argv

    print("=" * 70)
    print("ADADIVE — Preprod Wallet Setup")
    print("=" * 70)

    addresses = {}
    for name in WALLETS:
        addresses[name] = setup_wallet(name, force=force)

    print()
    print("=" * 70)
    print("WALLET ADDRESSES (preprod)")
    print("=" * 70)
    for name, addr in addresses.items():
        print(f"  {name:10s}: {addr}")

    print()
    print("Next steps:")
    print("  1. Fund the CLIENT wallet with at least 20 tADA from the faucet:")
    print("     https://docs.cardano.org/cardano-testnets/tools/faucet")
    print(f"     Address: {addresses['client']}")
    print()
    print("  2. Fund the PROVIDER and ORACLE wallets with ≥ 5 tADA each")
    print("     (needed for collateral on Plutus spends).")
    print()
    print("  3. Run: python3 01_lock.py")
    print("=" * 70)


if __name__ == "__main__":
    main()
