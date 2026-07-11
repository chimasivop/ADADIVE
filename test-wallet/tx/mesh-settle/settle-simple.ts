#!/usr/bin/env node
/**
 * ADADIVE Escrow Settle Transaction via Mesh.js (Simplified)
 * 
 * Usage:
 *   PROVIDER_SKEY=<hex_skey> ORACLE_SKEY=<hex_skey> npm run settle
 */

import { MeshTxBuilder as MeshTxBuilderV1, MeshTxBuilderV2, KoiosProvider, BlockfrostProvider } from "@meshsdk/core";

// ─── Configuration ───────────────────────────────────────────────────────────

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";
const ESCROW_ADDR = "addr_test1wp02sa25fvgpjrgxtypv0jlwnkgryh64czfswt92y7mzdwq4cz4aq";
const PROVIDER_ADDR = "addr_test1vqj4fqvpews3sn0hzs20k96xy68l6xmnpnlcevahlhdtx5sykmhxs";
const PROVIDER_VKH = "25548181cba1184df71414fb1746268ffd1b730cff8cb3b7fddab352";
const ORACLE_ADDR = "addr_test1vzl7xkqdzrce4rzj9v87zgldwsngu6mw05alq9dqzyjvasgaf40rl";
const ORACLE_VKH = "bfe3580d10f19a8c522b0fe123ed74268e6b6e7d3bf015a01124cec1";
const LOCK_TX_HASH = "143aeede087fe88c9fa7f7d954877cf83eb1ad01bebec524c2ac0b44c9b24e76";

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

const logInfo = (msg: string) => console.log(`${BLUE}[INFO]${NC} ${msg}`);
const logSuccess = (msg: string) => console.log(`${GREEN}[SUCCESS]${NC} ${msg}`);
const logError = (msg: string) => console.log(`${RED}[ERROR]${NC} ${msg}`);

function parseSkey(skeyJson: string): string {
  const skey = JSON.parse(skeyJson);
  return skey.cborHex.replace("5820", "");
}

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

async function runSettle() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Settle Transaction via Mesh.js (Preprod)");
  console.log("=".repeat(70));
  
  const providerSkey = process.env.PROVIDER_SKEY;
  const oracleSkey = process.env.ORACLE_SKEY;
  
  if (!providerSkey || !oracleSkey) {
    logError("Missing signing keys. Set PROVIDER_SKEY and ORACLE_SKEY.");
    process.exit(1);
  }
  
  try {
    logInfo("Loading signing keys...");
    const providerSkeyHex = parseSkey(providerSkey);
    const oracleSkeyHex = parseSkey(oracleSkey);
    logSuccess("Signing keys loaded");
    
    // Initialize providers
    const koiosProvider = new KoiosProvider("preprod");
    const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);
    
    // Initialize transaction builder - try V1 instead of V2
    const txBuilder = new MeshTxBuilderV1({
      fetcher: bfProvider,
      submitter: bfProvider,
    });
    
    // Get tip from Koios
    logInfo("Fetching blockchain tip...");
    const tipResult = await koiosProvider.get('/tip');
    const tip = tipResult[0];
    logInfo(`  Current slot: ${tip.abs_slot}`);
    
    // Get escrow UTxO with datum from BlockFrost
    logInfo("Scanning escrow address for UTxO...");
    const escrowUtxos = await bfFetch(`/addresses/${ESCROW_ADDR}/utxos`);
    logInfo(`  Found ${escrowUtxos.length} UTxO(s)`);
    
    const escrowUtxo = escrowUtxos.find((u: any) => u.tx_hash === LOCK_TX_HASH);
    if (!escrowUtxo) {
      throw new Error(`Could not find escrow UTxO from lock tx ${LOCK_TX_HASH}`);
    }
    logInfo(`  Found escrow UTxO: ${escrowUtxo.tx_hash}#${escrowUtxo.output_index}`);
    
    logInfo("Parsing escrow datum...");
    // The inline_datum is a hex string - fetch the JSON representation using the data_hash
    const dataHash = escrowUtxo.data_hash;
    const datumJson = await bfFetch(`/scripts/datum/${dataHash}`);
    const fields = datumJson.json_value.fields;
    const payment = BigInt(fields[4].int);
    const deadline = Number(fields[8].int);
    logInfo(`  Payment: ${Number(payment) / 1000000} ADA`);
    logInfo(`  Deadline: ${deadline} ms`);
    
    const providerPayout = payment - BigInt(2000000);
    const ttlSlot = Number(tip.abs_slot) + 200;
    
    // Get oracle collateral UTxOs
    logInfo("Fetching collateral UTxOs...");
    const oracleUtxos = await bfFetch(`/addresses/${ORACLE_ADDR}/utxos`);
    const oracleCollateral = oracleUtxos.find((u: any) => 
      u.amount.length === 1 && 
      u.amount[0].unit === "lovelace" &&
      BigInt(u.amount[0].quantity) >= BigInt(5000000)
    );
    if (!oracleCollateral) {
      throw new Error("No suitable collateral UTxO found for oracle");
    }
    logInfo(`  Oracle collateral: ${oracleCollateral.tx_hash}#${oracleCollateral.output_index}`);
    
    logInfo("Building Settle transaction...");
    
    // Build full DealDatum structure for the input
    // Mesh.js expects Data format: { alternative: number, fields: (string | number | Data)[] }
    const dealDatum = {
      alternative: 0,
      fields: [
        fields[0].bytes,  // PubKeyHash - as string (hex)
        fields[1].bytes,  // PubKeyHash - as string (hex)
        fields[2].bytes,  // PubKeyHash - as string (hex)
        fields[3].bytes,  // PubKeyHash - as string (hex)
        Number(fields[4].int),  // Lovelace - as number
        Number(fields[5].int),  // Int - as number
        Number(fields[6].int),  // Int - as number
        Number(fields[7].int),  // POSIXTime - as number
        Number(fields[8].int),  // POSIXTime - as number
      ]
    };
    
    // Build transaction using the MeshTxBuilder API
    // Using the proper chain: spendingPlutusScriptV3 -> txIn -> txInDatumValue -> txInRedeemerValue -> txInScript
    // The Plutus script CBOR from the compiled validator
    const scriptCbor = "59052601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cdc3a400530070024888966002600460106ea800e26466453001159800980098059baa0028cc0048c03cc040c040c040c040c040c040c0400064601e602060206020602060206020602060200032300f30103010001918079808000c8c03cc040c040c040c0400064601e602060206020602060200032300f301030103010301030103010001911919800800801912cc00400629422b30013371e6eb8c04800400e2946266004004602600280710114dc7a44100980718061baa0024888888888a6002444646600200200844b30010018a508acc004c8c966002602460386ea80062b30013371e6eb8c07cc074dd500080344cdc480299199119801001000912cc004006007132325980099b914881000018acc004c03800626eb4c08800a00a8102266008008604a0068100dd718100009811000a04232323300100137566044604600a44b3001001801c4c8c96600266e45221000018acc004c03c00626eacc08c00a00a810a266008008604c0068108dd718108009811800a04414bd6f7b6300a400114a080da294101b180f180e1baa301e001301b3754603a00314a3133002002301e001406480e26014602c6ea803a6eb0c024c058dd50074dd61804180b1baa00e4888966002b30013375e98103d8798000301c301d301d301d301d301d301d301d301d301d301a375400b15980099baf4c0103d8798000301c301d301d301d301d301d301d301d301d301d301d301d301a375400b159800acc006600266e3cdd7180e180d1baa005375c601660346ea8016942945018456600330013371e6eb8c070c068dd50029bae300c301a375400b4a14a280c2330013371e6eb8c02cc068dd50029bae300c301a375400b4a14a280c22941018452820308992cc004c004dd69805980d9baa0068acc004c004dd69805180d9baa0068acc004cdc49bad300a301b375400c904044bd456600260026eb4c024c06cdd5003456600266e24dd69804980d9baa0064830268322b30013001375a601e60366ea801a2b30013001375a601c60366ea801a2b3001337106eb4c03cc06cdd50031bad300e301b375400d1980098039bae301d301e301e301e301b375400d4a14a280ca2941019452820328a50406514a080ca2941019452820328a50406514a080c8dc42400114a080c22941018452820308992cc004c0400062b300133008003375c601a60366ea801a2b300133008003375c601860366ea801a2b30013259800980a980d9baa001899b89375a603c60386ea8004dd69807980e1baa0078a504068603a60366ea8c030c06cdd5002466002005375c601860366ea801a6eb4c02cc06cdd5003200a8a50406514a080ca294101945660026028003159800998040019bae301d301b375400d159800992cc004c054c06cdd5000c4cdc41bad300f301c375400e6eb4c078c070dd5000c5282034301d301b3754603a60366ea8012330010029bae301d301b375400d375a601660366ea8019005452820328a504065159800998040019bae301d301b375400d159800998040019bae300c301b375400d198008014dd7180e980d9baa0069bad300b301b375400c802a294101945282032406480c8c064dd500ac528203022c805260166ea801e601c0069112cc004c01000a2b3001300f37540150038b20208acc004c02000a2b3001300f37540150038b20208acc004cdc3a400800515980098079baa00a801c5901045900d201a4034300c300d001370e900018049baa0038b200e180380098019baa0078a4d13656400401";
    
    // Build and sign the transaction in two steps
    // IMPORTANT: Add signing keys BEFORE calling complete()
    // Step 1: Add signing keys
    txBuilder.signingKey(providerSkeyHex);
    txBuilder.signingKey(oracleSkeyHex);
    
    // Step 2: Build the unsigned transaction
    // The UTxO has an inline datum (plutusData), so use txInInlineDatumPresent
    // Try V2 instead of V3 to see if it works better
    const unsignedTxHex = await txBuilder
      .spendingPlutusScriptV2()
      .txIn(escrowUtxo.tx_hash, escrowUtxo.output_index)
      .txInInlineDatumPresent()
      .txInRedeemerValue({ alternative: 0, fields: [] }) // Settle = Constr(0, [])
      .txInScript(scriptCbor)
      .txInCollateral(oracleCollateral.tx_hash, oracleCollateral.output_index, ORACLE_ADDR)
      .requiredSignerHash(PROVIDER_VKH)
      .requiredSignerHash(ORACLE_VKH)
      .txOut(PROVIDER_ADDR, [{ unit: 'lovelace', quantity: providerPayout.toString() }])
      .changeAddress(ORACLE_ADDR)  // Set change address first
      .invalidBefore(BigInt(tip.abs_slot))
      .invalidHereafter(BigInt(ttlSlot))
      .complete();
    
    logInfo(`  Unsigned transaction built (${unsignedTxHex.length / 2} bytes)`);
    
    // Step 3: Sign the transaction with the signing keys
    const txHex = txBuilder.completeSigning();
    
    logInfo(`  Transaction built (${txHex.length / 2} bytes)`);
    
    logInfo("\nSubmitting transaction...");
    try {
      const txHash = await bfProvider.submitTx(txHex);
      console.log("\n" + "=".repeat(70));
      logSuccess("✅ SETTLE TRANSACTION SUCCESSFUL");
      console.log("=".repeat(70));
      logInfo(`  Tx hash:    ${txHash}`);
      logInfo(`  Explorer:   https://preprod.cardanoscan.io/transaction/${txHash}`);
      logInfo(`  Paid out:   ${Number(payment) / 1000000} ADA to provider`);
      console.log("=".repeat(70));
    } catch (error: any) {
      logError(`Submit failed: ${error.message || error}`);
      logInfo(`Transaction hex (first 200 chars): ${txHex.slice(0, 200)}...`);
      logInfo(`Transaction hex (last 200 chars): ...${txHex.slice(-200)}`);
      throw error;
    }
    
    console.log("\n" + "=".repeat(70));
    logSuccess("✅ SETTLE TRANSACTION SUCCESSFUL");
    console.log("=".repeat(70));
    logInfo(`  Tx hash:    ${txHash}`);
    logInfo(`  Explorer:   https://preprod.cardanoscan.io/transaction/${txHash}`);
    logInfo(`  Paid out:   ${Number(payment) / 1000000} ADA to provider`);
    console.log("=".repeat(70));
    
  } catch (error: any) {
    logError(`Transaction failed: ${error.message}`);
    process.exit(1);
  }
}

runSettle();
