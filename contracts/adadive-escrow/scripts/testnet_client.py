#!/usr/bin/env python3
"""
ADADIVE Escrow Contract - Preprod Testnet E2E Testing Client

Requirements:
    pip install blockfrost-python requests

Usage:
    # Set environment variables
    export BLOCKFROST_PROJECT_ID=\"preprod...\"
    export WALLET_MNEMONIC=\"word1 word2 ... word24\"
    
    # Run tests
    python3 scripts/testnet_client.py --test settle
    python3 scripts/testnet_client.py --test refund  
    python3 scripts/testnet_client.py --test cancel
    python3 scripts/testnet_client.py --all  # Run all tests
"""

import argparse
import json
import os
import sys
import tempfile
import subprocess
from datetime import datetime
from typing import Optional, Dict, Any

try:
    from blockfrost import BlockFrostApi, ApiError
    HAS_BLOCKFROST = True
except ImportError:
    HAS_BLOCKFROST = False


class TestnetConfig:
    """Preprod testnet configuration"""
    NETWORK = "preprod"
    MAGIC = 1
    
    # Script info
    SCRIPT_HASH = "85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b"


class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'


def log_info(msg): print(f"{Colors.GREEN}[INFO]{Colors.NC} {msg}")
def log_warn(msg): print(f"{Colors.YELLOW}[WARN]{Colors.NC} {msg}")
def log_error(msg): print(f"{Colors.RED}[ERROR]{Colors.NC} {msg}")
def log_success(msg): print(f"{Colors.GREEN}[PASS]{Colors.NC} {msg}")


def load_plutus_json(path: str) -> dict:
    """Load and extract validator from Aiken's plutus.json"""
    with open(path) as f:
        data = json.load(f)
    
    validators = {}
    for v in data.get('validators', []):
        title = v.get('title', '')
        if 'spend' in title:
            validators['spend'] = v
        elif 'else' in title:
            validators['else'] = v
    
    return validators


def create_deal_datum(
    client_vkh: str,
    provider_vkh: str,
    oracle_vkh: str,
    payment: int,
    storage_gb: int,
    duration_epochs: int,
    start_time: int,
    deadline: int
) -> dict:
    """Create a DealDatum for testing"""
    return {
        "constructor": 0,
        "fields": [
            {"bytes": client_vkh},
            {"bytes": provider_vkh},
            {"bytes": oracle_vkh},
            {"bytes": "deadbeef1234"},
            {"int": payment},
            {"int": storage_gb},
            {"int": duration_epochs},
            {"int": start_time},
            {"int": deadline},
            {"constructor": 0, "fields": []},
            {"int": 0},
            {"constructor": 0, "fields": []}
        ]
    }


class EscrowTester:
    """Test harness for escrow contract E2E tests"""
    
    def __init__(self, plutus_path: str, network: str = "preprod"):
        self.plutus = load_plutus_json(plutus_path)
        self.network = network
        self.script_hash = TestnetConfig.SCRIPT_HASH
        
        log_info(f"Loaded validators: {list(self.plutus.keys())}")
        log_info(f"Script hash: {self.script_hash}")
    
    def get_script_address(self, cardano_cli: str = "cardano-cli") -> Optional[str]:
        """Get the escrow script address using cardano-cli"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            script = {
                "type": "PlutusScriptV2",
                "cborHex": self.plutus['spend']['compiledCode']
            }
            json.dump(script, f)
            script_path = f.name
        
        try:
            result = subprocess.run([
                cardano_cli, "address", "build",
                "--payment-script-file", script_path,
                "--testnet-magic", str(TestnetConfig.MAGIC),
                "--out-file", "/dev/stdout"
            ], capture_output=True, text=True)
            
            if result.returncode == 0:
                return result.stdout.strip()
        finally:
            os.unlink(script_path)
        
        return None
    
    def check_funds(self, address: str, api_key: str = None) -> dict:
        """Check UTxOs at address using BlockFrost"""
        if not api_key:
            api_key = os.environ.get('BLOCKFROST_PROJECT_ID')
        
        if not api_key or not HAS_BLOCKFROST:
            log_warn("No BlockFrost API key or library unavailable")
            return {"utxos": [], "balance": 0}
        
        try:
            api = BlockFrostApi(project_id=api_key, network=TestnetConfig.NETWORK)
            utxos = api.address_utxos(address)
            total = sum(int(u.amount[0].quantity) for u in utxos)
            return {"utxos": utxos, "balance": total}
        except Exception as e:
            log_error(f"Failed to check funds: {e}")
            return {"utxos": [], "balance": 0}
    
    def test_settle(self) -> Dict[str, Any]:
        """TEST 1: Settle Path - Oracle and Provider sign to release funds"""
        log_info("=== E2E Test: Settle Path ===")
        log_info("Validates: OracleAttested deal resolution")
        
        datum = create_deal_datum(
            client_vkh="aabbccdd",
            provider_vkh="11223344",
            oracle_vkh="aabbccdd",
            payment=1_000_000,
            storage_gb=10,
            duration_epochs=6,
            start_time=int(datetime.now().timestamp() * 1000),
            deadline=int((datetime.now().timestamp() + 86400) * 1000)
        )
        
        redeemer = {"constructor": 0, "fields": []}  # Settle
        
        return {
            "test": "settle",
            "datum": datum,
            "redeemer": redeemer,
            "required_signatures": ["oracle", "provider"],
            "timeout": "before deadline"
        }
    
    def test_refund(self) -> Dict[str, Any]:
        """TEST 2: Refund Path - Client claims funds back after deadline"""
        log_info("=== E2E Test: Refund Path ===")
        log_info("Validates: Deadline enforcement, client-only unlock")
        
        deadline = int((datetime.now().timestamp() - 3600) * 1000)
        
        datum = create_deal_datum(
            client_vkh="aabbccdd",
            provider_vkh="11223344",
            oracle_vkh="aabbccdd",
            payment=1_000_000,
            storage_gb=10,
            duration_epochs=6,
            start_time=int((datetime.now().timestamp() - 86400) * 1000),
            deadline=deadline
        )
        
        redeemer = {"constructor": 1, "fields": []}  # Refund
        
        return {
            "test": "refund",
            "datum": datum,
            "redeemer": redeemer,
            "required_signatures": ["client"],
            "timeout": "after deadline",
            "security": "H-02: deadline > start_time validation"
        }
    
    def test_cancel(self) -> Dict[str, Any]:
        """TEST 3: Cancel Path - Both parties mutually agree to cancel"""
        log_info("=== E2E Test: Cancel Path ===")
        log_info("Validates: Mutual cancellation with H-01 theft fix")
        
        payment_amount = 1_000_000
        
        datum = create_deal_datum(
            client_vkh="aabbccdd",
            provider_vkh="11223344",
            oracle_vkh="aabbccdd",
            payment=payment_amount,
            storage_gb=10,
            duration_epochs=6,
            start_time=int(datetime.now().timestamp() * 1000),
            deadline=int((datetime.now().timestamp() + 86400) * 1000)
        )
        
        redeemer = {"constructor": 2, "fields": []}  # Cancel
        
        log_info("")
        log_warn("H-01 SECURITY FIX:")
        log_warn(f"  Output must pay >= {payment_amount} lovelace to client address")
        log_warn("  This prevents theft when client+provider collude")
        
        return {
            "test": "cancel",
            "datum": datum,
            "redeemer": redeemer,
            "required_signatures": ["client", "provider"],
            "min_client_payment": payment_amount,
            "security_fix": "H-01: paid_at_least(deal.payment) check"
        }
    
    def generate_cli_commands(self, test: str, escrow_addr: str = None) -> Dict[str, Any]:
        """Generate cardano-cli commands for the test"""
        test_methods = {
            'settle': self.test_settle,
            'refund': self.test_refund,
            'cancel': self.test_cancel
        }
        
        if test not in test_methods:
            log_error(f"Unknown test: {test}")
            return {}
        
        result = test_methods[test]()
        
        # Build output path
        output_dir = os.path.dirname(os.path.abspath(__file__))
        testnet_dir = os.path.join(os.path.dirname(output_dir), 'testnet')
        
        cli_script = f'''#!/bin/bash
# =============================================================================
# {test.upper()} Transaction for ADADIVE Escrow Contract
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/.."
TESTNET_DIR="$CONTRACT_DIR/testnet"

# Configuration
SCRIPT_FILE="$TESTNET_DIR/escrow_spend.plutus"
DATUM_FILE="$TESTNET_DIR/tx/{test}_datum.json"
REDEMER_FILE="$TESTNET_DIR/tx/{test}_redeemer.json"

mkdir -p "$TESTNET_DIR/tx"

# Create datum file
cat > "$DATUM_FILE" << 'DATUM_EOF'
{json.dumps(result["datum"], indent=2)}
DATUM_EOF

# Create redeemer file
cat > "$REDEMER_FILE" << 'REDEMER_EOF'
{json.dumps(result["redeemer"])}
REDEMER_EOF

# Build transaction
TX_UTXO="${{ESCROW_UTXO:-<tx_hash>#<utxo_index>}}"
PROVIDER_ADDR="${{PROVIDER_ADDR:-addr_test1...}}"
CLIENT_ADDR="${{CLIENT_ADDR:-addr_test1...}}"
WALLET_ADDR="${{WALLET_ADDR:-addr_test1...}}"
'''
        
        if test == 'settle':
            cli_script += f'''
OUT_ADDR="$PROVIDER_ADDR"
OUT_AMOUNT="<payment_plus_fees>"
'''
        elif test == 'refund':
            cli_script += f'''
OUT_ADDR="$CLIENT_ADDR"  
OUT_AMOUNT="<full_balance_minus_fees>"
'''
        elif test == 'cancel':
            cli_script += f'''
OUT_ADDR="$CLIENT_ADDR"
OUT_AMOUNT="<payment_amount_min>"
'''
        
        cli_script += f'''
cardano-cli transaction build \\
    --tx-in "$TX_UTXO" \\
    --tx-in-script-file "$SCRIPT_FILE" \\
    --tx-in-datum-file "$DATUM_FILE" \\
    --tx-in-redeemer-file "$REDEMER_FILE" \\
    --tx-out "$OUT_ADDR+$OUT_AMOUNT" \\
    --change-address "$WALLET_ADDR" \\
    --testnet-magic {TestnetConfig.MAGIC} \\
    --out-file "$TESTNET_DIR/tx/{test}_tx.draft"

# Sign transaction
cardano-cli transaction sign \\
    --tx-body-file "$TESTNET_DIR/tx/{test}_tx.draft" \\
    --signing-key-file <key1.skey> \\
    --signing-key-file <key2.skey> \\
    --testnet-magic {TestnetConfig.MAGIC} \\
    --out-file "$TESTNET_DIR/tx/{test}_tx.signed"

# Submit
cardano-cli transaction submit \\
    --tx-file "$TESTNET_DIR/tx/{test}_tx.signed" \\
    --testnet-magic {TestnetConfig.MAGIC}
'''
        
        return {
            "test_result": result,
            "cli_script": cli_script
        }


def main():
    parser = argparse.ArgumentParser(description="ADADIVE Escrow Testnet E2E Tests")
    parser.add_argument("--plutus", default="plutus.json", help="Path to plutus.json")
    parser.add_argument("--test", choices=["settle", "refund", "cancel"], 
                        help="Run specific test")
    parser.add_argument("--all", action="store_true", help="Run all tests")
    parser.add_argument("--api-key", help="BlockFrost API key")
    parser.add_argument("--generate-scripts", action="store_true", help="Generate bash scripts")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("ADADIVE Escrow Contract - Preprod Testnet E2E Testing")
    print("=" * 60)
    
    # Initialize tester
    tester = EscrowTester(args.plutus)
    
    # Run tests
    tests_to_run = []
    if args.all:
        tests_to_run = ["settle", "refund", "cancel"]
    elif args.test:
        tests_to_run = [args.test]
    else:
        log_error("Specify --test or --all")
        parser.print_help()
        return 1
    
    results = {}
    for test in tests_to_run:
        result = tester.generate_cli_commands(test)
        results[test] = result
        
        if args.generate_scripts:
            script_path = f"/workspace/project/ADADIVE/contracts/adadive-escrow/testnet/tx/{test}_tx.sh"
            os.makedirs(os.path.dirname(script_path), exist_ok=True)
            with open(script_path, 'w') as f:
                f.write(result['cli_script'])
            os.chmod(script_path, 0o755)
            log_success(f"Generated: {script_path}")
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    for test, result in results.items():
        test_result = result.get('test_result', {})
        print(f"\n{test.upper()}:")
        for key, value in test_result.items():
            print(f"  {key}: {value}")
    
    log_info("\nAll tests generated successfully!")
    log_warn("\nTo execute on testnet:")
    log_warn("1. Request test ADA from: https://docs.cardano.org/cardano-testnet/tools/faucet/")
    log_warn("2. Fund the escrow address")
    log_warn("3. Create a UTxO with DealDatum")
    log_warn("4. Run the generated bash scripts")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
