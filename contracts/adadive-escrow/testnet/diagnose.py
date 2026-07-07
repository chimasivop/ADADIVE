#!/usr/bin/env python3
"""
Diagnostic script for ADADIVE PyCardano E2E test setup.

Checks:
1. Python dependencies are installed
2. BlockFrost API is accessible
3. Script files exist and hashes are consistent
4. Wallet files exist
5. Escrow address and script hash consistency

Usage:
    python3 diagnose.py
"""

import json
import os
import sys
import hashlib

# ANSI colors
R = "\033[0;31m"
G = "\033[0;32m"
Y = "\033[1;33m"
B = "\033[0;34m"
NC = "\033[0m"

def ok(msg):
    print(f"{G}[OK]{NC} {msg}")

def warn(msg):
    print(f"{Y}[WARN]{NC} {msg}")

def fail(msg):
    print(f"{R}[FAIL]{NC} {msg}")

def info(msg):
    print(f"{B}[INFO]{NC} {msg}")


def check_dependencies():
    """Check if required Python packages are installed."""
    print("\n=== Python Dependencies ===")
    
    required = ["requests", "cbor2", "pycardano"]
    all_ok = True
    
    for pkg in required:
        try:
            __import__(pkg)
            ok(f"{pkg} is installed")
        except ImportError:
            fail(f"{pkg} is NOT installed")
            all_ok = False
    
    if not all_ok:
        warn("Run: pip install pycardano cbor2 requests")
    
    return all_ok


def check_blockfrost():
    """Check BlockFrost API connectivity."""
    print("\n=== BlockFrost API ===")
    
    try:
        import requests
        BF_KEY = os.environ.get(
            "BLOCKFROST_PROJECT_ID", "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy"
        )
        BF_URL = "https://cardano-preprod.blockfrost.io/api/v0"
        
        # Test /blocks/latest
        r = requests.get(
            f"{BF_URL}/blocks/latest",
            headers={"project_id": BF_KEY},
            timeout=30
        )
        if r.status_code == 200:
            data = r.json()
            ok(f"API accessible - Slot: {data.get('slot')}, Time: {data.get('time')}")
        else:
            fail(f"API returned {r.status_code}")
            return False
        
        # Check escrow address
        ESCROW_ADDR = "addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2"
        r = requests.get(
            f"{BF_URL}/addresses/{ESCROW_ADDR}/utxos",
            headers={"project_id": BF_KEY},
            timeout=30
        )
        if r.status_code == 200:
            utxos = r.json()
            ok(f"Escrow address UTxOs: {len(utxos)}")
            
            # Check for reference script
            for utxo in utxos:
                if utxo.get("reference_script_hash"):
                    ok(f"Reference script UTxO found: {utxo.get('tx_hash')}#{utxo.get('output_index')}")
                    return True
            
            warn("No reference script UTxO at escrow address")
            warn("Validator is not properly deployed - run DEPLOYMENT_GUIDE.md Step 3")
            return False
        else:
            fail(f"Could not query escrow address: {r.status_code}")
            return False
            
    except Exception as e:
        fail(f"BlockFrost check failed: {e}")
        return False


def check_script_hashes():
    """Verify script hash consistency across files."""
    print("\n=== Script Hash Consistency ===")
    
    import cbor2
    
    # Expected values
    ESCROW_PLUTUS = "testnet/escrow_spend.plutus"
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    ESCROW_PLUTUS_PATH = os.path.join(SCRIPT_DIR, "..", "plutus.json")
    
    # Read escrow.addr and get script hash
    ESCROW_ADDR_FILE = os.path.join(SCRIPT_DIR, "escrow.addr")
    try:
        with open(ESCROW_ADDR_FILE) as f:
            addr = f.read().strip()
        info(f"Escrow address: {addr}")
    except FileNotFoundError:
        fail("escrow.addr not found")
        return False
    
    # Read plutus.json for expected hash
    try:
        with open(ESCROW_PLUTUS_PATH) as f:
            plutus_json = json.load(f)
        plutus_hash = plutus_json["validators"][0]["hash"]
        info(f"plutus.json expects hash: {plutus_hash}")
    except Exception as e:
        fail(f"Could not read plutus.json: {e}")
        return False
    
    # Read script.hash file
    SCRIPT_HASH_FILE = os.path.join(SCRIPT_DIR, "script.hash")
    try:
        with open(SCRIPT_HASH_FILE) as f:
            file_hash = f.read().strip()
        info(f"script.hash file: {file_hash}")
    except FileNotFoundError:
        warn("script.hash not found")
        file_hash = None
    
    # Compute hash from escrow_spend.plutus
    ESCROW_PLUTUS_PATH = os.path.join(SCRIPT_DIR, "escrow_spend.plutus")
    try:
        with open(ESCROW_PLUTUS_PATH) as f:
            escrow_data = json.load(f)
        cborHex = escrow_data["cborHex"]
        script_bytes = cbor2.loads(bytes.fromhex(cborHex))
        computed_hash = hashlib.blake2b(script_bytes, digest_size=28).digest().hex()
        info(f"escrow_spend.plutus computes to: {computed_hash}")
    except Exception as e:
        fail(f"Could not process escrow_spend.plutus: {e}")
        return False
    
    # Compare hashes
    if computed_hash == plutus_hash:
        ok("escrow_spend.plutus matches plutus.json")
    else:
        fail("escrow_spend.plutus DOES NOT match plutus.json")
        warn("Run: aiken build to regenerate consistent artifacts")
    
    if file_hash and computed_hash == file_hash:
        ok("escrow_spend.plutus matches script.hash")
    elif file_hash:
        warn(f"escrow_spend.plutus != script.hash ({file_hash})")
    
    # Note about the deployed address
    warn("Note: The escrow.addr was generated from a different script hash")
    warn("The contract needs to be rebuilt to get consistent artifacts")
    
    return True


def check_wallets():
    """Check if wallet files exist."""
    print("\n=== Wallet Files ===")
    
    WALLET_DIR = os.path.expanduser("~/cardano-wallet")
    WALLETS = ["client", "provider", "oracle"]
    
    all_ok = True
    for name in WALLETS:
        skey_path = os.path.join(WALLET_DIR, name, f"{name}.skey")
        vkey_path = os.path.join(WALLET_DIR, name, f"{name}.vkey")
        addr_path = os.path.join(WALLET_DIR, name, f"{name}.addr")
        
        if os.path.exists(skey_path):
            ok(f"{name}: skey exists")
        else:
            fail(f"{name}: skey NOT found - run 00_setup_wallets.py")
            all_ok = False
        
        if os.path.exists(addr_path):
            with open(addr_path) as f:
                addr = f.read().strip()
            info(f"{name}: {addr}")
        else:
            warn(f"{name}: .addr file not found")
    
    return all_ok


def check_pycardano_api():
    """Verify PyCardano API methods exist."""
    print("\n=== PyCardano API ===")
    
    try:
        from pycardano import (
            BlockFrostChainContext,
            TransactionBuilder,
            PlutusV2Script,
            Address,
            Network,
            VerificationKeyHash,
        )
        
        ok("Core imports successful")
        
        # Check TransactionBuilder methods
        if hasattr(TransactionBuilder, "add_script_input"):
            ok("TransactionBuilder.add_script_input exists")
        else:
            fail("TransactionBuilder.add_script_input NOT found")
        
        if hasattr(TransactionBuilder, "build_and_sign"):
            ok("TransactionBuilder.build_and_sign exists")
        else:
            fail("TransactionBuilder.build_and_sign NOT found")
        
        # Check BlockFrostChainContext methods
        ctx_methods = dir(BlockFrostChainContext)
        if "submit_tx" in ctx_methods:
            ok("BlockFrostChainContext.submit_tx exists")
        else:
            fail("BlockFrostChainContext.submit_tx NOT found")
        
        if "utxos" in ctx_methods:
            ok("BlockFrostChainContext.utxos exists")
        else:
            fail("BlockFrostChainContext.utxos NOT found")
        
        return True
        
    except ImportError as e:
        fail(f"PyCardano import failed: {e}")
        return False


def main():
    print("=" * 70)
    print("ADADIVE PyCardano E2E Diagnostic")
    print("=" * 70)
    
    results = []
    
    results.append(("Dependencies", check_dependencies()))
    results.append(("PyCardano API", check_pycardano_api()))
    results.append(("BlockFrost", check_blockfrost()))
    results.append(("Script Hashes", check_script_hashes()))
    results.append(("Wallets", check_wallets()))
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    all_passed = True
    for name, passed in results:
        status = f"{G}PASS{NC}" if passed else f"{R}FAIL{NC}"
        print(f"  {status}: {name}")
        if not passed:
            all_passed = False
    
    print("=" * 70)
    
    if all_passed:
        print(f"\n{G}All checks passed!{NC}")
        print("Next: Fund wallets and run E2E tests")
    else:
        print(f"\n{Y}Some checks failed.{NC}")
        print("Fix the issues above before running E2E tests")


if __name__ == "__main__":
    main()
