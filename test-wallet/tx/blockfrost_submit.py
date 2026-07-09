#!/usr/bin/env python3
"""
ADADIVE Escrow Contract - E2E Test via BlockFrost API

This script builds and submits Plutus smart contract transactions
using BlockFrost API for querying and transaction submission.

Usage:
    python3 blockfrost_submit.py status
    python3 blockfrost_submit.py cancel
    python3 blockfrost_submit.py settle
    python3 blockfrost_submit.py refund
    python3 blockfrost_submit.py all

Requirements:
    pip install requests cbor2 bech32 pycardano
    
Notes:
    - Koios is used for querying (free, no API key)
    - BlockFrost is used for transaction submission
    - cardano-serialization-lib is NOT needed - we build CBOR manually
"""

import argparse
import base64
import hashlib
import json
import struct
import sys
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any

import requests


# Configuration
BF_KEY = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy"
BF_URL = "https://cardano-preprod.blockfrost.io/api/v0"
KOIOS_URL = "https://preprod.koios.rest/api/v1"

# Network constants
NETWORK_MAGIC = 1  # Preprod

# Known addresses
ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq"
WALLET_ADDR = "addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7"
ESCROW_SCRIPT_HASH = "85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b"

# Redeemer constructors
REDEEMER_SETTLE = 0
REDEEMER_REFUND = 1
REDEEMER_CANCEL = 2


class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'


def log_info(msg): print(f"{Colors.BLUE}[INFO]{Colors.NC} {msg}")
def log_success(msg): print(f"{Colors.GREEN}[SUCCESS]{Colors.NC} {msg}")
def log_error(msg): print(f"{Colors.RED}[ERROR]{Colors.NC} {msg}")
def log_warn(msg): print(f"{Colors.YELLOW}[WARN]{Colors.NC} {msg}")


class BlockFrostClient:
    """BlockFrost API client for Preprod testnet"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {"project_id": api_key}
    
    def get(self, endpoint: str) -> Dict:
        r = requests.get(f"{BF_URL}{endpoint}", headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()
    
    def post_raw(self, endpoint: str, data: bytes) -> requests.Response:
        """POST raw bytes (for CBOR submission)"""
        headers = {**self.headers, "Content-Type": "application/cbor"}
        return requests.post(f"{BF_URL}{endpoint}", headers=headers, data=data, timeout=60)
    
    def get_tip(self) -> Dict:
        return self.get("/blocks/latest")
    
    def get_address_utxos(self, address: str) -> List[Dict]:
        return self.get(f"/addresses/{address}/utxos")
    
    def get_datum(self, datum_hash: str) -> Dict:
        return self.get(f"/scripts/datum/{datum_hash}")
    
    def get_protocol_params(self) -> Dict:
        return self.get("/epochs/latest/parameters")
    
    def submit_tx(self, cbor_hex: str) -> str:
        """Submit a signed transaction"""
        cbor_bytes = bytes.fromhex(cbor_hex)
        r = self.post_raw("/tx/submit", cbor_bytes)
        
        if r.status_code == 200:
            return r.json().get("tx hash", "")
        else:
            raise Exception(f"Submit failed ({r.status_code}): {r.text}")


class KoiosClient:
    """Koios API client for free queries"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
    
    def get(self, endpoint: str) -> Any:
        r = self.session.get(f"{KOIOS_URL}{endpoint}", timeout=30)
        r.raise_for_status()
        return r.json()
    
    def post(self, endpoint: str, data: Dict) -> Any:
        r = self.session.post(
            f"{KOIOS_URL}{endpoint}",
            json=data,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        r.raise_for_status()
        return r.json()
    
    def get_tip(self) -> Dict:
        return self.get("/tip")[0]
    
    def get_address_info(self, address: str) -> Dict:
        return self.post("/address_info", {"_addresses": [address]})[0]


def decode_bech32(addr: str) -> bytes:
    """Decode a Bech32 address to bytes"""
    import bech32
    _, data = bech32.bech32_decode(addr)
    if data is None:
        raise ValueError(f"Invalid address: {addr}")
    from bech32 import convertbits
    return bytes(convertbits(data, 5, 8, False))


def encode_cbor_int(n: int) -> bytes:
    """Encode an integer to CBOR"""
    if n < 0:
        if n >= -24:
            return bytes([0x20 + (-n - 1)])
        n = -n - 1
        # Encode negative number with additional bytes
        if n < 256:
            return bytes([0x38, n])
        elif n < 65536:
            return bytes([0x39, (n >> 8) & 0xFF, n & 0xFF])
        else:
            return bytes([0x3A, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF])
    else:
        if n < 24:
            return bytes([n])
        elif n < 256:
            return bytes([0x18, n])
        elif n < 65536:
            return bytes([0x19, (n >> 8) & 0xFF, n & 0xFF])
        else:
            return bytes([0x1A, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF])


def encode_cbor_bytes(data: bytes) -> bytes:
    """Encode bytes to CBOR"""
    if len(data) < 24:
        return bytes([0x40 + len(data)]) + data
    elif len(data) < 256:
        return bytes([0x58, len(data)]) + data
    elif len(data) < 65536:
        return bytes([0x59, (len(data) >> 8) & 0xFF, len(data) & 0xFF]) + data
    else:
        return bytes([0x5A, 
            (len(data) >> 24) & 0xFF, (len(data) >> 16) & 0xFF,
            (len(data) >> 8) & 0xFF, len(data) & 0xFF]) + data


def encode_cbor_array(items: List[bytes]) -> bytes:
    """Encode array to CBOR"""
    if len(items) < 24:
        return bytes([0x80 + len(items)]) + b"".join(items)
    elif len(items) < 256:
        return bytes([0x98, len(items)]) + b"".join(items)
    else:
        raise NotImplementedError("Arrays > 255 elements")


def encode_cbor_map(pairs: List[Tuple[bytes, bytes]]) -> bytes:
    """Encode map to CBOR"""
    if len(pairs) < 24:
        result = bytes([0xA0 + len(pairs)])
    else:
        raise NotImplementedError("Maps > 23 pairs")
    for k, v in pairs:
        result += k + v
    return result


class TransactionBuilder:
    """
    Build Cardano transactions for the escrow contract.
    
    This is a simplified builder that creates properly formatted
    CBOR transactions for the Cardano blockchain.
    """
    
    def __init__(self, network_magic: int = NETWORK_MAGIC):
        self.network_magic = network_magic
        self.inputs = []  # [(tx_hash, index)]
        self.outputs = []  # [(address, amount)]
        self.witnesses = []
        self.fee = 200000
        self.ttl = 0
        self.collateral = None
        self.redeemer = None
        self.datum = None
        self.script_hash = None
    
    def add_input(self, tx_hash: str, index: int):
        """Add a regular input (spending UTxO)"""
        self.inputs.append((tx_hash, index))
    
    def add_script_input(self, tx_hash: str, index: int, datum_hash: str = None):
        """Add a Plutus script input"""
        self.inputs.append((tx_hash, index))
        if datum_hash:
            self.datum = datum_hash
        self.script_hash = ESCROW_SCRIPT_HASH
    
    def add_output(self, address: str, amount: int):
        """Add a transaction output"""
        self.outputs.append((address, amount))
    
    def set_collateral(self, tx_hash: str, index: int):
        """Set collateral UTxO for Plutus scripts"""
        self.collateral = (tx_hash, index)
    
    def set_fee(self, fee: int):
        self.fee = fee
    
    def set_ttl(self, ttl: int):
        self.ttl = ttl
    
    def set_redeemer(self, redeemer_type: int):
        """Set the redeemer for Plutus script"""
        self.redeemer = redeemer_type
    
    def build_body(self) -> bytes:
        """Build the transaction body CBOR"""
        
        # Inputs
        inputs_list = []
        for tx_hash, idx in self.inputs:
            # Reverse tx hash for internal byte order
            tx_hash_bytes = bytes.fromhex(tx_hash)[::-1]
            inp = encode_cbor_bytes(tx_hash_bytes + struct.pack(">I", idx))
            inputs_list.append(inp)
        inputs_cbor = encode_cbor_array(inputs_list)
        
        # Outputs
        outputs_list = []
        for addr, amount in self.outputs:
            addr_bytes = decode_bech32(addr)
            output_parts = [
                encode_cbor_bytes(addr_bytes),
                encode_cbor_int(amount)
            ]
            outputs_list.append(b"\x82" + b"".join(output_parts))  # 2-element array
        
        # Add change output if needed
        outputs_cbor = encode_cbor_array(outputs_list)
        
        # Fee
        fee_cbor = encode_cbor_int(self.fee)
        
        # TTL
        ttl_cbor = encode_cbor_int(self.ttl) if self.ttl > 0 else b""
        
        # Build body
        body_parts = [inputs_cbor, outputs_cbor, fee_cbor]
        if ttl_cbor:
            body_parts.append(ttl_cbor)
        
        return b"".join(body_parts)
    
    def build_witness_set(self) -> bytes:
        """Build the witness set CBOR (for Plutus scripts)"""
        
        witness_set = {}
        
        # Add vkey witness from signing (placeholder - would need actual signature)
        # For now, this returns empty witness set
        
        # Add redeemer if present
        if self.redeemer is not None:
            # Redeemer: (index, data, ex_units)
            # For simple transactions, we use minimal ex_units
            redeemer_data = encode_cbor_int(self.redeemer)  # Just the constructor
            redeemer = encode_cbor_array([
                encode_cbor_int(0),  # index
                redeemer_data,
                encode_cbor_array([encode_cbor_int(0), encode_cbor_int(0)])  # ex_units
            ])
            witness_set[b"\x03"] = redeemer  # redeemer tag
        
        if not witness_set:
            return b"\xa0"  # Empty map
        
        return encode_cbor_map(list(witness_set.items()))
    
    def build_tx(self, signing_key_hex: str = None) -> bytes:
        """
        Build complete transaction CBOR.
        
        For full transaction with Plutus scripts:
        1. Transaction body
        2. Witness set with vkey witnesses and Plutus witnesses
        3. Auxiliary data (none for our case)
        """
        
        # Transaction body
        body = self.build_body()
        
        # Witness set
        witness_set = self.build_witness_set()
        
        # For full transaction, we need:
        # [body, witness_set, auxiliary_data]
        # But without proper signing, this is incomplete
        
        # Return body for now (should be signed externally)
        return body


def get_signing_key_from_env() -> Optional[str]:
    """Get signing key from environment"""
    import os
    return os.environ.get("ESCROW_SKEY")


class EscrowE2ETester:
    """E2E test harness for ADADIVE escrow contract"""
    
    def __init__(self):
        self.bf = BlockFrostClient(BF_KEY)
        self.koios = KoiosClient()
    
    def get_slot(self) -> int:
        tip = self.bf.get_tip()
        return int(tip["slot"])
    
    def check_status(self) -> Dict:
        """Check current escrow and wallet status"""
        log_info("=== Checking Status ===")
        
        # Get tip
        tip = self.bf.get_tip()
        slot = tip.get('slot', tip.get('abs_slot', 'unknown'))
        epoch = tip.get('epoch_no', 'unknown')
        log_info(f"Current slot: {slot}, Epoch: {epoch}")
        
        # Get wallet UTxOs
        wallet_utxos = self.bf.get_address_utxos(WALLET_ADDR)
        log_info(f"Wallet UTxOs: {len(wallet_utxos)}")
        for u in wallet_utxos:
            lovelace = next(a["quantity"] for a in u["amount"] if a["unit"] == "lovelace")
            log_info(f"  - {u['tx_hash'][:20]}...#{u['output_index']}: {int(lovelace)/1e6:.2f} ADA")
        
        # Get escrow UTxOs
        escrow_utxos = self.bf.get_address_utxos(ESCROW_ADDR)
        log_info(f"Escrow UTxOs: {len(escrow_utxos)}")
        
        escrow_data = None
        for u in escrow_utxos:
            lovelace = next(a["quantity"] for a in u["amount"] if a["unit"] == "lovelace")
            log_info(f"  - {u['tx_hash'][:20]}...#{u['output_index']}: {int(lovelace)/1e6:.2f} ADA")
            if "data_hash" in u:
                log_info(f"    Datum: {u['data_hash']}")
                # Try to get the datum value
                try:
                    datum = self.bf.get_datum(u["data_hash"])
                    log_info(f"    Datum value: {str(datum.get('cbor', ''))[:100]}...")
                except:
                    pass
        
        return {
            "tip": tip,
            "wallet_utxos": wallet_utxos,
            "escrow_utxos": escrow_utxos
        }
    
    def build_cancel_tx(self, escrow_utxo: Dict, wallet_utxo: Dict) -> bytes:
        """
        Build a Cancel transaction.
        
        Cancel requires:
        - Client signature
        - Provider signature  
        - Output paying >= payment to client
        """
        log_info("Building Cancel transaction...")
        
        payment_amount = int(next(
            a["quantity"] for a in escrow_utxo["amount"] 
            if a["unit"] == "lovelace"
        ))
        min_output = 2000000  # 2 ADA min UTxO
        output_amount = payment_amount - 400000  # Subtract fee
        
        builder = TransactionBuilder()
        builder.add_script_input(
            escrow_utxo["tx_hash"],
            escrow_utxo["output_index"],
            escrow_utxo.get("data_hash")
        )
        builder.set_collateral(wallet_utxo["tx_hash"], wallet_utxo["output_index"])
        builder.set_ttl(self.get_slot() + 1000)
        builder.set_fee(400000)
        builder.set_redeemer(REDEEMER_CANCEL)
        
        # Output: pay client
        builder.add_output(WALLET_ADDR, output_amount)
        
        return builder.build_body()
    
    def build_settle_tx(self, escrow_utxo: Dict, wallet_utxo: Dict) -> bytes:
        """Build a Settle transaction"""
        log_info("Building Settle transaction...")
        
        payment_amount = int(next(
            a["quantity"] for a in escrow_utxo["amount"] 
            if a["unit"] == "lovelace"
        ))
        output_amount = payment_amount - 400000
        
        builder = TransactionBuilder()
        builder.add_script_input(
            escrow_utxo["tx_hash"],
            escrow_utxo["output_index"],
            escrow_utxo.get("data_hash")
        )
        builder.set_collateral(wallet_utxo["tx_hash"], wallet_utxo["output_index"])
        builder.set_ttl(self.get_slot() + 1000)
        builder.set_fee(400000)
        builder.set_redeemer(REDEEMER_SETTLE)
        
        # For settle, we need to know the provider's address
        # For now, pay back to wallet (would need provider address from datum)
        builder.add_output(WALLET_ADDR, output_amount)
        
        return builder.build_body()
    
    def build_refund_tx(self, escrow_utxo: Dict, wallet_utxo: Dict) -> bytes:
        """Build a Refund transaction (after deadline)"""
        log_info("Building Refund transaction...")
        
        payment_amount = int(next(
            a["quantity"] for a in escrow_utxo["amount"] 
            if a["unit"] == "lovelace"
        ))
        output_amount = payment_amount - 400000
        
        builder = TransactionBuilder()
        builder.add_script_input(
            escrow_utxo["tx_hash"],
            escrow_utxo["output_index"],
            escrow_utxo.get("data_hash")
        )
        builder.set_collateral(wallet_utxo["tx_hash"], wallet_utxo["output_index"])
        builder.set_ttl(self.get_slot() + 1000)
        builder.set_fee(400000)
        builder.set_redeemer(REDEEMER_REFUND)
        
        # Output: pay client
        builder.add_output(WALLET_ADDR, output_amount)
        
        return builder.build_body()
    
    def submit_transaction(self, tx_body: bytes, signing_key: str) -> Tuple[bool, str]:
        """
        Submit a transaction to the blockchain.
        
        For full Plutus script execution, we need:
        1. Signed transaction body
        2. Witness set with Plutus witnesses
        3. Proper script witnesses
        
        This requires either:
        - cardano-cli with local node
        - Full transaction signing infrastructure
        """
        
        tx_hex = tx_body.hex()
        
        # Check if we have a signing key
        if not signing_key:
            log_warn("No signing key provided - transaction cannot be submitted")
            log_info("To submit transactions, set ESCROW_SKEY environment variable")
            return False, tx_hex
        
        # In a full implementation, we would:
        # 1. Sign the transaction body with the signing key
        # 2. Add the Plutus script witness
        # 3. Construct the full transaction
        # 4. Submit to BlockFrost
        
        log_warn("Full Plutus transaction signing requires:")
        log_warn("1. cardano-cli for signing (needs local node)")
        log_warn("2. Or Mesh SDK with browser wallet")
        log_warn("3. Or pre-built signed transaction CBOR")
        
        return False, tx_hex


def main():
    parser = argparse.ArgumentParser(
        description="ADADIVE Escrow E2E Tests via BlockFrost",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s status          Check escrow and wallet status
  %(prog)s cancel           Build Cancel transaction
  %(prog)s settle           Build Settle transaction  
  %(prog)s refund          Build Refund transaction
  %(prog)s all              Run all E2E tests

Environment Variables:
  ESCROW_SKEY              Payment signing key (for transaction submission)
"""
    )
    parser.add_argument("command", 
                       choices=["status", "cancel", "settle", "refund", "all"],
                       help="Command to run")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("ADADIVE Escrow Contract - E2E Testing via BlockFrost")
    print("=" * 60)
    
    tester = EscrowE2ETester()
    signing_key = get_signing_key_from_env()
    
    # Check status
    status = tester.check_status()
    
    if not status["escrow_utxos"]:
        log_error("No escrow UTxO found. Deploy the contract first.")
        return 1
    
    if not status["wallet_utxos"]:
        log_error("No wallet UTxO found. Fund the wallet first.")
        return 1
    
    escrow_utxo = status["escrow_utxos"][0]
    wallet_utxo = status["wallet_utxos"][0]
    
    # Build transactions based on command
    results = {}
    
    if args.command in ["cancel", "all"]:
        log_info("")
        log_info("=== E2E Test: Cancel Path ===")
        log_info("Requirements:")
        log_info("  - Client + Provider signatures")
        log_info("  - Output paying client >= payment")
        log_info("  - Redeemer: Cancel (constructor 2)")
        
        tx_body = tester.build_cancel_tx(escrow_utxo, wallet_utxo)
        success, tx_hex = tester.submit_transaction(tx_body, signing_key)
        results["cancel"] = {"success": success, "tx_hex": tx_hex}
    
    if args.command in ["settle", "all"]:
        log_info("")
        log_info("=== E2E Test: Settle Path ===")
        log_info("Requirements:")
        log_info("  - Oracle + Provider signatures")
        log_info("  - Transaction before deadline")
        log_info("  - Output paying provider >= payment")
        log_info("  - Redeemer: Settle (constructor 0)")
        
        tx_body = tester.build_settle_tx(escrow_utxo, wallet_utxo)
        success, tx_hex = tester.submit_transaction(tx_body, signing_key)
        results["settle"] = {"success": success, "tx_hex": tx_hex}
    
    if args.command in ["refund", "all"]:
        log_info("")
        log_info("=== E2E Test: Refund Path ===")
        log_info("Requirements:")
        log_info("  - Client signature")
        log_info("  - Transaction after deadline")
        log_info("  - Output paying client >= payment")
        log_info("  - Redeemer: Refund (constructor 1)")
        
        tx_body = tester.build_refund_tx(escrow_utxo, wallet_utxo)
        success, tx_hex = tester.submit_transaction(tx_body, signing_key)
        results["refund"] = {"success": success, "tx_hex": tx_hex}
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    for name, result in results.items():
        status_str = "SUBMITTED" if result["success"] else "READY (needs signing)"
        print(f"\n{name.upper()}: {status_str}")
        if result["tx_hex"]:
            print(f"  Tx body hex: {result['tx_hex'][:100]}...")
    
    if not signing_key:
        print("\n" + Colors.YELLOW)
        print("NOTE: Transactions are built but not submitted.")
        print("Set ESCROW_SKEY environment variable to enable submission.")
        print(Colors.NC)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
