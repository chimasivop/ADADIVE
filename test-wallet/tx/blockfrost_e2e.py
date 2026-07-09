#!/usr/bin/env python3
"""
ADADIVE Escrow Contract - E2E Test via BlockFrost API

This script builds and submits transactions to the Cardano Preprod testnet
using BlockFrost API for transaction submission and querying.

Usage:
    python3 blockfrost_e2e.py --test cancel
    python3 blockfrost_e2e.py --test settle
    python3 blockfrost_e2e.py --test refund
    python3 blockfrost_e2e.py --all

Requirements:
    pip install requests cbor2
"""

import argparse
import hashlib
import json
import struct
import subprocess
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

# Known addresses and keys
ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq"
WALLET_ADDR = "addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7"

# Script hash (from deployment)
SCRIPT_HASH = "85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b"


@dataclass
class UTxO:
    tx_hash: str
    output_index: int
    amount: int
    datum_hash: Optional[str] = None


@dataclass 
class TransactionOutput:
    address: str
    amount: int
    datum: Optional[Dict] = None


class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'


def log_info(msg):
    print(f"{Colors.BLUE}[INFO]{Colors.NC} {msg}")


def log_success(msg):
    print(f"{Colors.GREEN}[SUCCESS]{Colors.NC} {msg}")


def log_error(msg):
    print(f"{Colors.RED}[ERROR]{Colors.NC} {msg}")


def log_warn(msg):
    print(f"{Colors.YELLOW}[WARN]{Colors.NC} {msg}")


class BlockFrostClient:
    """BlockFrost API client for Preprod testnet"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = BF_URL
        self.headers = {"project_id": api_key}
    
    def get(self, endpoint: str) -> Dict:
        """GET request to BlockFrost"""
        r = requests.get(f"{self.base_url}{endpoint}", headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()
    
    def post(self, endpoint: str, data: bytes) -> Dict:
        """POST request to BlockFrost"""
        headers = {**self.headers, "Content-Type": "application/cbor"}
        r = requests.post(f"{self.base_url}{endpoint}", headers=headers, data=data, timeout=30)
        return r
    
    def get_tip(self) -> int:
        """Get current slot number"""
        data = self.get("/blocks/latest")
        return int(data["slot"])
    
    def get_address_utxos(self, address: str) -> List[UTxO]:
        """Get UTxOs at an address"""
        try:
            data = self.get(f"/addresses/{address}/utxos")
            utxos = []
            for u in data:
                amount = int(u["amount"][0]["quantity"])
                datum_hash = u.get("data_hash")
                utxos.append(UTxO(
                    tx_hash=u["tx_hash"],
                    output_index=int(u["output_index"]),
                    amount=amount,
                    datum_hash=datum_hash
                ))
            return utxos
        except Exception as e:
            log_error(f"Failed to get UTxOs: {e}")
            return []
    
    def get_protocol_params(self) -> Dict:
        """Get current protocol parameters"""
        data = self.get("/epochs/latest/parameters")
        return data
    
    def submit_tx(self, cbor_hex: str) -> str:
        """Submit a signed transaction"""
        cbor_bytes = bytes.fromhex(cbor_hex)
        headers = {**self.headers, "Content-Type": "application/cbor"}
        r = requests.post(
            f"{self.base_url}/tx/submit",
            headers=headers,
            data=cbor_bytes,
            timeout=60
        )
        if r.status_code == 200:
            return r.json().get("tx hash", "")
        else:
            raise Exception(f"Submit failed: {r.status_code} - {r.text}")


class KoiosClient:
    """Koios API client for Preprod testnet"""
    
    def __init__(self):
        self.base_url = KOIOS_URL
        self.headers = {"Accept": "application/json"}
    
    def post(self, endpoint: str, data: List) -> List:
        """POST request to Koios"""
        r = requests.post(
            f"{self.base_url}{endpoint}",
            headers=self.headers,
            json=data,
            timeout=30
        )
        r.raise_for_status()
        return r.json()


class CBOREncoder:
    """Minimal CBOR encoder for Cardano transactions"""
    
    @staticmethod
    def encode_int(n: int) -> bytes:
        if n == 0:
            return bytes([0x00])
        elif n > 0 and n < 24:
            return bytes([0x01 + n])
        elif n < 0 and n >= -24:
            return bytes([0x20 - n - 1])
        else:
            # Use definite length encoding
            if n >= 0:
                tag = 0x02  # positive integer
            else:
                tag = 0x03  # negative integer
                n = -n - 1
            # Calculate bytes needed
            if n < 256:
                return bytes([tag, n])
            elif n < 65536:
                return bytes([tag + 1, n >> 8, n & 0xFF])
            else:
                return bytes([tag + 2, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF])
    
    @staticmethod
    def encode_bytes(b: bytes) -> bytes:
        if len(b) < 24:
            return bytes([0x40 + len(b)]) + b
        elif len(b) < 256:
            return bytes([0x58, len(b)]) + b
        elif len(b) < 65536:
            return bytes([0x59, len(b) >> 8, len(b) & 0xFF]) + b
        else:
            return bytes([0x5A, 
                (len(b) >> 24) & 0xFF, (len(b) >> 16) & 0xFF,
                (len(b) >> 8) & 0xFF, len(b) & 0xFF]) + b
    
    @staticmethod
    def encode_array(items: List[bytes]) -> bytes:
        if len(items) < 24:
            return bytes([0x80 + len(items)]) + b"".join(items)
        else:
            raise NotImplementedError("Large arrays not implemented")
    
    @staticmethod
    def encode_map(pairs: List[Tuple[bytes, bytes]]) -> bytes:
        if len(pairs) < 24:
            result = bytes([0xA0 + len(pairs)])
        else:
            raise NotImplementedError("Large maps not implemented")
        for k, v in pairs:
            result += k + v
        return result


class TransactionBuilder:
    """Build Cardano transactions for the escrow contract"""
    
    def __init__(self, network_magic: int = NETWORK_MAGIC):
        self.network_magic = network_magic
        self.inputs = []  # (tx_hash, index, amount)
        self.outputs = []  # (address, amount, datum_hash)
        self.witnesses = []  # signatures
        self.fee = 200000  # Default fee
        self.ttl = 0  # Time to live (slot)
        self.certs = []
        self.withdrawals = []
        self.metadata = None
        self.mint = []
        self.script_data_hash = None
        self.collateral = None
    
    def add_input(self, tx_hash: str, index: int, amount: int):
        self.inputs.append((tx_hash, index, amount))
    
    def add_output(self, address: str, amount: int, datum_hash: str = None):
        self.outputs.append((address, amount, datum_hash))
    
    def add_witness(self, witness_bytes: bytes):
        self.witnesses.append(witness_bytes)
    
    def set_fee(self, fee: int):
        self.fee = fee
    
    def set_ttl(self, ttl: int):
        self.ttl = ttl
    
    def set_collateral(self, tx_hash: str, index: int):
        self.collateral = (tx_hash, index)
    
    def set_metadata(self, metadata: dict):
        self.metadata = metadata
    
    def build_tx_body(self) -> bytes:
        """Build transaction body CBOR"""
        # This is a simplified builder - in production, use a proper library
        # For now, we'll construct a basic transaction structure
        
        # Calculate total input
        total_in = sum(amt for _, _, amt in self.inputs)
        
        # Calculate total output
        total_out = sum(amt for _, amt, _ in self.outputs)
        
        # Change = total_in - total_out - fee
        change = total_in - total_out - self.fee
        
        # Network tag for testnet
        network_tag = bytes([self.network_magic & 0xFF])
        
        # Build inputs array
        inputs_array = b""
        for tx_hash, index, _ in self.inputs:
            # Each input: (hash, index)
            tx_hash_bytes = bytes.fromhex(tx_hash)[::-1]  # Reverse for CBOR
            inp = CBOREncoder.encode_bytes(tx_hash_bytes) + CBOREncoder.encode_int(index)
            inputs_array += inp
        
        inputs_cbor = CBOREncoder.encode_array([CBOREncoder.encode_bytes(
            bytes.fromhex(tx_hash)[::-1] + struct.pack(">I", idx)
        ) for tx_hash, idx, _ in self.inputs])
        
        # Build outputs array
        outputs_cbor = b""
        for addr, amt, datum_hash in self.outputs:
            # Output: (address, value, [datum_hash])
            addr_bytes = self._decode_bech32(addr)
            output_parts = [
                CBOREncoder.encode_bytes(addr_bytes),
                CBOREncoder.encode_int(amt)
            ]
            if datum_hash:
                output_parts.append(CBOREncoder.encode_bytes(bytes.fromhex(datum_hash)))
            outputs_cbor += b"\x82" + b"".join(output_parts)  # 2-element array + datum
        
        # Add change output
        if change > 0:
            change_addr_bytes = self._decode_bech32(WALLET_ADDR)
            outputs_cbor += b"\x82" + CBOREncoder.encode_bytes(change_addr_bytes) + CBOREncoder.encode_int(change)
        
        # Build full transaction body
        body = CBOREncoder.encode_array([
            inputs_cbor,
            outputs_cbor,
            CBOREncoder.encode_int(self.fee)
        ])
        
        if self.ttl > 0:
            body += CBOREncoder.encode_int(self.ttl)
        
        if self.collateral:
            collateral_cbor = CBOREncoder.encode_array([
                CBOREncoder.encode_bytes(bytes.fromhex(self.collateral[0])[::-1] + struct.pack(">I", self.collateral[1]))
            ])
            body += CBOREncoder.encode_int(1) + collateral_cbor
        
        return body
    
    def _decode_bech32(self, addr: str) -> bytes:
        """Decode a Bech32 address to bytes"""
        # Simplified - assumes testnet address format
        # In production, use a proper bech32 library
        import bech32
        _, data = bech32.bech32_decode(addr)
        if data is None:
            raise ValueError(f"Invalid address: {addr}")
        # Convert from base32 to bytes
        from bech32 import convertbits
        return bytes(convertbits(data, 5, 8, False))
    
    def sign_and_submit(self, signing_key_hex: str, bf_client: BlockFrostClient) -> str:
        """Sign the transaction and submit"""
        # Build transaction body
        tx_body = self.build_tx_body()
        
        # For Plutus scripts, we need to create a witness set
        # This is complex - let's use cardano-cli if available
        return self._submit_via_cli(tx_body, signing_key_hex, bf_client)
    
    def _submit_via_cli(self, tx_body: bytes, signing_key_hex: str, bf_client: BlockFrostClient) -> str:
        """Submit transaction using cardano-cli if available, otherwise return CBOR for manual submission"""
        # Check if cardano-cli is available
        cli_path = self._find_cardano_cli()
        
        if cli_path:
            return self._submit_with_cli(cli_path, signing_key_hex, bf_client)
        else:
            # Return the CBOR hex for manual submission
            return tx_body.hex()
    
    def _find_cardano_cli(self) -> Optional[str]:
        """Find cardano-cli in common locations"""
        import os
        paths = [
            "/home/openhands/cardano-node/cardano-cli",
            "/usr/local/bin/cardano-cli",
            "/usr/bin/cardano-cli",
            "./cardano-cli"
        ]
        for path in paths:
            if os.path.exists(path):
                return path
        return None
    
    def _submit_with_cli(self, cli_path: str, signing_key_hex: str, bf_client: BlockFrostClient) -> str:
        """Submit using cardano-cli with socket override"""
        import tempfile
        import subprocess
        
        # Save transaction body
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.cbor', delete=False) as f:
            tx_body_hex = self.build_tx_body().hex()
            f.write(bytes.fromhex(tx_body_hex))
            tx_body_path = f.name
        
        try:
            # Get protocol params from BlockFrost
            params = bf_client.get_protocol_params()
            
            # Save signing key
            with tempfile.NamedTemporaryFile(mode='w', suffix='.skey', delete=False) as f:
                # Convert hex to JSON signing key format
                skey = {
                    "type": "PaymentSigningKeyShelley_ed25519",
                    "description": "Payment Signing Key",
                    "cborHex": signing_key_hex
                }
                json.dump(skey, f)
                skey_path = f.name
            
            # Try to build raw transaction
            slot = bf_client.get_tip()
            ttl = slot + 1000
            
            # Build the command
            cmd = [
                cli_path, "babbage", "transaction", "build-raw",
                "--tx-body-file", tx_body_path,
                "--signing-key-file", skey_path,
                "--testnet-magic", str(self.network_magic),
                "--fee", str(self.fee),
                "--out-file", "/tmp/signed_tx.json"
            ]
            
            # This will likely fail without a socket, but worth trying
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                # Sign and submit
                sign_cmd = [
                    cli_path, "transaction", "sign",
                    "--tx-body-file", "/tmp/signed_tx.json",
                    "--signing-key-file", skey_path,
                    "--testnet-magic", str(self.network_magic),
                    "--out-file", "/tmp/final_tx.json"
                ]
                subprocess.run(sign_cmd, capture_output=True)
                
                # Get CBOR and submit via BlockFrost
                cbor_cmd = [
                    cli_path, "transaction", "to-cbor",
                    "--tx-file", "/tmp/final_tx.json"
                ]
                cbor_result = subprocess.run(cbor_cmd, capture_output=True, text=True)
                
                if cbor_result.returncode == 0:
                    cbor_hex = cbor_result.stdout.strip().replace(" ", "").replace("\n", "")
                    return bf_client.submit_tx(cbor_hex)
            
            # If CLI fails, return CBOR for manual submission
            log_warn("cardano-cli failed, returning CBOR for manual submission")
            return tx_body_hex
            
        finally:
            import os
            for path in [tx_body_path, skey_path]:
                if os.path.exists(path):
                    os.unlink(path)


class EscrowE2ETester:
    """E2E test harness for ADADIVE escrow contract"""
    
    def __init__(self, bf_client: BlockFrostClient, koios_client: KoiosClient):
        self.bf = bf_client
        self.koios = koios_client
        self.slot = None
    
    def get_slot(self) -> int:
        """Get current slot (cached)"""
        if self.slot is None:
            self.slot = self.bf.get_tip()
        return self.slot
    
    def test_cancel(self, escrow_utxo: UTxO, wallet_utxo: UTxO, 
                   client_vkh: str, provider_vkh: str, 
                   payment: int, signing_key_hex: str) -> Tuple[bool, str]:
        """
        Test the Cancel path of the escrow contract.
        
        Cancel requires:
        - Client signature
        - Provider signature  
        - Output paying >= payment to client address
        """
        log_info("=== E2E Test: Cancel Path ===")
        log_info("This tests H-01 fix: Cancel must pay client")
        
        slot = self.get_slot()
        
        # Build transaction
        builder = TransactionBuilder()
        builder.add_input(escrow_utxo.tx_hash, escrow_utxo.output_index, escrow_utxo.amount)
        builder.set_collateral(wallet_utxo.tx_hash, wallet_utxo.output_index)
        builder.set_fee(400000)  # Script execution requires higher fee
        builder.set_ttl(slot + 1000)
        
        # Output: pay client at least the payment amount
        # In Cancel, funds go back to client
        builder.add_output(WALLET_ADDR, payment - 400000, None)  # Subtract fee
        
        try:
            cbor_hex = builder.sign_and_submit(signing_key_hex, self.bf)
            tx_hash = self.bf.submit_tx(cbor_hex)
            log_success(f"Cancel transaction submitted: {tx_hash}")
            return True, tx_hash
        except Exception as e:
            log_error(f"Cancel test failed: {e}")
            return False, str(e)
    
    def test_settle(self, escrow_utxo: UTxO, wallet_utxo: UTxO,
                   provider_vkh: str, provider_addr: str,
                   payment: int, signing_key_hex: str) -> Tuple[bool, str]:
        """
        Test the Settle path.
        
        Settle requires:
        - Oracle signature
        - Provider signature
        - Transaction before deadline
        - Output paying >= payment to provider
        """
        log_info("=== E2E Test: Settle Path ===")
        log_info("Requires: Oracle + Provider signatures, before deadline")
        
        slot = self.get_slot()
        
        builder = TransactionBuilder()
        builder.add_input(escrow_utxo.tx_hash, escrow_utxo.output_index, escrow_utxo.amount)
        builder.set_collateral(wallet_utxo.tx_hash, wallet_utxo.output_index)
        builder.set_fee(400000)
        builder.set_ttl(slot + 1000)
        
        # Output: pay provider
        builder.add_output(provider_addr, payment - 400000, None)
        
        try:
            cbor_hex = builder.sign_and_submit(signing_key_hex, self.bf)
            tx_hash = self.bf.submit_tx(cbor_hex)
            log_success(f"Settle transaction submitted: {tx_hash}")
            return True, tx_hash
        except Exception as e:
            log_error(f"Settle test failed: {e}")
            return False, str(e)
    
    def test_refund(self, escrow_utxo: UTxO, wallet_utxo: UTxO,
                   client_vkh: str, payment: int, signing_key_hex: str) -> Tuple[bool, str]:
        """
        Test the Refund path (after deadline).
        
        Refund requires:
        - Client signature only
        - Transaction after deadline
        - Output paying >= payment to client
        """
        log_info("=== E2E Test: Refund Path ===")
        log_info("Requires: Client signature, after deadline, client gets paid")
        
        slot = self.get_slot()
        
        builder = TransactionBuilder()
        builder.add_input(escrow_utxo.tx_hash, escrow_utxo.output_index, escrow_utxo.amount)
        builder.set_collateral(wallet_utxo.tx_hash, wallet_utxo.output_index)
        builder.set_fee(400000)
        builder.set_ttl(slot + 1000)
        
        # Output: pay client
        builder.add_output(WALLET_ADDR, payment - 400000, None)
        
        try:
            cbor_hex = builder.sign_and_submit(signing_key_hex, self.bf)
            tx_hash = self.bf.submit_tx(cbor_hex)
            log_success(f"Refund transaction submitted: {tx_hash}")
            return True, tx_hash
        except Exception as e:
            log_error(f"Refund test failed: {e}")
            return False, str(e)
    
    def check_escrow_status(self) -> Dict[str, Any]:
        """Check current escrow status"""
        utxos = self.bf.get_address_utxos(ESCROW_ADDR)
        
        status = {
            "has_escrow_utxo": len(utxos) > 0,
            "utxos": []
        }
        
        for u in utxos:
            status["utxos"].append({
                "tx_hash": u.tx_hash,
                "output_index": u.output_index,
                "amount": u.amount,
                "datum_hash": u.datum_hash
            })
        
        return status


def main():
    parser = argparse.ArgumentParser(description="ADADIVE Escrow E2E Tests via BlockFrost")
    parser.add_argument("--test", choices=["cancel", "settle", "refund"],
                       help="Run specific test")
    parser.add_argument("--all", action="store_true", help="Run all tests")
    parser.add_argument("--check-status", action="store_true", help="Check escrow status only")
    parser.add_argument("--bf-key", default=BF_KEY, help="BlockFrost API key")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("ADADIVE Escrow Contract - E2E Testing via BlockFrost API")
    print("=" * 60)
    
    # Initialize clients
    bf_client = BlockFrostClient(args.bf_key)
    koios_client = KoiosClient()
    tester = EscrowE2ETester(bf_client, koios_client)
    
    # Check status
    if args.check_status or args.all:
        status = tester.check_escrow_status()
        print("\nEscrow Status:")
        print(f"  Has UTxO: {status['has_escrow_utxo']}")
        for u in status["utxos"]:
            print(f"  - {u['tx_hash'][:20]}...#{u['output_index']}: {u['amount']/1e6:.2f} ADA")
        
        if not status["has_escrow_utxo"]:
            log_warn("No escrow UTxO found. Deploy the contract first.")
            return 1
    
    # Get wallet UTxOs for collateral
    wallet_utxos = bf_client.get_address_utxos(WALLET_ADDR)
    if not wallet_utxos:
        log_error("No wallet UTxOs found. Fund the wallet first.")
        return 1
    
    wallet_utxo = wallet_utxos[0]
    log_info(f"Using wallet UTxO: {wallet_utxo.tx_hash[:20]}...#{wallet_utxo.output_index}")
    
    # Get escrow UTxOs
    escrow_status = tester.check_escrow_status()
    if not escrow_status["has_escrow_utxo"]:
        log_error("No escrow UTxO found. Deploy the contract first.")
        return 1
    
    escrow_utxo_data = escrow_status["utxos"][0]
    escrow_utxo = UTxO(
        tx_hash=escrow_utxo_data["tx_hash"],
        output_index=escrow_utxo_data["output_index"],
        amount=escrow_utxo_data["amount"],
        datum_hash=escrow_utxo_data.get("datum_hash")
    )
    log_info(f"Using escrow UTxO: {escrow_utxo.tx_hash[:20]}...#{escrow_utxo.output_index}")
    
    # Load signing key (would be provided by user in production)
    # For now, this is a placeholder
    signing_key = os.environ.get("ESCROW_SKEY", None)
    if not signing_key:
        log_error("Please set ESCROW_SKEY environment variable with signing key hex")
        log_info("Example: export ESCROW_SKEY='5820...your_hex_key'")
        return 1
    
    # Run tests
    results = {}
    if args.all or args.test == "cancel":
        results["cancel"] = tester.test_cancel(
            escrow_utxo, wallet_utxo,
            client_vkh="aabbccdd", provider_vkh="11223344",
            payment=escrow_utxo.amount - 200000,  # Subtract min ADA
            signing_key_hex=signing_key
        )
    
    if args.all or args.test == "settle":
        results["settle"] = tester.test_settle(
            escrow_utxo, wallet_utxo,
            provider_vkh="11223344", provider_addr=WALLET_ADDR,
            payment=escrow_utxo.amount - 200000,
            signing_key_hex=signing_key
        )
    
    if args.all or args.test == "refund":
        results["refund"] = tester.test_refund(
            escrow_utxo, wallet_utxo,
            client_vkh="aabbccdd",
            payment=escrow_utxo.amount - 200000,
            signing_key_hex=signing_key
        )
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    for test_name, (success, tx_hash) in results.items():
        status = "PASS" if success else "FAIL"
        print(f"  {test_name}: {status}")
        if tx_hash and len(tx_hash) < 100:
            print(f"    Tx: {tx_hash}")
    
    return 0


if __name__ == "__main__":
    import os
    sys.exit(main())
