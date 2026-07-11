#!/usr/bin/env node
/**
 * ADADIVE - Refund Expired Escrow UTxOs
 * 
 * Since the deadlines have passed, we can use the Refund path which only
 * requires the client's signature.
 * 
 * Usage:
 *   npm run refund:expired
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

// Old wallet (used for Refund - only client signature required)
const OLD_CLIENT_ADDR = "addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep";
const OLD_CLIENT_SKEY_HEX = "cd670651e7be6353094a8c8e7e4320290986f087b3e1ba2318108768bc39318e";

// New wallet (where funds will be sent)
const NEW_CLIENT_ADDR = "addr_test1qqzhypzf627yh0ymrhsrf0uhykhyfq5ue0la5799n8vyh0s9wgzyn54ufw7fk80qxjlewfdwgjpfejllmfu2txwcfwlqp8geuk";
const NEW_CLIENT_SKEY_HEX = "5a359b6c6b3e7a3e2f8e4d5c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a"; // Will be updated

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

// ─── Load New Client Key ───────────────────────────────────────────────────

function loadNewClientKey(): string {
  const keysFile = path.resolve(__dirname, "../../../contracts/adadive-escrow/testnet/keys/client/keys.json");
  if (fs.existsSync(keysFile)) {
    const data = JSON.parse(fs.readFileSync(keysFile, "utf-8"));
    return data.privateKeyHex;
  }
  throw new Error("New client key not found. Run generate_wallet.ts first.");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Refund Expired Escrow UTxOs");
  console.log("=".repeat(70));
  console.log();

  // Load keys
  logInfo("Loading keys...");
  
  let newClientSkeyHex: string;
  try {
    newClientSkeyHex = loadNewClientKey();
    logSuccess("Loaded new client key");
  } catch (e) {
    logWarn("New client key not found, using placeholder");
    newClientSkeyHex = OLD_CLIENT_SKEY_HEX; // Fallback to old client
  }

  // Initialize providers
  logInfo("Initializing providers...");
  const koiosProvider = new KoiosProvider("preprod");
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);

  // Get tip
  logInfo("Fetching blockchain tip...");
  const tipResult = await koiosProvider.get('/tip');
  const tip = tipResult[0];
  logInfo(`  Current slot: ${tip.abs_slot}`);

  // Get escrow UTxOs
  logInfo("\nFetching escrow UTxOs...");
  const escrowUtxos = await bfFetch(`/addresses/${ESCROW_ADDR}/utxos`);
  logInfo(`  Found ${escrowUtxos.length} UTxO(s)`);

  // Filter for UTxOs with inline datums (only these can be refunded)
  const refundableUtxos = escrowUtxos.filter((u: any) => u.inline_datum);
  
  if (refundableUtxos.length === 0) {
    logError("No refundable UTxOs found (all UTxOs may have already been refunded)");
    process.exit(0);
  }

  logInfo(`  Found ${refundableUtxos.length} refundable UTxO(s)`);

  // Get client collateral UTxOs
  logInfo("\nFetching client collateral UTxOs...");
  let clientUtxos: any[] = [];
  
  try {
    clientUtxos = await bfFetch(`/addresses/${OLD_CLIENT_ADDR}/utxos`);
    if (clientUtxos.length === 0) {
      // Try new client address
      logWarn("Old client has no UTxOs, trying new client address...");
      clientUtxos = await bfFetch(`/addresses/${NEW_CLIENT_ADDR}/utxos`);
    }
  } catch (e) {
    logWarn("Could not fetch client UTxOs");
  }

  logSuccess(`  Client has ${clientUtxos.length} UTxO(s)`);

  // Find a collateral UTxO (5+ ADA)
  const collateral = clientUtxos.find((u: any) =>
    u.amount.some((a: any) => a.unit === "lovelace" && BigInt(a.quantity) >= BigInt(5000000))
  );

  if (!collateral) {
    logError("No collateral UTxO found (need at least 5 ADA for collateral)");
    logInfo("Please fund the client wallet first via the faucet.");
    process.exit(1);
  }

  logInfo(`  Collateral: ${collateral.tx_hash}#${collateral.output_index}`);

  // Process each refundable UTxO
  for (const escrowUtxo of refundableUtxos) {
    console.log("\n" + "-".repeat(70));
    logInfo(`Processing: ${escrowUtxo.tx_hash}#${escrowUtxo.output_index}`);
    logInfo(`  Amount: ${Number(escrowUtxo.amount[0].quantity) / 1000000} ADA`);

    const escrowAmount = BigInt(escrowUtxo.amount[0].quantity);
    const collateralAmount = BigInt(collateral.amount.find((a: any) => a.unit === "lovelace").quantity);

    const txBuilder = new MeshTxBuilder({
      fetcher: bfProvider,
      submitter: bfProvider,
    });

    // Sign with old client key (only signature needed for Refund)
    txBuilder.signingKey(OLD_CLIENT_SKEY_HEX);

    // Redeemer: Refund = Constr(1, [])
    const redeemer = { alternative: 1, fields: [] };

    const ttlSlot = Number(tip.abs_slot) + 500;

    try {
      // For refund: spend the escrow UTxO, send back to client with change
      // Don't include a txOut - let the builder handle the output
      const unsignedTxHex = await txBuilder
        .spendingPlutusScriptV3()
        .txIn(escrowUtxo.tx_hash, escrowUtxo.output_index)
        .txInInlineDatumPresent()
        .txInRedeemerValue(redeemer)
        .txInScript(PLUTUS_SCRIPT_CBOR)
        .txInCollateral(collateral.tx_hash, collateral.output_index)
        .changeAddress(OLD_CLIENT_ADDR)
        .invalidBefore(BigInt(tip.abs_slot))
        .invalidHereafter(BigInt(ttlSlot))
        .complete();

      logInfo(`  Transaction built (${unsignedTxHex.length / 2} bytes)`);

      const signedTxHex = txBuilder.completeSigning();
      logSuccess("  Transaction signed");

      logInfo("\n  Submitting transaction...");
      const txHash = await bfProvider.submitTx(signedTxHex);
      
      logSuccess(`\n  ✅ REFUND SUCCESSFUL!`);
      logInfo(`     Tx hash: ${txHash}`);
      logInfo(`     Explorer: https://preprod.cardanoscan.io/transaction/${txHash}`);

    } catch (error: any) {
      const errorMsg = error.message || String(error);
      logError(`  Refund failed: ${errorMsg}`);
      if (errorMsg.includes && errorMsg.includes("Phase-1")) {
        logWarn("  This UTxO cannot be refunded (deadline not passed or other validation failure)");
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  logSuccess("Refund process completed");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
