"""
Shared helpers for ADADIVE PyCardano E2E test scripts.

Provides: context, wallet loading, datum/redeemer builders, slot conversion,
and UTxO lookup — all without cardano-cli or a local node.
"""

import json
import os
import sys
import requests

# ─── CONSTANTS ────────────────────────────────────────────────────────────────

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
WALLET_DIR   = os.path.expanduser("~/cardano-wallet")
ESCROW_ADDR  = "addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2"
SCRIPT_HASH  = "85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b"
ESCROW_PLUTUS = os.path.join(SCRIPT_DIR, "escrow_spend.plutus")
BF_URL       = "https://cardano-preprod.blockfrost.io/api/v0"
BF_KEY       = os.environ.get(
    "BLOCKFROST_PROJECT_ID", "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy"
)
MIN_ADA      = 2_000_000   # minimum lovelace added on top of escrowed payment

# ANSI colours
R = "\033[0;31m"; G = "\033[0;32m"; Y = "\033[1;33m"; NC = "\033[0m"

def info(msg):  print(f"{G}[INFO]{NC} {msg}")
def warn(msg):  print(f"{Y}[WARN]{NC} {msg}")
def die(msg):   print(f"{R}[ERROR]{NC} {msg}"); sys.exit(1)


# ─── BLOCKFROST CONTEXT ───────────────────────────────────────────────────────

def load_context():
    """Return a BlockFrostChainContext wired to Cardano preprod."""
    from pycardano import BlockFrostChainContext, Network
    return BlockFrostChainContext(BF_KEY, network=Network.TESTNET)


# ─── WALLET HELPERS ───────────────────────────────────────────────────────────

def wallet_dir(name: str) -> str:
    return os.path.join(WALLET_DIR, name)

def load_wallet(name: str):
    """
    Load a wallet from ~/cardano-wallet/<name>/<name>.skey.

    Returns (signing_key, verification_key, Address, vkh_bytes).
    """
    from pycardano import PaymentSigningKey, PaymentVerificationKey, Address, Network

    skey_path = os.path.join(wallet_dir(name), f"{name}.skey")
    if not os.path.exists(skey_path):
        die(f"Wallet not found: {skey_path}  — run 00_setup_wallets.py first")

    skey = PaymentSigningKey.load(skey_path)
    vkey = PaymentVerificationKey.from_signing_key(skey)
    addr = Address(payment_part=vkey.hash(), network=Network.TESTNET)
    vkh  = bytes(vkey.hash())
    return skey, vkey, addr, vkh


# ─── SCRIPT LOADER ────────────────────────────────────────────────────────────

def load_script():
    """
    Load the PlutusV2 validator from escrow_spend.plutus.

    The file uses the cardano-cli envelope format:
        {"type":"PlutusScriptV2","cborHex":"<hex>"}
    where cborHex = hex(CBOR(script_bytes)).
    We decode once to get the raw script bytes for PyCardano.
    """
    import cbor2
    from pycardano import PlutusV2Script

    if not os.path.exists(ESCROW_PLUTUS):
        die(f"Script file not found: {ESCROW_PLUTUS}")

    with open(ESCROW_PLUTUS) as f:
        d = json.load(f)

    # cborHex is CBOR-encoded script bytes (outer wrapper added by cardano-cli)
    script_bytes = cbor2.loads(bytes.fromhex(d["cborHex"]))
    script = PlutusV2Script(script_bytes)

    # Sanity-check: computed hash must match the known on-chain hash
    computed = bytes(script.hash()).hex()
    if computed != SCRIPT_HASH:
        warn(f"Script hash mismatch: computed {computed} != expected {SCRIPT_HASH}")
        warn("The validator on-chain may differ from escrow_spend.plutus.")
    else:
        info(f"Script hash verified: {computed}")

    return script


# ─── DATUM BUILDER ───────────────────────────────────────────────────────────
#
# DealDatum = Constr(0, [12 fields])  →  CBORTag(121, [...])
#
# Field order (matches types.ak DealDatum):
#   0  client_vkh      ByteArray (28 bytes)
#   1  provider_vkh    ByteArray (28 bytes)
#   2  oracle_vkh      ByteArray (28 bytes)
#   3  data_hash       ByteArray
#   4  payment         Int (lovelace)
#   5  storage_gb      Int
#   6  duration_epochs Int
#   7  start_time      Int (POSIX ms)
#   8  deadline        Int (POSIX ms)
#   9  model           SettlementModel.OracleAttested = Constr(0,[]) = CBORTag(121,[])
#  10  challenge_window Int (v1 = 0)
#  11  phase           DealPhase.Locked = Constr(0,[]) = CBORTag(121,[])

def make_datum(
    client_vkh: bytes,
    provider_vkh: bytes,
    oracle_vkh: bytes,
    data_hash: bytes,
    payment: int,
    storage_gb: int,
    duration_epochs: int,
    start_time_ms: int,
    deadline_ms: int,
):
    """Build a RawPlutusData-encoded DealDatum."""
    from pycardano.plutus import RawPlutusData
    from cbor2 import CBORTag

    constr_0 = CBORTag(121, [])   # Constr(0, []) — used for OracleAttested & Locked

    return RawPlutusData(data=CBORTag(121, [
        client_vkh,
        provider_vkh,
        oracle_vkh,
        data_hash,
        payment,
        storage_gb,
        duration_epochs,
        start_time_ms,
        deadline_ms,
        constr_0,   # model: OracleAttested
        0,          # challenge_window (v1 = 0)
        constr_0,   # phase: Locked
    ]))


# ─── REDEEMER BUILDER ────────────────────────────────────────────────────────
#
# DealRedeemer constructors (append-only):
#   Settle = Constr(0, []) → CBORTag(121, [])
#   Refund = Constr(1, []) → CBORTag(122, [])
#   Cancel = Constr(2, []) → CBORTag(123, [])

_REDEEMER_TAG = {"settle": 121, "refund": 122, "cancel": 123}

def make_redeemer(action: str):
    """
    Build a Redeemer for the given action.

    action must be one of: "settle", "refund", "cancel"
    """
    from pycardano import Redeemer
    from pycardano.plutus import RawPlutusData
    from cbor2 import CBORTag

    if action not in _REDEEMER_TAG:
        die(f"Unknown action '{action}'. Must be settle, refund, or cancel.")

    tag = _REDEEMER_TAG[action]
    return Redeemer(data=RawPlutusData(data=CBORTag(tag, [])))


# ─── SLOT / TIME CONVERSION ─────────────────────────────────────────────────

def _bf_latest_block():
    r = requests.get(f"{BF_URL}/blocks/latest",
                     headers={"project_id": BF_KEY}, timeout=30)
    r.raise_for_status()
    return r.json()

def posix_ms_to_slot(posix_ms: int) -> int:
    """
    Convert a POSIX-ms timestamp to the corresponding preprod slot number.

    Uses the latest block from Blockfrost as the reference point.
    1 slot = 1 second on preprod (post-Shelley).
    """
    block = _bf_latest_block()
    current_slot = block["slot"]
    current_time = block["time"]          # Unix seconds
    delta = posix_ms // 1000 - current_time
    return current_slot + delta

def current_posix_ms() -> int:
    """Return the current POSIX time in milliseconds (from Blockfrost)."""
    block = _bf_latest_block()
    return block["time"] * 1000


# ─── UTXO LOOKUP ─────────────────────────────────────────────────────────────

def find_escrow_utxo(context, client_vkh: bytes):
    """
    Search UTxOs at the escrow address for one whose inline datum has a
    matching client verification-key hash (first field of DealDatum).

    Returns the first matching UTxO, or None.
    """
    from pycardano.plutus import RawPlutusData
    from cbor2 import CBORTag

    utxos = context.utxos(ESCROW_ADDR)
    info(f"Scanning {len(utxos)} UTxO(s) at escrow address…")

    for utxo in utxos:
        datum = utxo.output.datum
        if datum is None:
            continue
        if not isinstance(datum, RawPlutusData):
            continue
        try:
            inner = datum.data  # CBORTag
            if not isinstance(inner, CBORTag):
                continue
            fields = inner.value
            if not fields or not isinstance(fields[0], bytes):
                continue
            if fields[0] == client_vkh:
                info(f"Found escrow UTxO: {str(utxo.input.transaction_id)}#{utxo.input.index}")
                return utxo
        except Exception:
            continue

    return None


# ─── BLOCKFROST HELPERS ──────────────────────────────────────────────────────

def bf_get(path: str):
    r = requests.get(f"{BF_URL}{path}", headers={"project_id": BF_KEY}, timeout=30)
    return r

def check_balance(address: str) -> int:
    """Return total lovelace at address (via Blockfrost), or 0 on error."""
    r = bf_get(f"/addresses/{address}")
    if r.status_code == 200:
        d = r.json()
        for a in d.get("amount", []):
            if a["unit"] == "lovelace":
                return int(a["quantity"])
    return 0
