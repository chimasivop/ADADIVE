#!/usr/bin/env node
/**
 * ADADIVE Escrow Settle Transaction via Mesh.js
 * 
 * Builds and submits a Settle transaction against the PlutusV3 escrow contract.
 * 
 * On-chain rules (escrow.ak Settle branch):
 *   • oracle AND provider must sign
 *   • tx validity range must end AT OR BEFORE datum.deadline
 *   • at least one output pays >= datum.payment lovelace to the provider's vkh
 * 
 * Usage:
 *   PROVIDER_SKEY=<hex_skey> ORACLE_SKEY=<hex_skey> npm run settle
 *   npm run settle -- --dry-run
 */

import * as fs from "fs";

// ─── Configuration ───────────────────────────────────────────────────────────

// Contract addresses and hashes
const ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq";
const SCRIPT_HASH = "5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8";

// Preprod BlockFrost endpoint
const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";
const BLOCKFROST_URL = "https://cardano-preprod.blockfrost.io/api/v0";

// Provider wallet info
const PROVIDER_ADDR = "addr_test1vqj4fqvpews3sn0hzs20k96xy68l6xmnpnlcevahlhdtx5sykmhxs";
const PROVIDER_VKH = "25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352";

// Oracle wallet info
const ORACLE_ADDR = "addr_test1vzl7xkqdzrce4rzj9v87zgldwsngu6mw05alq9dqzyjvasgaf40rl";
const ORACLE_VKH = "bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1";

// Client VKH (from the lock transaction) - for finding our UTxO
const CLIENT_VKH = "9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab";

// Lock transaction that created the escrow UTxO
const LOCK_TX_HASH = "143aeede087fe88c9fa7f7d954877cf83eb1ad01bebec524c2ac0b44c9b24e76";

// Plutus V3 script bytecode (from deal_escrow.plutus)
const PLUTUS_SCRIPT_CBOR = "59052601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cdc3a400530070024888966002600460106ea800e26466453001159800980098059baa0028cc0048c03cc040c040c040c040c040c040c0400064601e602060206020602060206020602060200032300f30103010001918079808000c8c03cc040c040c040c0400064601e602060206020602060200032300f301030103010301030103010001911919800800801912cc00400629422b30013371e6eb8c04800400e2946266004004602600280710114dc7a44100980718061baa0024888888888a6002444646600200200844b30010018a508acc004c8c966002602460386ea80062b30013371e6eb8c07cc074dd500080344cdc480299199119801001000912cc004006007132325980099b914881000018acc004c03800626eb4c08800a00a8102266008008604a0068100dd718100009811000a04232323300100137566044604600a44b3001001801c4c8c96600266e45221000018acc004c03c00626eacc08c00a00a810a266008008604c0068108dd718108009811800a04414bd6f7b6300a400114a080da294101b180f180e1baa301e001301b3754603a00314a3133002002301e001406480e26014602c6ea803a6eb0c024c058dd50074dd61804180b1baa00e4888966002b30013375e98103d8798000301c301d301d301d301d301d301d301d301d301d301a375400b15980099baf4c0103d8798000301c301d301d301d301d301d301d301d301d301d301d301d301a375400b159800acc006600266e3cdd7180e180d1baa005375c601660346ea8016942945018456600330013371e6eb8c070c068dd50029bae300c301a375400b4a14a280c2330013371e6eb8c02cc068dd50029bae300c301a375400b4a14a280c22941018452820308992cc004c004dd69805980d9baa0068acc004c004dd69805180d9baa0068acc004cdc49bad300a301b375400c904044bd456600260026eb4c024c06cdd5003456600266e24dd69804980d9baa0064830268322b30013001375a601e60366ea801a2b30013001375a601c60366ea801a2b3001337106eb4c03cc06cdd50031bad300e301b375400d1980098039bae301d301e301e301e301b375400d4a14a280ca2941019452820328a50406514a080ca2941019452820328a50406514a080c8dc42400114a080c22941018452820308992cc004c0400062b300133008003375c601a60366ea801a2b300133008003375c601860366ea801a2b30013259800980a980d9baa001899b89375a603c60386ea8004dd69807980e1baa0078a504068603a60366ea8c030c06cdd5002466002005375c601860366ea801a6eb4c02cc06cdd5003200a8a50406514a080ca294101945660026028003159800998040019bae301d301b375400d159800992cc004c054c06cdd5000c4cdc41bad300f301c375400e6eb4c078c070dd5000c5282034301d301b3754603a60366ea8012330010029bae301d301b375400d375a601660366ea8019005452820328a504065159800998040019bae301d301b375400d159800998040019bae300c301b375400d198008014dd7180e980d9baa0069bad300b301b375400c802a294101945282032406480c8c064dd500ac528203022c805260166ea801e601c0069112cc004c01000a2b3001300f37540150038b20208acc004c02000a2b3001300f37540150038b20208acc004cdc3a400800515980098079baa00a801c5901045900d201a4034300c300d001370e900018049baa0038b200e180380098019baa0078a4d13656400401";

// Colors for terminal output
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

function logInfo(msg: string) { console.log(`${BLUE}[INFO]${NC} ${msg}`); }
function logSuccess(msg: string) { console.log(`${GREEN}[SUCCESS]${NC} ${msg}`); }
function logError(msg: string) { console.log(`${RED}[ERROR]${NC} ${msg}`); }
function logWarn(msg: string) { console.log(`${YELLOW}[WARN]${NC} ${msg}`); }

// ─── Parse command line args ────────────────────────────────────────────────

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run") || args.includes("-n"),
  };
}

// ─── BlockFrost API Helper ──────────────────────────────────────────────────

async function bfGet(path: string): Promise<any> {
  const url = `${BLOCKFROST_URL}${path}`;
  const response = await fetch(url, {
    headers: { project_id: BF_PROJECT_ID },
  });
  if (!response.ok) {
    throw new Error(`Blockfrost request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getUtxosAtAddress(address: string): Promise<any[]> {
  return bfGet(`/addresses/${address}/utxos`);
}

async function getDatum(datumHash: string): Promise<any> {
  return bfGet(`/scripts/datum/${datumHash}`);
}

async function getTip(): Promise<any> {
  return bfGet("/blocks/latest");
}

async function submitTx(cborHex: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const url = `${BLOCKFROST_URL}/tx/submit`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      project_id: BF_PROJECT_ID,
      "Content-Type": "application/cbor",
    },
    body: Buffer.from(cborHex, "hex"),
  });
  
  if (response.ok) {
    const data = await response.json();
    return { success: true, txHash: data.tx_hash };
  } else {
    const error = await response.text();
    return { success: false, error };
  }
}

// ─── Parse DealDatum ────────────────────────────────────────────────────────

interface DealDatum {
  client_vkh: string;
  provider_vkh: string;
  oracle_vkh: string;
  data_hash: string;
  payment: bigint;
  storage_gb: number;
  duration_epochs: number;
  start_time: number;
  deadline: number;
  model: string;
  challenge_window: number;
  phase: string;
}

/**
 * Parse DealDatum from either CBOR hex string or JSON object from BlockFrost
 */
function parseDealDatum(input: string | object): DealDatum {
  let fields: any[];
  
  if (typeof input === "string") {
    // Parse from CBOR hex
    const bytes = Buffer.from(input, "hex");
    fields = parseCborFields(bytes);
  } else {
    // Parse from BlockFrost JSON format
    const json = input as any;
    if (json.json_value && json.json_value.fields) {
      // BlockFrost returns: { json_value: { constructor: 0, fields: [...] } }
      const f = json.json_value.fields;
      fields = f.map((field: any) => {
        if (field.bytes) return Buffer.from(field.bytes, "hex");
        if (typeof field.int === "number") return field.int;
        if (field.constructor !== undefined && field.fields !== undefined) {
          return { type: field.fields.length === 0 ? "constr0" : "constr", index: field.constructor };
        }
        return field;
      });
    } else if (json.fields) {
      // Direct format: { constructor: 0, fields: [...] }
      fields = json.fields.map((field: any) => {
        if (field.bytes) return Buffer.from(field.bytes, "hex");
        if (typeof field.int === "number") return field.int;
        if (field.constructor !== undefined && field.fields !== undefined) {
          return { type: field.fields.length === 0 ? "constr0" : "constr", index: field.constructor };
        }
        return field;
      });
    } else {
      throw new Error("Unknown datum format");
    }
  }
  
  return {
    client_vkh: fields[0]?.toString("hex") || "",
    provider_vkh: fields[1]?.toString("hex") || "",
    oracle_vkh: fields[2]?.toString("hex") || "",
    data_hash: fields[3]?.toString("hex") || "",
    payment: BigInt(fields[4] || 0),
    storage_gb: Number(fields[5] || 0),
    duration_epochs: Number(fields[6] || 0),
    start_time: Number(fields[7] || 0),
    deadline: Number(fields[8] || 0),
    model: fields[9]?.type === "constr0" ? "OracleAttested" : "unknown",
    challenge_window: Number(fields[10] || 0),
    phase: fields[11]?.type === "constr0" ? "Locked" : "unknown",
  };
}

function parseCborFields(bytes: Buffer): any[] {
  let offset = 0;
  
  // Skip CBOR tag (0xd8 0x79 = tag 121)
  if (bytes[offset] === 0xd8 && bytes[offset + 1] === 0x79) {
    offset += 2;
  }
  
  // Skip indefinite array marker (0x9f) or regular array
  if (bytes[offset] === 0x9f || (bytes[offset] >= 0x80 && bytes[offset] <= 0x97)) {
    offset += 1;
  }
  
  const fields: any[] = [];
  
  while (offset < bytes.length) {
    const tag = bytes[offset];
    
    // Break marker for indefinite array
    if (tag === 0xff) {
      break;
    }
    
    // Constructor tag
    if (tag === 0xd8 && bytes[offset + 1] === 0x79) {
      offset += 2;
      const constr = bytes[offset];
      if (constr === 0x80) { // Empty array = Constr(0, [])
        fields.push({ type: "constr0", index: 0 });
        offset += 1;
      } else {
        fields.push({ type: "constr", index: constr });
        offset += 1;
      }
      continue;
    }
    
    // Byte string (0x58 = length follows)
    if (tag === 0x58) {
      const len = bytes[offset + 1];
      const value = bytes.slice(offset + 2, offset + 2 + len);
      fields.push(value);
      offset += 2 + len;
      continue;
    }
    
    // Integer handling
    if (tag === 0x1a) { // uint32
      const value = bytes.readUInt32BE(offset + 1);
      fields.push(value);
      offset += 5;
      continue;
    }
    if (tag === 0x1b) { // uint64
      const value = Number(bytes.readBigUInt64BE(offset + 1));
      fields.push(value);
      offset += 9;
      continue;
    }
    if (tag <= 0x1f) { // small uint
      fields.push(tag);
      offset += 1;
      continue;
    }
    
    // Unknown - skip
    offset += 1;
  }
  
  return fields;
}

// ─── Parse Private Key ──────────────────────────────────────────────────────

function parseSkey(skeyHex: string): Buffer {
  const cleanHex = skeyHex.replace(/^5820/, "");
  return Buffer.from(cleanHex, "hex");
}

// ─── Create DealDatum CBOR ──────────────────────────────────────────────────

function createDealDatumCbor(datum: DealDatum): Buffer {
  // The original datum uses indefinite arrays (0x9f) and proper Constr encoding
  // Format: d8 79 (tag 121) + 9f (indefinite array) + fields + ff (break)
  
  const parts: number[] = [];
  
  const addBytes = (hex: string) => {
    const cleanHex = hex.replace(/^02/, "");
    // 0x58 = byte string, length byte follows
    parts.push(0x58, cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      parts.push(parseInt(cleanHex.slice(i, i + 2), 16));
    }
  };
  
  const addUint = (n: number | bigint) => {
    const num = typeof n === "bigint" ? Number(n) : n;
    if (num < 0x18) {
      parts.push(num);
    } else if (num < 0x100) {
      parts.push(0x18, num);
    } else if (num < 0x10000) {
      parts.push(0x19, (num >> 8) & 0xff, num & 0xff);
    } else if (num < 0x100000000) {
      parts.push(0x1a, (num >> 24) & 0xff, (num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff);
    } else {
      parts.push(0x1b);
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64BE(BigInt(num));
      parts.push(...buf);
    }
  };
  
  // Add Constr(0, []) for model and phase
  // d8 79 = tag 121, 80 = array of 0
  const addConstr0 = () => {
    parts.push(0xd8, 0x79, 0x80);
  };
  
  // Fields in order
  addBytes(datum.client_vkh);
  addBytes(datum.provider_vkh);
  addBytes(datum.oracle_vkh);
  addBytes(datum.data_hash);
  addUint(datum.payment);
  addUint(datum.storage_gb);
  addUint(datum.duration_epochs);
  addUint(datum.start_time);
  addUint(datum.deadline);
  addConstr0(); // model = Constr(0, [])
  addUint(datum.challenge_window);
  addConstr0(); // phase = Constr(0, [])
  
  // Wrap in: tag 121 + indefinite array + break marker
  // d8 79 = tag 121
  // 9f = indefinite array start
  // ... fields ...
  // ff = break marker
  const cbor: number[] = [0xd8, 0x79, 0x9f, ...parts, 0xff];
  return Buffer.from(cbor);
}

// ─── Main Settle Logic ──────────────────────────────────────────────────────

async function runSettle(args: Args) {
  console.log("=".repeat(70));
  console.log("ADADIVE — Settle Transaction via Mesh.js (Preprod)");
  console.log("=".repeat(70));
  
  // Load cardano-serialization-lib dynamically
  const Csl = await import("@emurgo/cardano-serialization-lib-nodejs");
  const CSL = (Csl as any).default || Csl;
  
  // Check for signing keys
  const providerSkey = process.env.PROVIDER_SKEY;
  const oracleSkey = process.env.ORACLE_SKEY;
  
  if (!providerSkey || !oracleSkey) {
    logError("Missing required environment variables:");
    if (!providerSkey) logError("  PROVIDER_SKEY - Provider's signing key hex");
    if (!oracleSkey) logError("  ORACLE_SKEY - Oracle's signing key hex");
    logInfo("\nExample:");
    logInfo('  PROVIDER_SKEY="5820..." ORACLE_SKEY="5820..." npm run settle');
    process.exit(1);
  }
  
  try {
    // Step 1: Load wallet keys
    logInfo("Loading signing keys...");
    const providerKey = parseSkey(providerSkey);
    const oracleKey = parseSkey(oracleSkey);
    logSuccess("Signing keys loaded");
    
    // Derive key hashes for inputs
    const providerPrivKey = CSL.PrivateKey.from_hex(providerKey.toString("hex"));
    const providerKeyHash = providerPrivKey.to_public().hash();
    const oraclePrivKey = CSL.PrivateKey.from_hex(oracleKey.toString("hex"));
    const oracleKeyHash = oraclePrivKey.to_public().hash();
    
    // Step 2: Get blockchain tip
    logInfo("Fetching blockchain tip...");
    const tip = await getTip();
    const currentSlot = parseInt(tip.slot);
    logInfo(`  Current slot: ${currentSlot}`);
    
    // Step 3: Find the escrow UTxO
    logInfo("Scanning escrow address for UTxO...");
    const escrowUtxos = await getUtxosAtAddress(ESCROW_ADDR);
    logInfo(`  Found ${escrowUtxos.length} UTxO(s) at escrow address`);
    
    let escrowUtxo = escrowUtxos.find(utxo => utxo.tx_hash === LOCK_TX_HASH);
    
    if (!escrowUtxo) {
      for (const utxo of escrowUtxos) {
        if (utxo.data_hash) {
          try {
            const datumJson = await getDatum(utxo.data_hash);
            if (datumJson && datumJson.cborHex) {
              const parsed = parseDealDatum(datumJson.cborHex);
              if (parsed.client_vkh === CLIENT_VKH) {
                escrowUtxo = utxo;
                break;
              }
            }
          } catch (e) {
            // Skip invalid datums
          }
        }
      }
    }
    
    if (!escrowUtxo) {
      logError(`No escrow UTxO found from lock tx: ${LOCK_TX_HASH}`);
      logInfo("Available UTxOs:");
      for (const utxo of escrowUtxos) {
        const lovelace = utxo.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0";
        logInfo(`  ${utxo.tx_hash}#${utxo.output_index}: ${parseInt(lovelace) / 1000000} ADA`);
      }
      process.exit(1);
    }
    
    logInfo(`  Found escrow UTxO: ${escrowUtxo.tx_hash}#${escrowUtxo.output_index}`);
    
    // Step 4: Parse the datum
    logInfo("Parsing escrow datum...");
    logInfo(`  data_hash: ${escrowUtxo.data_hash || 'none'}`);
    logInfo(`  inline_datum: ${escrowUtxo.inline_datum ? 'present' : 'none'}`);
    
    let datum: DealDatum;
    
    // Prefer inline_datum if available, otherwise fetch from data_hash
    if (escrowUtxo.inline_datum) {
      // Parse inline datum (CBOR hex string)
      datum = parseDealDatum(escrowUtxo.inline_datum);
    } else if (escrowUtxo.data_hash) {
      // Fetch datum from API (returns JSON format)
      const datumJson = await getDatum(escrowUtxo.data_hash);
      datum = parseDealDatum(datumJson);
    } else {
      logError("No datum found in escrow UTxO");
      process.exit(1);
    }
    
    logInfo(`  Client VKH:    ${datum.client_vkh}`);
    logInfo(`  Provider VKH:  ${datum.provider_vkh}`);
    logInfo(`  Oracle VKH:   ${datum.oracle_vkh}`);
    logInfo(`  Payment:      ${Number(datum.payment) / 1000000} ADA (${datum.payment.toString()} lovelace)`);
    logInfo(`  Deadline:      ${datum.deadline} ms`);
    logInfo(`  Phase:         ${datum.phase}`);
    
    // Step 5: Calculate TTL slot
    const deadlineSlot = Math.floor(datum.deadline / 1000);
    const ttlSlot = Math.min(deadlineSlot, currentSlot + 3600);
    logInfo(`  TTL slot:      ${ttlSlot} (deadline slot: ${deadlineSlot})`);
    
    // Step 6: Get collateral UTxOs
    logInfo("Fetching collateral UTxOs...");
    const providerUtxos = await getUtxosAtAddress(PROVIDER_ADDR);
    const oracleUtxos = await getUtxosAtAddress(ORACLE_ADDR);
    
    if (providerUtxos.length === 0) {
      logError("No UTxOs available at provider address");
      process.exit(1);
    }
    if (oracleUtxos.length === 0) {
      logError("No UTxOs available at oracle address");
      process.exit(1);
    }
    
    const providerCollateral = providerUtxos.find((u: any) => {
      const lovelace = parseInt(u.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0");
      return lovelace >= 5000000;
    });
    const oracleCollateral = oracleUtxos.find((u: any) => {
      const lovelace = parseInt(u.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0");
      return lovelace >= 5000000;
    });
    
    if (!providerCollateral) {
      logError("No suitable collateral UTxO at provider address (need >= 5 ADA)");
      process.exit(1);
    }
    if (!oracleCollateral) {
      logError("No suitable collateral UTxO at oracle address (need >= 5 ADA)");
      process.exit(1);
    }
    
    logInfo(`  Provider collateral: ${providerCollateral.tx_hash}#${providerCollateral.output_index}`);
    logInfo(`  Oracle collateral:   ${oracleCollateral.tx_hash}#${oracleCollateral.output_index}`);
    
    // Step 7: Build the Settle transaction
    logInfo("Building Settle transaction...");
    
    const minAda = 2000000n;
    const paymentLovelace = datum.payment;
    const providerPayout = paymentLovelace + minAda;
    
    // Transaction builder config
    logInfo("  Creating LinearFee...");
    let linearFee, txBuilderConfig, txBuilder;
    try {
      linearFee = CSL.LinearFee.new(
        CSL.BigNum.from_str("44"),
        CSL.BigNum.from_str("155381")
      );
      logInfo("  LinearFee created");
    } catch (e) {
      throw new Error(`Failed to create LinearFee: ${e}`);
    }
    
    logInfo("  Creating TransactionBuilderConfig...");
    // Create ex unit prices (cost per execution unit) using UnitInterval
    const memPrice = CSL.UnitInterval.new(
      CSL.BigNum.from_str("577"),
      CSL.BigNum.from_str("10000")
    );
    const stepPrice = CSL.UnitInterval.new(
      CSL.BigNum.from_str("721"),
      CSL.BigNum.from_str("1000000")
    );
    const exUnitPrices = CSL.ExUnitPrices.new(memPrice, stepPrice);
    
    try {
      txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(linearFee)
        .coins_per_utxo_byte(CSL.BigNum.from_str("4310"))
        .pool_deposit(CSL.BigNum.from_str("500000000"))
        .key_deposit(CSL.BigNum.from_str("2000000"))
        .max_value_size(5000)
        .max_tx_size(16384)
        .ex_unit_prices(exUnitPrices)
        .build();
      logInfo("  Config built");
    } catch (e) {
      throw new Error(`Failed to create config: ${e}`);
    }
    
    logInfo("  Creating TransactionBuilder...");
    try {
      txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);
      logInfo("  TransactionBuilder created");
    } catch (e) {
      throw new Error(`Failed to create TransactionBuilder: ${e}`);
    }
    
    // Create Plutus script
    const plutusScript = CSL.PlutusScript.new(Buffer.from(PLUTUS_SCRIPT_CBOR, "hex"));
    logInfo("  PlutusScript created");
    
    // Create datum
    const datumCbor = createDealDatumCbor(datum);
    const plutusData = CSL.PlutusData.from_bytes(datumCbor);
    logInfo("  PlutusData (datum) created");
    
    // Create redeemer: Settle = Constr(0, [])
    const redeemerData = CSL.PlutusData.new_constr_plutus_data(
      CSL.ConstrPlutusData.new(
        CSL.BigNum.from_str("0"),
        CSL.PlutusList.new()
      )
    );
    
    const redeemer = CSL.Redeemer.new(
      CSL.RedeemerTag.new_spend(),
      CSL.BigNum.from_str("0"),
      redeemerData,
      CSL.ExUnits.new(
        CSL.BigNum.from_str("10000000"),
        CSL.BigNum.from_str("10000000000")
      )
    );
    logInfo("  Redeemer created");
    
    // Create PlutusWitness with script, datum, and redeemer
    const plutusWitness = CSL.PlutusWitness.new(
      plutusScript,
      plutusData,
      redeemer
    );
    logInfo("  PlutusWitness created");
    
    // Add script input
    const escrowTxHash = CSL.TransactionHash.from_bytes(
      Buffer.from(escrowUtxo.tx_hash, "hex")
    );
    const escrowInput = CSL.TransactionInput.new(escrowTxHash, escrowUtxo.output_index);
    const escrowLovelace = parseInt(escrowUtxo.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0");
    const escrowValue = CSL.Value.new(CSL.BigNum.from_str(escrowLovelace.toString()));
    
    logInfo("  Adding Plutus script input...");
    txBuilder.add_plutus_script_input(
      plutusWitness,
      escrowInput,
      escrowValue
    );
    logInfo("  Script input added");
    
    // Add oracle collateral input
    const oracleTxHash = CSL.TransactionHash.from_bytes(
      Buffer.from(oracleCollateral.tx_hash, "hex")
    );
    const oracleInput = CSL.TransactionInput.new(oracleTxHash, oracleCollateral.output_index);
    const oracleLovelace = parseInt(oracleCollateral.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0");
    const oracleValue = CSL.Value.new(CSL.BigNum.from_str(oracleLovelace.toString()));
    
    txBuilder.add_key_input(oracleKeyHash, oracleInput, oracleValue);
    logInfo("  Collateral input added");
    
    // Set collateral using TxInputsBuilder
    const collateralInputs = CSL.TxInputsBuilder.new();
    collateralInputs.add_key_input(oracleKeyHash, oracleInput, oracleValue);
    txBuilder.set_collateral(collateralInputs);
    
    // Add output to provider
    const providerOutAddr = CSL.Address.from_bech32(PROVIDER_ADDR);
    const providerOutValue = CSL.Value.new(CSL.BigNum.from_str(providerPayout.toString()));
    const providerOutput = CSL.TransactionOutput.new(providerOutAddr, providerOutValue);
    txBuilder.add_output(providerOutput);
    
    // Set TTL
    logInfo("  Setting TTL...");
    txBuilder.set_ttl(ttlSlot);
    
    // Set required signers (provider + oracle) using add_required_signer
    logInfo("  Adding required signers...");
    const providerVkh = CSL.Ed25519KeyHash.from_hex(PROVIDER_VKH);
    const oracleVkh = CSL.Ed25519KeyHash.from_hex(ORACLE_VKH);
    txBuilder.add_required_signer(providerVkh);
    txBuilder.add_required_signer(oracleVkh);
    
    // Add change address
    logInfo("  Adding change address...");
    txBuilder.add_change_if_needed(CSL.Address.from_bech32(ORACLE_ADDR));
    
    // Build transaction body
    logInfo("Building transaction body...");
    let txBody;
    try {
      txBody = txBuilder.build();
    } catch (e) {
      throw new Error(`Failed to build transaction: ${e}`);
    }
    
    logInfo(`  Inputs: ${txBody.inputs().len()}`);
    logInfo(`  Outputs: ${txBody.outputs().len()}`);
    logInfo(`  TTL: ${txBody.ttl().to_str}`);
    
    // Create witness set
    const witnessSet = CSL.TransactionWitnessSet.new();
    
    // Add vkey witnesses
    const vkeyWitnesses = CSL.Vkeywitnesses.new();
    
    // Sign with provider key
    const providerTxHash = CSL.hash_transaction(txBody);
    const providerSig = providerPrivKey.sign(providerTxHash.to_bytes());
    const providerVkeyWitness = CSL.Vkey.from_public_key(providerPrivKey.to_public());
    const providerWitness = CSL.Vkeywitness.new(providerVkeyWitness, providerSig);
    vkeyWitnesses.add(providerWitness);
    
    // Sign with oracle key
    const oracleSig = oraclePrivKey.sign(providerTxHash.to_bytes());
    const oracleVkeyWitness = CSL.Vkey.from_public_key(oraclePrivKey.to_public());
    const oracleWitness = CSL.Vkeywitness.new(oracleVkeyWitness, oracleSig);
    vkeyWitnesses.add(oracleWitness);
    
    witnessSet.set_vkeys(vkeyWitnesses);
    
    // Add Plutus script witness
    const plutusWitnesses = CSL.PlutusWitnesses.new();
    const scriptWitness = CSL.PlutusWitness.new_plutus_witness(
      plutusScript,
      plutusData,
      redeemer,
      CSL.ExUnits.new(
        CSL.BigNum.from_str("10000000"),
        CSL.BigNum.from_str("10000000000")
      )
    );
    plutusWitnesses.add(scriptWitness);
    witnessSet.set_plutus_witnesses(plutusWitnesses);
    
    // Create transaction
    const tx = CSL.Transaction.new(
      txBody,
      witnessSet,
      CSL.AuxiliaryData.new()
    );
    
    // Serialize to CBOR
    const txCbor = Buffer.from(tx.to_bytes()).toString("hex");
    logInfo(`  Transaction size: ${tx.serialized_size()} bytes`);
    
    if (args.dryRun) {
      logInfo("\n🔍 DRY RUN - Transaction not submitted");
      logInfo(`  Tx CBOR (first 200 chars): ${txCbor.slice(0, 200)}...`);
      logSuccess("Dry run complete");
      return;
    }
    
    // Submit transaction
    logInfo("\nSubmitting transaction to BlockFrost...");
    const result = await submitTx(txCbor);
    
    if (result.success) {
      console.log("\n" + "=".repeat(70));
      logSuccess("✅ SETTLE TRANSACTION SUCCESSFUL");
      console.log("=".repeat(70));
      logInfo(`  Tx hash:    ${result.txHash}`);
      logInfo(`  Explorer:   https://preprod.cardanoscan.io/transaction/${result.txHash}`);
      logInfo(`  Paid out:   ${Number(datum.payment) / 1000000} ADA to provider`);
      console.log("=".repeat(70));
    } else {
      console.log("\n" + "=".repeat(70));
      logError("❌ SETTLE TRANSACTION FAILED");
      console.log("=".repeat(70));
      logError(`  Error: ${result.error}`);
      console.log("=".repeat(70));
      process.exit(1);
    }
    
  } catch (error: any) {
    logError(`Transaction failed: ${error.message}`);
    if (error.stack) {
      logInfo(error.stack.split("\n").slice(0, 5).join("\n"));
    }
    process.exit(1);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

const args = parseArgs();
runSettle(args);
