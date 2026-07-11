#!/usr/bin/env node
/**
 * ADADIVE - Simple Transfer from Old Wallet to New Wallet
 */

import { MeshTxBuilder, BlockfrostProvider } from "@meshsdk/core";

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// Old client wallet (has 461 ADA)
const OLD_CLIENT_ADDR = "addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep";
const OLD_CLIENT_SKEY_HEX = "cd670651e7be6353094a8c8e7e4320290986f087b3e1ba2318108768bc39318e";
const OLD_UTXO_HASH = "5b3d024647331dd51bdccf853388c8734b7f4973251f2e3ae687fa0ccfafe5af";
const OLD_UTXO_INDEX = 1;
const OLD_UTXO_AMOUNT = 461308892; // lovelace

// New wallet address (provider)
const NEW_PROVIDER_ADDR = "addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze";

const GREEN = "\x1b[0;32m";
const BLUE = "\x1b[0;34m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m";

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Simple Transfer to New Wallet");
  console.log("=".repeat(70));

  // Transfer amount - leave 10 ADA for fees
  const transferAmount = 450000000; // 450 ADA
  const minRemaining = 11308892; // ~11.3 ADA to keep
  
  console.log(`\nTransferring 450 ADA to new wallet...`);
  console.log(`Old wallet will retain: ${(OLD_UTXO_AMOUNT - transferAmount) / 1000000} ADA`);

  // Initialize provider
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);

  // Build transaction
  const txBuilder = new MeshTxBuilder({
    fetcher: bfProvider,
    submitter: bfProvider,
  });

  txBuilder.signingKey(OLD_CLIENT_SKEY_HEX);

  // Manual UTxO input and output
  const unsignedTx = await txBuilder
    .txIn(OLD_UTXO_HASH, OLD_UTXO_INDEX)
    .txOut(NEW_PROVIDER_ADDR, [
      { unit: "lovelace", quantity: String(transferAmount) }
    ])
    .changeAddress(OLD_CLIENT_ADDR)
    .complete();

  console.log(`Transaction built (${unsignedTx.length / 2} bytes)`);

  const signedTxHex = txBuilder.completeSigning();
  console.log("Transaction signed");

  console.log("\nSubmitting...");
  try {
    const txHash = await bfProvider.submitTx(signedTxHex);
    console.log(`\n${GREEN}✅ TRANSFER SUCCESSFUL${NC}`);
    console.log(`Tx hash: ${txHash}`);
    console.log(`Explorer: https://preprod.cardanoscan.io/transaction/${txHash}`);
    
    console.log(`\nNew provider wallet funded:`);
    console.log(`  ${NEW_PROVIDER_ADDR}`);
    console.log(`  Amount: 450 ADA`);
    
  } catch (error: any) {
    console.error(`\n${RED}❌ TRANSFER FAILED: ${error.message}${NC}`);
    throw error;
  }
}

main().catch(console.error);
