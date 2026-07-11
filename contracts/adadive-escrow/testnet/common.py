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
# Escrow address (script compiled locally with Aiken v1.1.23)
ESCROW_ADDR  = "addr_test1wp6ejgmlrgsplddfe4llre3hegafjt0g9qxjxyjscp4dwlgutljm3"
# Script hash for on-chain validator (Blake2b-224 of raw Plutus bytecode)
SCRIPT_HASH  = "7599237f1a201fb5a9cd7ff1e637ca3a992de8280d231250c06ad77d"
ESCROW_PLUTUS = os.path.join(SCRIPT_DIR, "deal_escrow.plutus")  # V3 PlutusScript format
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
    Load the PlutusV3 validator from deal_escrow.plutus.

    The file uses the cardano-cli envelope format:
        {"type":"PlutusScriptV3","cborHex":"<hex>"}
    where cborHex = hex(CBOR(script_bytes)).

    For Plutus V3 scripts in the witness set, the raw Plutus bytecode
    should be used.
    """
    import cbor2
    from pycardano import PlutusV3Script, plutus_script_hash

    if not os.path.exists(ESCROW_PLUTUS):
        die(f"Script file not found: {ESCROW_PLUTUS}")

    with open(ESCROW_PLUTUS) as f:
        d = json.load(f)

    # Decode the CBOR wrapper to get raw Plutus script bytes
    cbor_bytes = bytes.fromhex(d["cborHex"])
    script_bytes = bytes(cbor2.loads(cbor_bytes))

    # Create PlutusV3Script with raw script bytes
    script = PlutusV3Script(script_bytes)

    # Verify the script hash matches our ESCROW_ADDR
    computed_hash = bytes(plutus_script_hash(script)).hex()
    if computed_hash != SCRIPT_HASH:
        warn(f"Script hash differs from SCRIPT_HASH constant:")
        warn(f"  Computed: {computed_hash}")
        warn(f"  SCRIPT_HASH: {SCRIPT_HASH}")
    else:
        info(f"Script hash verified: {computed_hash}")

    return script


def load_script_raw_bytes():
    """
    Return the raw Plutus bytecode (without any CBOR wrapper).
    This is needed for manual witness construction with CIP-0057 key layout.
    """
    import cbor2

    if not os.path.exists(ESCROW_PLUTUS):
        die(f"Script file not found: {ESCROW_PLUTUS}")

    with open(ESCROW_PLUTUS) as f:
        d = json.load(f)

    cbor_bytes = bytes.fromhex(d["cborHex"])
    return bytes(cbor2.loads(cbor_bytes))


def _patch_pycardano_witness_keys():
    """
    Removed - caused CBOR structure issues.
    """
    pass


# DO NOT apply the patch - it breaks transaction structure
# The original PyCardano key layout (6 for V2, 7 for V3) is correct for Conway era


# Patch PyCardano deepcopy methods to work around bugs
def _patch_pycardano_deepcopy():
    """Patch PyCardano __deepcopy__ methods to work around bugs.
    
    The bugs cause deepcopy to fail during transaction building because
    the original __deepcopy__ methods use from_cbor which fails with certain
    PyCardano internal data structures.
    """
    from pycardano import PlutusV3Script
    from pycardano.plutus import RawPlutusData
    import copy

    # Patch PlutusV3Script.__deepcopy__
    def patched_plutus_deepcopy(self, memo=None):
        return type(self)(bytes(self))
    PlutusV3Script.__deepcopy__ = patched_plutus_deepcopy

    # Patch RawPlutusData.__deepcopy__
    def patched_rawplutus_deepcopy(self, memo=None):
        # Create a new RawPlutusData with the same data
        return type(self)(self.data)
    RawPlutusData.__deepcopy__ = patched_rawplutus_deepcopy


# Apply the patch when this module is imported
_patch_pycardano_deepcopy()





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
# DealRedeemer constructors (append-only, Aiken constructor indices):
#   Settle = Constr(0, []) → CBORTag(0, [])
#   Refund = Constr(1, []) → CBORTag(1, [])
#   Cancel = Constr(2, []) → CBORTag(2, [])

# Aiken uses constructor indices for the DealDatum/DealRedeemer types.
# For Redeemer: Settle=Constr(0), Refund=Constr(1), Cancel=Constr(2)
_REDEEMER_TAG = {"settle": 0, "refund": 1, "cancel": 2}

def make_redeemer(action: str):
    """
    Build a Redeemer for the given action.

    action must be one of: "settle", "refund", "cancel"

    Aiken uses tag 121 (0x79) for PlutusData constructors.
    The encoding is:
    - Tag 121 = d8 79
    - [constructor_index, [fields...]]

    So for Settle (constructor 0) with no fields:
    - d8 79 82 00 80
    """
    from pycardano import Redeemer
    from pycardano.serialization import RawCBOR
    from cbor2 import dumps

    if action not in _REDEEMER_TAG:
        die(f"Unknown action '{action}'. Must be settle, refund, or cancel.")

    # Aiken uses tag 121 (0x79) for PlutusData constructors
    # Format: tag 121 + [constructor_index, [fields...]]
    constructor_index = _REDEEMER_TAG[action]
    redeemer_data = [constructor_index, []]  # e.g., [0, []] for Settle

    # Encode to CBOR using cbor2.dumps
    cbor_bytes = dumps(redeemer_data)  # e.g., 820080 for Settle
    # Wrap in tag 121: d8 79
    tag121_bytes = bytes([0xd8, 0x79]) + cbor_bytes

    # Create RawCBOR with the correct bytes
    return Redeemer(data=RawCBOR(cbor=tag121_bytes))


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
    from pycardano.serialization import RawCBOR
    from cbor2 import CBORTag, loads

    utxos = context.utxos(ESCROW_ADDR)
    info(f"Scanning {len(utxos)} UTxO(s) at escrow address…")

    for utxo in utxos:
        datum = utxo.output.datum
        if datum is None:
            continue
        
        try:
            # Handle both RawPlutusData and RawCBOR datum types
            if isinstance(datum, RawPlutusData):
                inner = datum.data
            elif isinstance(datum, RawCBOR):
                # Decode the RawCBOR to get the CBORTag
                raw_bytes = datum.cbor
                inner = loads(raw_bytes)
            else:
                continue
            
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
