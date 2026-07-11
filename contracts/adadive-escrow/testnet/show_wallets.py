#!/usr/bin/env python3
"""Display wallet information for manual funding."""
import os
from pycardano import PaymentSigningKey, PaymentVerificationKey, Address, Network

WALLET_DIR = os.path.expanduser("~/cardano-wallet")

print("""
================================================================================
CARDANO TESTNET WALLETS - FUND THESE ADDRESSES
================================================================================
Fund these addresses using the Cardano Testnet Faucet:
https://docs.cardano.org/cardano-testnet/tools/faucet/

Minimum funding: ~100 ADA each for testing
================================================================================
""")

for name in ["client", "provider", "oracle"]:
    wallet_dir = os.path.join(WALLET_DIR, name)
    skey_path = os.path.join(wallet_dir, f"{name}.skey")
    vkey_path = os.path.join(wallet_dir, f"{name}.vkey")
    
    skey = PaymentSigningKey.load(skey_path)
    vkey = PaymentVerificationKey.load(vkey_path)
    addr = Address(payment_part=vkey.hash(), network=Network.TESTNET)
    
    print(f"━━━ {name.upper()} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"Address: {addr}")
    print(f"VKH:     {bytes(vkey.hash()).hex()}")
    print()
    print(f"Signing Key (.skey):")
    print(skey.to_json())
    print()
    print(f"Verification Key (.vkey):")
    print(vkey.to_json())
    print()
    print("=" * 80)
    print()
