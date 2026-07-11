/**
 * Generate mnemonic-based backups for existing wallets
 * Creates mnemonics that can be imported into hardware/software wallets
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateMnemonic } from "@meshsdk/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYS_DIR = path.resolve(__dirname, "../../../contracts/adadive-escrow/testnet/keys");

interface MnemonicBackup {
  note: string;
  mnemonic: string;
  address: string;
  privateKeyHex: string;
  publicKeyHex: string;
  verificationKeyHash: string;
  derivationPath: string;
  originalNote?: string;
}

async function main() {
  console.log("=".repeat(70));
  console.log("Generating mnemonic-based backups for existing wallets");
  console.log("=".repeat(70));
  console.log();

  for (const name of ["provider", "oracle", "client"]) {
    // Read existing wallet keys
    const keysPath = path.join(KEYS_DIR, name, "keys.json");
    
    if (!fs.existsSync(keysPath)) {
      console.log(`${name}: keys.json not found, skipping...`);
      continue;
    }
    
    const existingKeys = JSON.parse(fs.readFileSync(keysPath, "utf-8"));
    
    // Generate new 24-word mnemonic
    const mnemonic = generateMnemonic(256);
    const wordCount = mnemonic.split(" ").length;
    
    console.log(`${name}:`);
    console.log(`  Original address: ${existingKeys.address}`);
    console.log(`  Generated mnemonic (${wordCount} words): ${mnemonic.split(" ").slice(0, 3).join(" ")} ...`);
    console.log(`  Note: This mnemonic generates a DIFFERENT address than the funded one.`);
    console.log(`  The mnemonic is for backup/recovery purposes only.`);
    console.log();

    const backupDir = path.join(KEYS_DIR, name, "backup_mnemonic");
    fs.mkdirSync(backupDir, { recursive: true });

    const backup: MnemonicBackup = {
      note: "Mnemonic-based backup - can be imported into Nami, Eternl, Yoroi, etc. Generates a DIFFERENT address than the funded wallet.",
      mnemonic,
      // Note: We don't have the address from mnemonic since we can't derive it here
      // The mnemonic can be imported into a wallet to generate the address
      address: "Derive from mnemonic using Cardano wallet",
      privateKeyHex: existingKeys.privateKeyHex,
      publicKeyHex: existingKeys.publicKeyHex,
      verificationKeyHash: existingKeys.verificationKeyHash,
      derivationPath: "m/1854'/1815'/0'/0/0 (Shelley/CIP-1852)",
      originalNote: `This backup uses the mnemonic for reference. The funded wallet uses raw private key: ${existingKeys.privateKeyHex.slice(0, 20)}...`
    };

    // Save as JSON
    fs.writeFileSync(
      path.join(backupDir, "keys.json"),
      JSON.stringify(backup, null, 2)
    );

    // Save as .env
    fs.writeFileSync(
      path.join(backupDir, ".env"),
      `# ${name} mnemonic backup\n` +
      `# ========================================\n` +
      `# WARNING: This mnemonic generates a DIFFERENT address than the funded wallet!\n` +
      `# ========================================\n` +
      `# 24-word mnemonic (can be imported into Nami, Eternl, Yoroi, etc.):\n` +
      `MNEMONIC_${name.toUpperCase()}="${mnemonic}"\n` +
      `#\n` +
      `# Original funded wallet private key (HEX):\n` +
      `ORIGINAL_PRIVATE_KEY="${existingKeys.privateKeyHex}"\n` +
      `# Original funded wallet address:\n` +
      `ORIGINAL_ADDRESS="${existingKeys.address}"\n` +
      `# Verification key hash:\n` +
      `VERIFICATION_KEY_HASH="${existingKeys.verificationKeyHash}"\n`
    );

    // Also save mnemonic separately for easy recovery
    fs.writeFileSync(
      path.join(backupDir, "mnemonic.txt"),
      mnemonic
    );

    console.log(`  Saved to: ${backupDir}`);
    console.log();
  }

  console.log("=".repeat(70));
  console.log("✅ Mnemonic backups created!");
  console.log();
  console.log("To use these mnemonics:");
  console.log("  1. Import the mnemonic into Nami, Eternl, Yoroi, or other wallet");
  console.log("  2. The wallet will show the derived address");
  console.log("  3. IMPORTANT: This generates a DIFFERENT address than the funded wallet!");
  console.log();
  console.log("To access the EXISTING funded wallet, use:");
  console.log("  - The private key hex in keys.json");
  console.log("  - The original address listed above");
  console.log("=".repeat(70));
}

main().catch(console.error);
