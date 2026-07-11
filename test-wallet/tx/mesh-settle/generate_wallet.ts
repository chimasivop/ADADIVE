/**
 * Generate a new Preprod wallet compatible with Mesh.js
 * Saves the key material to the repository for persistence
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use dynamic import for cardano-serialization-lib
const KEYS_DIR = path.resolve(__dirname, "../../../contracts/adadive-escrow/testnet/keys");

interface WalletKeys {
  name: string;
  address: string;
  privateKeyHex: string;
  publicKeyHex: string;
  verificationKeyHash: string;
}

async function generateWallet(Csl: any, name: string): Promise<WalletKeys> {
  // Generate a new private key using CSL
  const privKey = Csl.PrivateKey.generate_ed25519extended();
  const privKeyHex = privKey.to_hex();
  
  const pubKey = privKey.to_public();
  const pubKeyHex = pubKey.to_hex();
  
  // Get the verification key hash (VKH) - first 28 bytes of hash
  const pubKeyHash = pubKey.hash();
  const vkhHex = pubKeyHash.to_hex();
  
  // Create credential and stake credential from key hash
  const cred = Csl.Credential.from_keyhash(pubKeyHash);
  const stakeCred = Csl.Credential.from_keyhash(pubKeyHash);
  
  // Create address from public key hash for testnet (network id = 0)
  const baseAddr = Csl.BaseAddress.new(0, cred, stakeCred);
  
  const address = baseAddr.to_address().to_bech32();
  
  return {
    name,
    address,
    privateKeyHex: privKeyHex,
    publicKeyHex: pubKeyHex,
    verificationKeyHash: vkhHex
  };
}

function saveWalletKeys(wallet: WalletKeys) {
  const walletDir = path.join(KEYS_DIR, wallet.name);
  fs.mkdirSync(walletDir, { recursive: true });
  
  // Save as JSON with all key material
  const walletFile = path.join(walletDir, "keys.json");
  fs.writeFileSync(walletFile, JSON.stringify(wallet, null, 2));
  
  // Also save as .env file for easy loading
  const envFile = path.join(walletDir, ".env");
  fs.writeFileSync(envFile, `WALLET_NAME=${wallet.name}\nWALLET_ADDRESS=${wallet.address}\nWALLET_SKEY=${wallet.privateKeyHex}\nWALLET_VKH=${wallet.verificationKeyHash}\n`);
  
  console.log(`Wallet '${wallet.name}' generated:`);
  console.log(`   Address: ${wallet.address}`);
  console.log(`   VKH:     ${wallet.verificationKeyHash}`);
  console.log(`   Saved to: ${walletDir}`);
  console.log();
}

// Main async function
async function main() {
  // Dynamic import of cardano-serialization-lib
  const Csl = await import("@emurgo/cardano-serialization-lib-nodejs");
  
  // Generate wallets for provider, oracle, and client
  const wallets = [
    await generateWallet(Csl, "provider"),
    await generateWallet(Csl, "oracle"),
    await generateWallet(Csl, "client"),
  ];

  console.log("=".repeat(70));
  console.log("ADADIVE - PREPROD WALLET GENERATION");
  console.log("=".repeat(70));
  console.log();

  for (const wallet of wallets) {
    saveWalletKeys(wallet);
  }

  console.log("=".repeat(70));
  console.log("FUND THESE ADDRESSES VIA FAUCET:");
  console.log("https://docs.cardano.org/cardano-testnet/tools/faucet/");
  console.log("=".repeat(70));
  for (const wallet of wallets) {
    console.log(`  ${wallet.name.padEnd(10)}: ${wallet.address}`);
  }
  console.log("=".repeat(70));
}

main().catch(console.error);
