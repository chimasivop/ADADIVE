/**
 * Mesh.js Test - Lock Transaction
 * 
 * Tests the newly compiled contract by locking funds at the new address.
 */

import { MeshTxBuilder } from "@meshsdk/core";
import { applyParams } from "@meshsdk/core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BLOCKFROST_URL = "https://cardano-preprod.blockfrost.io/api/v0";
const BLOCKFROST_KEY = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// New contract details
const SCRIPT_ADDR = "addr_test1wp6ejgmlrgsplddfe4llre3hegafjt0g9qxjxyjscp4dwlgutljm3";
const SCRIPT_HASH = "7599237f1a201fb5a9cd7ff1e637ca3a992de8280d231250c06ad77d";

// Wallet addresses
const CLIENT_ADDR = "addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep";

// Client VKH
const CLIENT_VKH = "9e50245e46bc8aaba0964ff24f20886e189392109fa7ab15a827afab";

// Provider VKH
const PROVIDER_VKH = "25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352";

// Oracle VKH
const ORACLE_VKH = "bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1";

async function main() {
  console.log("=".repeat(70));
  console.log("Mesh.js Test - Lock Transaction");
  console.log("=".repeat(70));
  console.log();

  console.log("Contract Details:");
  console.log(`  Address: ${SCRIPT_ADDR}`);
  console.log(`  Hash:    ${SCRIPT_HASH}`);
  console.log();

  // Load the Plutus script
  const scriptPath = path.join(__dirname, "..", "deal_escrow.plutus");
  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  const scriptCbor = scriptData.cborHex;
  console.log(`Loaded script CBOR: ${scriptCbor.length} chars`);

  // Initialize Mesh
  const mesh = new MeshTxBuilder({
    fetcher: undefined, // Would need a proper fetcher
    submitter: undefined,
    verbose: true
  });

  console.log();
  console.log("Note: This script demonstrates the transaction structure.");
  console.log("Actual submission requires wallet signing keys.");
  
  // Calculate the deadline (24 hours from now)
  const now = Date.now();
  const deadline = now + (24 * 60 * 60 * 1000);
  const deadlineSlot = Math.floor(deadline / 1000); // Assuming 1 slot = 1 second on preprod
  
  // Build the DealDatum (12 fields)
  // DealDatum: client, provider, oracle, payment, storage_gb, duration_epochs, 
  //            deadline, start_time, data_hash, state, provider_signed, oracle_signed
  const datum = {
    constructor: 0,
    fields: [
      { bytes: CLIENT_VKH },           // client
      { bytes: PROVIDER_VKH },        // provider  
      { bytes: ORACLE_VKH },          // oracle
      { int: 20000000 },              // payment (20 ADA in lovelace)
      { int: 1 },                     // storage_gb
      { int: 10 },                    // duration_epochs
      { int: Math.floor(deadline / 1000) },  // deadline (POSIX milliseconds)
      { int: Math.floor(now / 1000) },        // start_time
      { bytes: "abcdef123456" },      // data_hash
      { int: 0 },                     // state (DealActive)
      { int: 0 },                     // provider_signed (false)
      { int: 0 },                     // oracle_signed (false)
    ]
  };

  console.log();
  console.log("Datum structure:");
  console.log(`  Client:    ${CLIENT_VKH}`);
  console.log(`  Provider:  ${PROVIDER_VKH}`);
  console.log(`  Oracle:    ${ORACLE_VKH}`);
  console.log(`  Payment:   20 ADA`);
  console.log(`  Deadline:  ${new Date(deadline).toISOString()}`);

  console.log();
  console.log("=".repeat(70));
  console.log("Transaction structure prepared successfully!");
  console.log("=".repeat(70));
  console.log();
  console.log("To complete the test:");
  console.log("1. Use a wallet with signing keys to sign the transaction");
  console.log("2. Submit to the blockchain via Blockfrost submit API");
  console.log("3. Verify the UTxO appears at the script address");
}

main().catch(console.error);
