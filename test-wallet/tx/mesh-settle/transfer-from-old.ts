#!/usr/bin/env node
/**
 * ADADIVE - Transfer ADA from old wallet to new Mesh.js wallets
 */

import { MeshTxBuilder, BlockfrostProvider } from "@meshsdk/core";

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// Old client wallet (has 461 ADA)
const OLD_CLIENT_ADDR = "addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep";
const OLD_CLIENT_SKEY_HEX = "cd670651e7be6353094a8c8e7e4320290986f087b3e1ba2318108768bc39318e";

// New Mesh.js wallets (addresses)
const NEW_PROVIDER_ADDR = "addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze";
const NEW_ORACLE_ADDR = "addr_test1qzgqy6matteypul5lm2qm5slvkqkyywxx770tscmgrz5ydvsqf4h6khjgrelflk5phfp7evpvgguvdau7hp3ksx9gg6syjmkgc";
const NEW_CLIENT_ADDR = "addr_test1qqzhypzf627yh0ymrhsrf0uhykhyfq5ue0la5799n8vyh0s9wgzyn54ufw7fk80qxjlewfdwgjpfejllmfu2txwcfwlqp8geuk";

const GREEN = "\x1b[0;32m";
const BLUE = "\x1b[0;34m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m";

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

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ADADIVE — Transfer from Old Wallet to New Wallets");
  console.log("=".repeat(70));

  // Check old wallet balance
  console.log("\nChecking old wallet balance...");
  const utxos = await bfFetch(`/addresses/${OLD_CLIENT_ADDR}/utxos`);
  
  let totalLovelace = BigInt(0);
  for (const utxo of utxos) {
    for (const amount of utxo.amount) {
      if (amount.unit === "lovelace") {
        totalLovelace += BigInt(amount.quantity);
      }
    }
  }
  
  console.log(`Old wallet balance: ${Number(totalLovelace) / 1000000} ADA`);
  console.log(`UTxOs: ${utxos.length}`);

  if (totalLovelace < BigInt(3000000)) {
    console.log(`${RED}Insufficient balance to transfer${NC}`);
    process.exit(1);
  }

  // Initialize provider
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);

  // Calculate transfer amounts
  // Leave 15 ADA for fees and future operations, split rest among new wallets
  const minBalance = BigInt(15000000); // 15 ADA
  const toTransfer = totalLovelace - minBalance;
  const perWallet = Math.floor(Number(toTransfer) / 3);
  
  console.log(`\nTransferring ${Number(toTransfer) / 1000000} ADA total`);
  console.log(`Per wallet: ${perWallet / 1000000} ADA`);

  // Build transaction
  const txBuilder = new MeshTxBuilder({
    fetcher: bfProvider,
    submitter: bfProvider,
  });

  txBuilder.signingKey(OLD_CLIENT_SKEY_HEX);

  // Add outputs to new wallets - use explicit lovelace values
  const unsignedTx = await txBuilder
    .txOut(NEW_PROVIDER_ADDR, [
      { unit: "lovelace", quantity: String(perWallet) }
    ])
    .txOut(NEW_ORACLE_ADDR, [
      { unit: "lovelace", quantity: String(perWallet) }
    ])
    .txOut(NEW_CLIENT_ADDR, [
      { unit: "lovelace", quantity: String(perWallet) }
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
    
    console.log("\nNew wallet balances:");
    console.log(`  Provider: ${NEW_PROVIDER_ADDR}`);
    console.log(`  Oracle: ${NEW_ORACLE_ADDR}`);
    console.log(`  Client: ${NEW_CLIENT_ADDR}`);
    
    console.log("\nEach wallet should have approximately:");
    console.log(`  ${Number(perWallet) / 1000000} ADA`);
    
  } catch (error: any) {
    console.error(`\n${RED}❌ TRANSFER FAILED: ${error.message}${NC}`);
    throw error;
  }
}

main().catch(console.error);
