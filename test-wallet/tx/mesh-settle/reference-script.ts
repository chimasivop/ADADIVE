#!/usr/bin/env node
/**
 * ADADIVE - Create Reference Script UTxO
 * 
 * This script creates a reference script UTxO at the escrow address,
 * which can be used for reference script inputs in Mesh.js transactions.
 * 
 * Usage:
 *   npm run reference-script
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { MeshTxBuilder, KoiosProvider, BlockfrostProvider } from "@meshsdk/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// Contract details
const ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq";
const SCRIPT_HASH = "5ea875544b10190d065902c7cbee9d90325f55c093072caa27b626b8";

// Keys directory
const KEYS_DIR = path.resolve(__dirname, "../../../contracts/adadive-escrow/testnet/keys");

// Plutus V3 script bytecode
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
  verificationKeyHash: string;
}

function loadWalletKeys(name: string): WalletKeys {
  const walletFile = path.join(KEYS_DIR, name, "keys.json");
  if (!fs.existsSync(walletFile)) {
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
    throw new Error(`Blockfrost request failed: ${response.status}`);
  }
  return response.json();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Create Reference Script UTxO");
  console.log("=".repeat(70));
  console.log();

  // Load wallet keys
  logInfo("Loading wallet keys...");
  let provider: WalletKeys;
  
  try {
    provider = loadWalletKeys("provider");
    logSuccess(`Loaded provider: ${provider.address.slice(0, 20)}...`);
  } catch (error) {
    logError("Failed to load wallet keys. Run generate_wallet.ts first.");
    process.exit(1);
  }

  // Check for existing reference scripts
  logInfo("\nChecking for existing reference scripts...");
  try {
    const existingUtxos = await bfFetch(`/addresses/${ESCROW_ADDR}/utxos`);
    const refScriptUtxo = existingUtxos.find((u: any) => u.reference_script);
    
    if (refScriptUtxo) {
      logSuccess(`Reference script UTxO already exists: ${refScriptUtxo.tx_hash}#${refScriptUtxo.output_index}`);
      logInfo(`Script hash: ${refScriptUtxo.reference_script.script_hash}`);
      console.log("\nReference script is already set up. No action needed.");
      return;
    }
    
    logInfo(`No reference script UTxO found. Creating one...`);
  } catch (error) {
    logWarn(`Could not check existing UTxOs: ${error}`);
  }

  // Check provider balance
  logInfo("\nChecking provider wallet balance...");
  let providerUtxos: any[] = [];
  
  try {
    providerUtxos = await bfFetch(`/addresses/${provider.address}/utxos`);
    
    if (providerUtxos.length === 0) {
      logError("Provider wallet has no UTxOs. Please fund it with at least 3 ADA first.");
      logInfo("\nFund this address:");
      logInfo(`  ${provider.address}`);
      logInfo("\nThen run this script again.");
      process.exit(1);
    }
    
    // Calculate total balance
    let totalLovelace = BigInt(0);
    for (const utxo of providerUtxos) {
      for (const amount of utxo.amount) {
        if (amount.unit === "lovelace") {
          totalLovelace += BigInt(amount.quantity);
        }
      }
    }
    
    logSuccess(`Provider wallet has ${providerUtxos.length} UTxO(s) with ${Number(totalLovelace) / 1000000} ADA`);
    
    if (totalLovelace < BigInt(3000000)) {
      logWarn("Insufficient balance. Need at least 3 ADA for reference script UTxO.");
      process.exit(1);
    }
  } catch (error: any) {
    logError(`Could not check balance: ${error.message}`);
    process.exit(1);
  }

  // Initialize providers
  logInfo("\nInitializing providers...");
  const koiosProvider = new KoiosProvider("preprod");
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);

  // Get tip
  logInfo("Fetching blockchain tip...");
  const tipResult = await koiosProvider.get('/tip');
  const tip = tipResult[0];
  logInfo(`  Current slot: ${tip.abs_slot}`);

  // Create reference script UTxO
  // The reference script UTxO contains the Plutus script and a minimum of 2 ADA
  logInfo("\nCreating reference script UTxO...");

  const txBuilder = new MeshTxBuilder({
    fetcher: bfProvider,
    submitter: bfProvider,
  });

  txBuilder.signingKey(provider.privateKeyHex);

  const referenceScriptUtxoValue = 2000000; // 2 ADA minimum

  try {
    const unsignedTxHex = await txBuilder
      .txOut(ESCROW_ADDR, [
        { unit: 'lovelace', quantity: referenceScriptUtxoValue.toString() },
      ])
      .txOutScript(ESCROW_ADDR, undefined, PLUTUS_SCRIPT_CBOR)
      .changeAddress(provider.address)
      .complete();

    logInfo(`  Transaction built (${unsignedTxHex.length / 2} bytes)`);

    const signedTxHex = txBuilder.completeSigning();
    logSuccess(`  Transaction signed`);

    logInfo("\nSubmitting transaction...");
    const txHash = await bfProvider.submitTx(signedTxHex);
    
    console.log("\n" + "=".repeat(70));
    logSuccess("✅ REFERENCE SCRIPT UTxO CREATED");
    console.log("=".repeat(70));
    logInfo(`  Tx hash:    ${txHash}`);
    logInfo(`  Explorer:   https://preprod.cardanoscan.io/transaction/${txHash}`);
    logInfo(`  Script UTxO: ${txHash}#1`);
    logInfo(`  Script hash: ${SCRIPT_HASH}`);
    console.log("=".repeat(70));
    logInfo("\nThe reference script UTxO is now available at the escrow address.");
    logInfo("You can now use it for reference script inputs in Mesh.js transactions.");

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
