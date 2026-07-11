/**
 * Generate new Preprod wallets with mnemonic phrases
 * Saves the key material (mnemonic, private key, address) to the repository
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
  mnemonic: string;
  address: string;
  privateKeyHex: string;
  publicKeyHex: string;
  verificationKeyHash: string;
}

async function generateWalletFromMnemonic(Csl: any, name: string): Promise<WalletKeys> {
  // Generate a random 24-word mnemonic
  const entropy = Csl.Bip39Entropy.new(Buffer.from(
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
  ));
  
  // Create mnemonic from entropy (24 words)
  const mnemonic = entropy.to_mnemonic_list();
  const mnemonicStr = mnemonic.split(" ").slice(0, 24).join(" ");
  
  // Create entropy from mnemonic string
  const entropyFromMnemonic = Csl.Bip39Entropy.from_mnemonic_list(mnemonicStr.split(" "));
  
  // Derive root key from entropy
  const rootKey = Csl.Bip32RootKey.new(entropyFromMnemonic, "");
  
  // Derive private key using Cardano scheme
  // For Shelley addresses: m/1854'/1815'/0'/0/0 (1854 = Shelley, 1815 = Cardano, 0 = external, 0 = chain, 0 = index)
  const accountKey = rootKey
    .derive(1854 + 0x80000000) // Purpose
    .derive(1815 + 0x80000000) // Coin type
    .derive(0 + 0x80000000)     // Account
    .derive(0)                  // External chain
    .derive(0);                 // Address index
  
  const privKey = accountKey.to_raw_key();
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
    mnemonic: mnemonicStr,
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
  fs.writeFileSync(envFile, `# ${wallet.name} wallet\nMNEMONIC_${wallet.name.toUpperCase()}="${wallet.mnemonic}"\nPRIVATE_KEY_${wallet.name.toUpperCase()}="${wallet.privateKeyHex}"\nADDRESS_${wallet.name.toUpperCase()}="${wallet.address}"\nVKH_${wallet.name.toUpperCase()}="${wallet.verificationKeyHash}"\n`);
  
  console.log(`Wallet '${wallet.name}' generated:`);
  console.log(`   Mnemonic: ${wallet.mnemonic.split(" ").slice(0, 5).join(" ")} ... (24 words)`);
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
    await generateWalletFromMnemonic(Csl, "provider"),
    await generateWalletFromMnemonic(Csl, "oracle"),
    await generateWalletFromMnemonic(Csl, "client"),
  ];

  console.log("=".repeat(70));
  console.log("ADADIVE - PREPROD WALLET GENERATION (WITH MNEMONICS)");
  console.log("=".repeat(70));
  console.log();

  for (const wallet of wallets) {
    saveWalletKeys(wallet);
  }

  console.log("=".repeat(70));
  console.log("⚠️  IMPORTANT: These are NEW wallets with DIFFERENT addresses!");
  console.log("⚠️  Fund these via the faucet: https://docs.cardano.org/cardano-testnet/tools/faucet/");
  console.log("=".repeat(70));
  for (const wallet of wallets) {
    console.log(`  ${wallet.name.padEnd(10)}: ${wallet.address}`);
  }
  console.log("=".repeat(70));
  console.log("\nPrevious wallet addresses are now invalid - generate new ones with funds.");
}

main().catch(console.error);
