#!/usr/bin/env node
/**
 * ADADIVE Escrow Settle Transaction via Mesh.js (New Wallet Version)
 * 
 * Uses the newly generated wallets from testnet/keys/
 * Creates a reference script UTxO and builds the Settle transaction.
 * 
 * Usage:
 *   npm run settle:v2
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { MeshTxBuilder, KoiosProvider, BlockfrostProvider } from "@meshsdk/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// Contract details from E2E_STATUS.md (V3)
const ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq";
const SCRIPT_HASH = "5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8";

// Keys directory
const KEYS_DIR = path.resolve(__dirname, "../../../contracts/adadive-escrow/testnet/keys");

// Plutus V3 script bytecode (full CBOR with envelope)
const PLUTUS_SCRIPT_CBOR = "59052601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cdc3a400530070024888966002600460106ea800e26466453001159800980098059baa0028cc0048c03cc040c040c040c040c040c040c0400064601e602060206020602060206020602060200032300f30103010001918079808000c8c03cc040c040c040c0400064601e602060206020602060200032300f301030103010301030103010001911919800800801912cc00400629422b30013371e6eb8c04800400e2946266004004602600280710114dc7a44100980718061baa0024888888888a6002444646600200200844b30010018a508acc004c8c966002602460386ea80062b30013371e6eb8c07cc074dd500080344cdc480299199119801001000912cc004006007132325980099b914881000018acc004c03800626eb4c08800a00a8102266008008604a0068100dd718100009811000a04232323300100137566044604600a44b3001001801c4c8c96600266e45221000018acc004c03c00626eacc08c00a00a810a266008008604c0068108dd718108009811800a04414bd6f7b6300a400114a080da294101b180f180e1baa301e001301b3754603a00314a3133002002301e001406480e26014602c6ea803a6eb0c024c058dd50074dd61804180b1baa00e4888966002b30013375e98103d8798000301c301d301d301d301d301d301d301d301d301d301a375400b15980099baf4c0103d8798000301c301d301d301d301d301d301d301d301d301d301d301d301a375400b159800acc006600266e3cdd7180e180d1baa005375c601660346ea8016942945018456600330013371e6eb8c070c068dd50029bae300c301a375400b4a14a280c2330013371e6eb8c02cc068dd50029bae300c301a375400b4a14a280c22941018452820308992cc004c004dd69805980d9baa0068acc004c004dd69805180d9baa0068acc004cdc49bad300a301b375400c904044bd456600260026eb4c024c06cdd5003456600266e24dd69804980d9baa0064830268322b30013001375a601e60366ea801a2b30013001375a601c60366ea801a2b3001337106eb4c03cc06cdd50031bad300e301b375400d1980098039bae301d301e301e301e301b375400d4a14a280ca2941019452820328a50406514a080ca2941019452820328a50406514a080c8dc42400114a080c22941018452820308992cc004c0400062b300133008003375c601a60366ea801a2b300133008003375c601860366ea801a2b30013259800980a980d9baa001899b89375a603c60386ea8004dd69807980e1baa0078a504068603a60366ea8c030c06cdd5002466002005375c601860366ea801a6eb4c02cc06cdd5003200a8a50406514a080ca294101945660026028003159800998040019bae301d301b375400d159800992cc004c054c06cdd5000c4cdc41bad300f301c375400e6eb4c078c070dd5000c5282034301d301b3754603a60366ea8012330010029bae301d301b375400d375a601660366ea8019005452820328a504065159800998040019bae301d301b375400d159800998040019bae300c301b375400d198008014dd7180e980d9baa0069bad300b301b375400c802a294101945282032406480c8c064dd500ac528203022c805260166ea801e601c0069112cc004c01000a2b3001300f37540150038b20208acc004c02000a2b3001300f37540150038b20208acc004cdc3a400800515980098079baa00a801c5901045900d201a4034300c300d001370e900018049baa0038b200e180380098019baa0078a4d13656400401";

// Colors
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

const logInfo = (msg: string) => console.log(`${BLUE}[INFO]${NC} ${msg}`);
const logSuccess = (msg: string) => console.log(`${GREEN}[SUCCESS]${NC} ${msg}`);
const logWarn = (msg: string) => console.log(`${YELLOW}[WARN]${NC} ${msg}`);
const logError = (msg: string) => console.log(`${RED}[ERROR]${NC} ${msg}`);

// ─── Load Wallet Keys ───────────────────────────────────────────────────────

interface WalletKeys {
  name: string;
  address: string;
  privateKeyHex: string;
  publicKeyHex: string;
  verificationKeyHash: string;
}

function loadWalletKeys(name: string): WalletKeys {
  // First try the new keys directory
  const walletFile = path.join(KEYS_DIR, name, "keys.json");
  if (!fs.existsSync(walletFile)) {
    // Fall back to the old keys directory
    const oldWalletFile = path.join(KEYS_DIR, "..", "keys", "old", `${name}_hex.json`);
    if (fs.existsSync(oldWalletFile)) {
      const data = JSON.parse(fs.readFileSync(oldWalletFile, "utf-8"));
      return {
        name: data.name,
        address: data.address,
        privateKeyHex: data.privateKeyHex,
        publicKeyHex: "",
        verificationKeyHash: ""
      };
    }
    throw new Error(`Wallet keys not found: ${walletFile}`);
  }
  return JSON.parse(fs.readFileSync(walletFile, "utf-8"));
}

// ─── BlockFrost Helper ─────────────────────────────────────────────────────

async function bfFetch(path: string) {
  const url = `https://cardano-preprod.blockfrost.io/api/v0${path}`;
  const response = await fetch(url, {
    headers: { project_id: BF_PROJECT_ID },
  });
  if (!response.ok) {
    throw new Error(`Blockfrost request failed: ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Settle Transaction via Mesh.js (New Wallet Version)");
  console.log("=".repeat(70));
  console.log();

  // Load wallet keys
  logInfo("Loading wallet keys...");
  let provider: WalletKeys;
  let oracle: WalletKeys;
  let client: WalletKeys;

  try {
    provider = loadWalletKeys("provider");
    oracle = loadWalletKeys("oracle");
    client = loadWalletKeys("client");
    logSuccess(`Loaded provider: ${provider.address.slice(0, 20)}...`);
    logSuccess(`Loaded oracle: ${oracle.address.slice(0, 20)}...`);
    logSuccess(`Loaded client: ${client.address.slice(0, 20)}...`);
    
    // For old wallets, use the correct VKHs from the contract datum
    // Provider VKH: 25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352
    // Oracle VKH: bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1
    
    // The settlement requires the OLD provider and oracle keys (as stored in the datum)
    // Use old keys if available, otherwise fall back to hardcoded VKHs
    const oldKeysDir = path.join(KEYS_DIR, "..", "keys", "old");
    
    if (fs.existsSync(path.join(oldKeysDir, "provider_hex.json"))) {
      const oldProvider = JSON.parse(fs.readFileSync(path.join(oldKeysDir, "provider_hex.json"), "utf-8"));
      const oldOracle = JSON.parse(fs.readFileSync(path.join(oldKeysDir, "oracle_hex.json"), "utf-8"));
      
      logWarn("Using OLD provider/oracle keys for settlement (as required by datum)");
      provider.privateKeyHex = oldProvider.privateKeyHex;
      provider.address = oldProvider.address;
      provider.verificationKeyHash = "25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352";
      oracle.privateKeyHex = oldOracle.privateKeyHex;
      oracle.address = oldOracle.address;
      oracle.verificationKeyHash = "bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1";
      
      logInfo(`  Provider address: ${provider.address}`);
      logInfo(`  Oracle address: ${oracle.address}`);
    } else {
      logWarn("OLD provider/oracle keys not found, using new keys");
      logWarn("⚠️  This will FAIL because new VKHs don't match datum!");
      if (!provider.verificationKeyHash) {
        provider.verificationKeyHash = "25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352";
      }
      if (!oracle.verificationKeyHash) {
        oracle.verificationKeyHash = "bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1";
      }
    }
    
    logInfo(`  Provider VKH: ${provider.verificationKeyHash}`);
    logInfo(`  Oracle VKH: ${oracle.verificationKeyHash}`);
  } catch (error) {
    logError("Failed to load wallet keys. Run generate_wallet.ts first.");
    process.exit(1);
  }

  // Check wallet balances
  logInfo("\nChecking wallet balances...");
  
  let providerUtxos: any[] = [];
  let oracleUtxos: any[] = [];
  
  try {
    // Fetch using old oracle address for collateral
    const oracleCollateralAddr = oracle.address; // This is now the old oracle address
    providerUtxos = await bfFetch(`/addresses/${provider.address}/utxos`);
    oracleUtxos = await bfFetch(`/addresses/${oracleCollateralAddr}/utxos`);
    
    if (providerUtxos.length === 0) {
      logWarn("Provider wallet has no UTxOs. Please fund it first.");
    } else {
      logSuccess(`Provider wallet has ${providerUtxos.length} UTxO(s)`);
    }
    
    if (oracleUtxos.length === 0) {
      logWarn("Oracle wallet has no UTxOs. Please fund it first.");
    } else {
      logSuccess(`Oracle wallet has ${oracleUtxos.length} UTxO(s)`);
    }
  } catch (error: any) {
    logWarn(`Could not check balances: ${error.message}`);
  }

  // Initialize providers
  logInfo("\nInitializing providers...");
  const koiosProvider = new KoiosProvider("preprod");
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);

  // Initialize transaction builder
  const txBuilder = new MeshTxBuilder({
    fetcher: bfProvider,
    submitter: bfProvider,
  });

  // Get tip from Koios
  logInfo("Fetching blockchain tip...");
  const tipResult = await koiosProvider.get('/tip');
  const tip = tipResult[0];
  logInfo(`  Current slot: ${tip.abs_slot}`);

  // Check for existing escrow UTxOs
  logInfo("\nScanning escrow address for UTxO...");
  const escrowUtxos = await bfFetch(`/addresses/${ESCROW_ADDR}/utxos`);
  logInfo(`  Found ${escrowUtxos.length} UTxO(s) at escrow address`);

  if (escrowUtxos.length === 0) {
    logError("No escrow UTxOs found. Run the lock transaction first.");
    process.exit(1);
  }

  // Find an UTxO we can settle (with inline datum)
  const escrowUtxo = escrowUtxos.find((u: any) => u.inline_datum);
  
  if (!escrowUtxo) {
    logError("No escrow UTxO with inline datum found.");
    process.exit(1);
  }

  logInfo(`  Using escrow UTxO: ${escrowUtxo.tx_hash}#${escrowUtxo.output_index}`);
  
  // Parse the datum
  const dataHash = escrowUtxo.data_hash;
  try {
    const datumJson = await bfFetch(`/scripts/datum/${dataHash}`);
    logInfo("  Parsed datum from BlockFrost");
    
    // Extract payment amount from the datum
    const fields = datumJson.json_value.fields;
    const payment = BigInt(fields[4].int);
    logInfo(`  Payment amount: ${Number(payment) / 1000000} ADA`);
    
    // Calculate payout (payment - 2 ADA for fees)
    const providerPayout = payment - BigInt(2000000);
    logInfo(`  Provider payout: ${Number(providerPayout) / 1000000} ADA`);
    
    // Calculate TTL
    const ttlSlot = Number(tip.abs_slot) + 500;
    logInfo(`  TTL: slots ${tip.abs_slot} to ${ttlSlot}`);

    // Find oracle collateral
    logInfo("\nFinding collateral UTxO...");
    const oracleCollateral = oracleUtxos.find((u: any) => 
      u.amount.some((a: any) => a.unit === "lovelace" && BigInt(a.quantity) >= BigInt(5000000))
    );

    if (!oracleCollateral) {
      logError("No suitable collateral UTxO found for oracle. Need at least 5 ADA.");
      process.exit(1);
    }
    logSuccess(`  Oracle collateral: ${oracleCollateral.tx_hash}#${oracleCollateral.output_index}`);

    // Build the Settle transaction
    logInfo("\nBuilding Settle transaction...");

    // Redeemer: Settle = Constr(0, [])
    const redeemer = { alternative: 0, fields: [] };

    // Build and sign
    txBuilder.signingKey(provider.privateKeyHex);
    txBuilder.signingKey(oracle.privateKeyHex);

    const unsignedTxHex = await txBuilder
      .spendingPlutusScriptV3()
      .txIn(escrowUtxo.tx_hash, escrowUtxo.output_index)
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemer)
      .txInScript(PLUTUS_SCRIPT_CBOR)
      .txInCollateral(oracleCollateral.tx_hash, oracleCollateral.output_index)
      .requiredSignerHash(provider.verificationKeyHash)
      .requiredSignerHash(oracle.verificationKeyHash)
      .txOut(provider.address, [{ unit: 'lovelace', quantity: providerPayout.toString() }])
      .changeAddress(oracle.address)
      .invalidBefore(BigInt(tip.abs_slot))
      .invalidHereafter(BigInt(ttlSlot))
      .complete();

    logInfo(`  Transaction built (${unsignedTxHex.length / 2} bytes)`);

    // Sign the transaction
    const signedTxHex = txBuilder.completeSigning();
    logSuccess(`  Transaction signed`);

    // Submit
    logInfo("\nSubmitting transaction...");
    try {
      const txHash = await bfProvider.submitTx(signedTxHex);
      console.log("\n" + "=".repeat(70));
      logSuccess("✅ SETTLE TRANSACTION SUCCESSFUL");
      console.log("=".repeat(70));
      logInfo(`  Tx hash:    ${txHash}`);
      logInfo(`  Explorer:   https://preprod.cardanoscan.io/transaction/${txHash}`);
      logInfo(`  Paid out:   ${Number(payment) / 1000000} ADA to provider`);
      console.log("=".repeat(70));
    } catch (error: any) {
      const errorMsg = error.message || error.error?.message || JSON.stringify(error);
      logError(`Submit failed: ${errorMsg}`);
      logInfo(`Transaction hex (first 200 chars): ${signedTxHex.slice(0, 200)}...`);
      process.exit(1);
    }

  } catch (error: any) {
    logError(`Transaction failed: ${error.message}`);
    if (error.stack) {
      console.log(error.stack.split("\n").slice(0, 5).join("\n"));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
