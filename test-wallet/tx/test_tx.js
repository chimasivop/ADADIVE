#!/usr/bin/env node
/**
 * ADADIVE Escrow Contract - E2E Test via BlockFrost API
 * 
 * This script builds and submits Plutus smart contract transactions
 * using BlockFrost API for querying and transaction submission.
 * 
 * Koios is used for querying (free, no API key).
 * BlockFrost is used for transaction submission (requires API key).
 * 
 * Usage:
 *   node test_tx.js status           # Check escrow and wallet status
 *   node test_tx.js cancel           # Build and submit Cancel transaction
 *   node test_tx.js settle           # Build Settle transaction
 *   node test_tx.js refund           # Build Refund transaction
 * 
 * Prerequisites:
 *   npm install @emurgo/cardano-serialization-lib-nodejs axios
 * 
 * Environment Variables:
 *   ESCROW_SKEY    - Signing key hex (for transaction signing)
 *                    Format: 5820... (hex-encoded private key)
 * 
 * Example:
 *   ESCROW_SKEY=5820... node test_tx.js cancel
 */

const CSL = require("@emurgo/cardano-serialization-lib-nodejs");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Configuration
const KOIOS_URL = "https://preprod.koios.rest/api/v1";
const BF_URL = "https://cardano-preprod.blockfrost.io/api/v0";
const BF_KEY = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

const ESCROW_ADDR = "addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2";
const WALLET_ADDR = "addr_test1vrtyktsm0hnrcncg9kw2xsh8knas4lutj5rf4ngudug3wcqnwj4p7";
const ESCROW_SCRIPT_HASH = "85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b";

// Redeemer constructors
const REDEEMER_SETTLE = 0;
const REDEEMER_REFUND = 1;
const REDEEMER_CANCEL = 2;

// Preprod protocol parameters
const PREPROD_FEE = {
  coefficient: BigInt(44),
  constant: BigInt(155381)
};

// Colors
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

function logInfo(msg) { console.log(`${BLUE}[INFO]${NC} ${msg}`); }
function logSuccess(msg) { console.log(`${GREEN}[SUCCESS]${NC} ${msg}`); }
function logError(msg) { console.log(`${RED}[ERROR]${NC} ${msg}`); }
function logWarn(msg) { console.log(`${YELLOW}[WARN]${NC} ${msg}`); }

// Koios client for querying
class KoiosClient {
  async getTip() {
    const r = await axios.get(`${KOIOS_URL}/tip`);
    return r.data[0];
  }

  async getAddressInfo(address) {
    const r = await axios.post(
      `${KOIOS_URL}/address_info`,
      { _addresses: [address] },
      { headers: { "Content-Type": "application/json" } }
    );
    return r.data[0];
  }
}

// BlockFrost client for submission
class BlockFrostClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async get(path) {
    const r = await axios.get(`${BF_URL}${path}`, {
      headers: { project_id: this.apiKey }
    });
    return r.data;
  }

  async getTip() {
    return this.get("/blocks/latest");
  }

  async getAddressUTxOs(address) {
    return this.get(`/addresses/${address}/utxos`);
  }

  async getDatum(datumHash) {
    try {
      return await this.get(`/scripts/datum/${datumHash}`);
    } catch {
      return null;
    }
  }

  async submitTx(cborHex) {
    const cborBuffer = Buffer.from(cborHex, "hex");
    try {
      const r = await axios.post(
        `${BF_URL}/tx/submit`,
        cborBuffer,
        {
          headers: {
            project_id: this.apiKey,
            "Content-Type": "application/cbor"
          },
          timeout: 120
        }
      );
      return { success: true, txHash: r.data["tx hash"] };
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      return { success: false, error: msg };
    }
  }
}

// Build a simple transaction for the escrow contract
function buildEscrowTransaction(params) {
  const {
    scriptInput,
    collateralInput,
    output,
    redeemerType,
    ttl,
    fee = 400000
  } = params;

  const linearFee = CSL.LinearFee.new(
    CSL.BigNum.from_str(PREPROD_FEE.coefficient.toString()),
    CSL.BigNum.from_str(PREPROD_FEE.constant.toString())
  );

  const txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(linearFee)
    .pool_deposit(CSL.BigNum.from_str("500000000"))
    .key_deposit(CSL.BigNum.from_str("2000000"))
    .max_value_size(5000)
    .max_tx_size(16384)
    .collateral_percentage(150)
    .build();

  const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

  // Add script input (the escrow UTxO)
  if (scriptInput) {
    const scriptAddr = CSL.Address.from_bech32(ESCROW_ADDR);
    const txHash = CSL.TransactionHash.from_bytes(Buffer.from(scriptInput.txHash, "hex"));
    const input = CSL.TransactionInput.new(txHash, scriptInput.index);
    const value = CSL.Value.new(CSL.BigNum.from_str(scriptInput.amount.toString()));
    
    txBuilder.add_input(scriptAddr, input, value);
    
    // Create redeemer
    const redeemerData = CSL.PlutusData.new_constr_plutus_data(
      CSL.ConstrPlutusData.new(
        CSL.BigNum.from_str(redeemerType.toString()),
        CSL.PlutusList.new()
      )
    );
    
    const redeemer = CSL.Redeemer.new(
      CSL.RedeemerTag.new(CSL.RedeemerTag.new_execution().to_int()),
      CSL.BigNum.from_str("0"),
      redeemerData,
      CSL.ExUnits.new(
        CSL.BigNum.from_str("10000000"),
        CSL.BigNum.from_str("10000000")
      )
    );
    
    txBuilder.add_plutus_script_input(redeemer, value);
  }

  // Add collateral input
  if (collateralInput) {
    const walletAddr = CSL.Address.from_bech32(WALLET_ADDR);
    const colHash = CSL.TransactionHash.from_bytes(Buffer.from(collateralInput.txHash, "hex"));
    const colInput = CSL.TransactionInput.new(colHash, collateralInput.index);
    const colValue = CSL.Value.new(CSL.BigNum.from_str(collateralInput.amount.toString()));
    
    txBuilder.add_input(walletAddr, colInput, colValue);
    txBuilder.set_collateral(CSL.TransactionInput.new(colHash, collateralInput.index));
  }

  // Add output
  if (output) {
    const outAddr = CSL.Address.from_bech32(output.address);
    const outValue = CSL.Value.new(CSL.BigNum.from_str(output.amount.toString()));
    txBuilder.add_output(outAddr, outValue);
  }

  // Set TTL and fee
  if (ttl) txBuilder.set_ttl(ttl);
  txBuilder.set_fee(CSL.BigNum.from_str(fee.toString()));

  return txBuilder.build();
}

// Sign and submit transaction
async function signAndSubmit(txBody, signingKeyHex, bfClient) {
  try {
    const privateKey = CSL.PrivateKey.from_bytes(Buffer.from(signingKeyHex, "hex"));
    const txHash = CSL.hash_transaction(txBody);
    const signature = privateKey.sign(txHash.to_bytes());
    const vkey = CSL.Vkey.from_public_key(privateKey.to_public());
    const vkeyWitness = CSL.Vkeywitness.new(vkey, signature);
    
    const witnessSet = CSL.TransactionWitnessSet.new();
    const vkeys = CSL.Vkeywitnesses.new();
    vkeys.add(vkeyWitness);
    witnessSet.set_vkeys(vkeys);
    
    const tx = CSL.Transaction.new(txBody, witnessSet, CSL.AuxiliaryData.new());
    const cborHex = Buffer.from(tx.to_bytes()).toString("hex");
    
    return await bfClient.submitTx(cborHex);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Main E2E tester
class EscrowE2ETester {
  constructor() {
    this.koios = new KoiosClient();
    this.bf = new BlockFrostClient(BF_KEY);
  }

  async checkStatus() {
    logInfo("=== Checking Status ===");
    
    try {
      const tip = await this.koios.getTip();
      logInfo(`Current slot: ${tip.abs_slot}, Epoch: ${tip.epoch_no}`);
      
      const walletUTxOs = await this.bf.getAddressUTxOs(WALLET_ADDR);
      logInfo(`Wallet UTxOs: ${walletUTxOs.length}`);
      for (const u of walletUTxOs) {
        const lovelace = u.amount.find(a => a.unit === "lovelace")?.quantity || "0";
        logInfo(`  - ${u.tx_hash.slice(0, 20)}...#${u.output_index}: ${parseInt(lovelace)/1e6} ADA`);
      }
      
      const escrowUTxOs = await this.bf.getAddressUTxOs(ESCROW_ADDR);
      logInfo(`Escrow UTxOs: ${escrowUTxOs.length}`);
      for (const u of escrowUTxOs) {
        const lovelace = u.amount.find(a => a.unit === "lovelace")?.quantity || "0";
        logInfo(`  - ${u.tx_hash.slice(0, 20)}...#${u.output_index}: ${parseInt(lovelace)/1e6} ADA`);
        if (u.data_hash) {
          logInfo(`    Datum: ${u.data_hash}`);
        }
      }
      
      return { tip, walletUTxOs, escrowUTxOs };
    } catch (e) {
      logError(`Status check failed: ${e.message}`);
      return null;
    }
  }

  async testCancel() {
    logInfo("\n=== E2E Test: Cancel Path ===");
    logInfo("Requirements:");
    logInfo("  - Client + Provider signatures");
    logInfo("  - Output paying client >= payment");
    logInfo("  - Redeemer: Cancel (constructor 2)");
    
    const status = await this.checkStatus();
    if (!status || status.escrowUTxOs.length === 0) {
      return { success: false, error: "No escrow UTxO" };
    }
    if (status.walletUTxOs.length === 0) {
      return { success: false, error: "No wallet UTxO for collateral" };
    }
    
    const escrowUTxO = status.escrowUTxOs[0];
    const walletUTxO = status.walletUTxOs[0];
    const paymentAmount = parseInt(escrowUTxO.amount.find(a => a.unit === "lovelace")?.quantity || "0");
    const outputAmount = paymentAmount - 400000;
    
    const signingKey = process.env.ESCROW_SKEY;
    if (!signingKey) {
      logWarn("ESCROW_SKEY not set - showing transaction details only");
      logInfo(`Would send Cancel tx: ${escrowUTxO.tx_hash}#${escrowUTxO.output_index}`);
      logInfo(`Output: ${outputAmount/1e6} ADA to ${WALLET_ADDR.slice(0, 30)}...`);
      return { success: false, error: "ESCROW_SKEY not set", ready: true };
    }
    
    try {
      const txBody = buildEscrowTransaction({
        scriptInput: {
          txHash: escrowUTxO.tx_hash,
          index: escrowUTxO.output_index,
          amount: paymentAmount
        },
        collateralInput: {
          txHash: walletUTxO.tx_hash,
          index: walletUTxO.output_index,
          amount: parseInt(walletUTxO.amount.find(a => a.unit === "lovelace")?.quantity || "0")
        },
        output: { address: WALLET_ADDR, amount: outputAmount },
        redeemerType: REDEEMER_CANCEL,
        ttl: parseInt(status.tip.abs_slot) + 1000
      });
      
      const result = await signAndSubmit(txBody, signingKey, this.bf);
      
      if (result.success) {
        logSuccess(`Transaction submitted: ${result.txHash}`);
        logInfo(`Explorer: https://preprod.cardanoscan.io/transaction/${result.txHash}`);
      } else {
        logError(`Submit failed: ${result.error}`);
      }
      
      return result;
    } catch (e) {
      logError(`Build failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async testSettle() {
    logInfo("\n=== E2E Test: Settle Path ===");
    logInfo("Requirements:");
    logInfo("  - Oracle + Provider signatures");
    logInfo("  - Transaction before deadline");
    logInfo("  - Output paying provider >= payment");
    logInfo("  - Redeemer: Settle (constructor 0)");
    return { success: false, note: "Settle requires Oracle signature" };
  }

  async testRefund() {
    logInfo("\n=== E2E Test: Refund Path ===");
    logInfo("Requirements:");
    logInfo("  - Client signature");
    logInfo("  - Transaction after deadline");
    logInfo("  - Output paying client >= payment");
    logInfo("  - Redeemer: Refund (constructor 1)");
    return { success: false, note: "Refund requires deadline check in datum" };
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "status";
  
  console.log("=".repeat(60));
  console.log("ADADIVE Escrow E2E Testing (Koios + BlockFrost)");
  console.log("=".repeat(60));
  
  const tester = new EscrowE2ETester();
  
  switch (cmd) {
    case "status":
      await tester.checkStatus();
      break;
    case "cancel":
      console.log(await tester.testCancel());
      break;
    case "settle":
      console.log(await tester.testSettle());
      break;
    case "refund":
      console.log(await tester.testRefund());
      break;
    default:
      console.log(`Commands: status, cancel, settle, refund`);
  }
}

main().catch(e => {
  logError(`Fatal: ${e.message}`);
  process.exit(1);
});
