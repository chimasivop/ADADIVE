#!/usr/bin/env node
/**
 * ADADIVE - Transfer to Oracle and Client wallets from old wallet
 */

import { MeshTxBuilder, BlockfrostProvider } from "@meshsdk/core";

const BF_PROJECT_ID = "preprodaUBJIZq0ZKnlX2Yn6cEJZ29U1sp4L4Fy";

// Old client wallet (now has ~11 ADA)
const OLD_CLIENT_ADDR = "addr_test1vz09qfz7g67g42aqje8lyneq3php3yujzz0602c44qn6l2clrclep";
const OLD_CLIENT_SKEY_HEX = "cd670651e7be6353094a8c8e7e4320290986f087b3e1ba2318108768bc39318e";

// New wallets
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
  console.log("ADADIVE — Transfer to Oracle and Client");
  console.log("=".repeat(70));

  // Check old wallet balance
  console.log("\nChecking old wallet balance...");
  const utxos = await bfFetch(`/addresses/${OLD_CLIENT_ADDR}/utxos`);
  
  let totalLovelace = BigInt(0);
  let utxoHash = "";
  let utxoIndex = 0;
  
  for (const utxo of utxos) {
    for (const amount of utxo.amount) {
      if (amount.unit === "lovelace") {
        totalLovelace += BigInt(amount.quantity);
        utxoHash = utxo.tx_hash;
        utxoIndex = utxo.output_index;
      }
    }
  }
  
  console.log(`Old wallet balance: ${Number(totalLovelace) / 1000000} ADA`);
  console.log(`UTxO: ${utxoHash}#${utxoIndex}`);

  if (totalLovelace < BigInt(5000000)) {
    console.log(`${RED}Insufficient balance - need at least 5 ADA${NC}`);
    console.log("Trying alternative: transfer from new provider wallet instead");
    
    // Alternative: transfer from new provider wallet
    const PROVIDER_ADDR = "addr_test1qqjy0kc8uwmnkqxnewdjw8jz7nj8tkyz6p5ranjr035rvlfyglds0cah8vqd8jumyu0y9a8ywhvg95rg8m8yxlrgxe7scjfqze";
    const PROVIDER_SKEY_HEX = "5a359b6c6b3e7a3e2f8e4d5c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a";
    
    console.log("\nChecking provider wallet balance...");
    const providerUtxos = await bfFetch(`/addresses/${PROVIDER_ADDR}/utxos`);
    let providerTotal = BigInt(0);
    for (const utxo of providerUtxos) {
      for (const amount of utxo.amount) {
        if (amount.unit === "lovelace") {
          providerTotal += BigInt(amount.quantity);
        }
      }
    }
    console.log(`Provider balance: ${Number(providerTotal) / 1000000} ADA`);
    
    if (providerTotal < BigInt(10000000)) {
      console.log(`${RED}Provider also has insufficient balance${NC}`);
      process.exit(1);
    }
    
    // Transfer from provider
    const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);
    const txBuilder = new MeshTxBuilder({ fetcher: bfProvider, submitter: bfProvider });
    txBuilder.signingKey(PROVIDER_SKEY_HEX);
    
    const transferAmount = 50000000; // 50 ADA each
    
    const firstUtxo = providerUtxos[0];
    const unsignedTx = await txBuilder
      .txIn(firstUtxo.tx_hash, firstUtxo.output_index)
      .txOut(NEW_ORACLE_ADDR, [{ unit: "lovelace", quantity: String(transferAmount) }])
      .txOut(NEW_CLIENT_ADDR, [{ unit: "lovelace", quantity: String(transferAmount) }])
      .changeAddress(PROVIDER_ADDR)
      .complete();
    
    console.log(`Transaction built`);
    const signedTxHex = txBuilder.completeSigning();
    console.log("Transaction signed");
    
    console.log("\nSubmitting...");
    try {
      const txHash = await bfProvider.submitTx(signedTxHex);
      console.log(`\n${GREEN}✅ TRANSFER SUCCESSFUL${NC}`);
      console.log(`Tx hash: ${txHash}`);
      console.log(`Explorer: https://preprod.cardanoscan.io/transaction/${txHash}`);
    } catch (error: any) {
      console.error(`\n${RED}❌ FAILED: ${error.message}${NC}`);
    }
    return;
  }

  // Transfer from old wallet
  const bfProvider = new BlockfrostProvider(BF_PROJECT_ID);
  const txBuilder = new MeshTxBuilder({ fetcher: bfProvider, submitter: bfProvider });
  txBuilder.signingKey(OLD_CLIENT_SKEY_HEX);

  // Transfer all but ~2 ADA
  const transferAmount = Number(totalLovelace - BigInt(2000000));
  
  const unsignedTx = await txBuilder
    .txIn(utxoHash, utxoIndex)
    .txOut(NEW_ORACLE_ADDR, [{ unit: "lovelace", quantity: String(Math.floor(transferAmount / 2)) }])
    .txOut(NEW_CLIENT_ADDR, [{ unit: "lovelace", quantity: String(Math.floor(transferAmount / 2)) }])
    .changeAddress(OLD_CLIENT_ADDR)
    .complete();

  console.log(`Transaction built`);
  const signedTxHex = txBuilder.completeSigning();
  console.log("Transaction signed");

  console.log("\nSubmitting...");
  try {
    const txHash = await bfProvider.submitTx(signedTxHex);
    console.log(`\n${GREEN}✅ TRANSFER SUCCESSFUL${NC}`);
    console.log(`Tx hash: ${txHash}`);
    console.log(`Explorer: https://preprod.cardanoscan.io/transaction/${txHash}`);
  } catch (error: any) {
    console.error(`\n${RED}❌ FAILED: ${error.message}${NC}`);
  }
}

main().catch(console.error);
