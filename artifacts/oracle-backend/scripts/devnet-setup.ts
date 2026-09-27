/**
 * Initialise the local cluster the escrow backend and frontend talk to.
 *
 * Validator startup and deploy are handled by `scripts/devnet-setup.sh`, which
 * calls this afterwards. This half does the account work: create the singleton
 * `PlatformConfig` (fee + treasury) and write funded role keypairs to `keys/`
 * so there are real parties to settle between.
 *
 * It hand-encodes `initialize_config` rather than going through the Anchor
 * client because this is the one setup step a new checkout must be able to run
 * before the shared library's Anchor dependency has been resolved — and because
 * the instruction is a fixed 8-byte discriminator plus a `u16` and a `pubkey`,
 * which is less code than the plumbing it replaces. Everything past setup goes
 * through `@workspace/solana-escrow`.
 *
 * The keypairs are plain Solana CLI JSON and can be imported into Phantom or
 * Solflare to drive the walkthrough. They are throwaway localnet keys and are
 * gitignored. The oracle keypair is what the backend signs settles with, so it
 * must match `DEV_ORACLE_KEYPAIR_PATH`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const FEE_BP = 250; // 2.5%
const TREASURY = new PublicKey("CDCftN6avq75rWVxUGR816YxFqLrpPyQCXBBpBnPjAKt");
const PROGRAM_ID = new PublicKey(
  "B6kX44TWx7p75rEXaJmQ5jQJ3L9wGhZqaQ8xEK2j1cGp"
);

/** Where the role keypairs are written; `scripts/devnet-setup.sh` points this
 * at the repo root's `keys/`. */
const keysDir = process.env.ADADIVE_KEYS_DIR ?? resolve(process.cwd(), "keys");
const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const payerPath =
  process.env.ANCHOR_WALLET ?? resolve(process.env.HOME ?? "/", ".config/solana/id.json");

/** Anchor's account/instruction discriminator: `sha256("global:<name>")[0..8]`. */
function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function keypairFromFile(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[])
  );
}

/**
 * Reuse the role keypair already on disk when there is one.
 *
 * Generating fresh keys on every run made restarts unstable: the oracle's
 * public key is baked into each deal's escrow account at creation, so a new
 * oracle key orphans every deal created before the restart. Reusing keeps a
 * running localnet self-consistent. The keys are throwaway and localnet-only,
 * so this is about stability, not about protecting anything valuable.
 */
function loadOrGenerate(path: string): { keypair: Keypair; reused: boolean } {
  if (existsSync(path)) {
    return { keypair: keypairFromFile(path), reused: true };
  }
  return { keypair: Keypair.generate(), reused: false };
}

async function exists(connection: Connection, address: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(address, "confirmed")) !== null;
}

async function main() {
  const connection = new Connection(rpcUrl, "confirmed");
  const authority = keypairFromFile(payerPath);

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_config")],
    PROGRAM_ID
  );

  if (await exists(connection, config)) {
    console.log(`PlatformConfig already exists at ${config.toBase58()}`);
  } else {
    // `initialize_config(fee_basis_points: u16, treasury: pubkey)`.
    const data = Buffer.concat([
      discriminator("initialize_config"),
      (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(FEE_BP, 0);
        return b;
      })(),
      TREASURY.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: authority.publicKey, isSigner: false, isWritable: false },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" }
    );
    console.log(
      `Initialised PlatformConfig at ${config.toBase58()} ` +
        `(fee ${FEE_BP}bp, treasury ${TREASURY.toBase58()}) in ${sig}`
    );
  }

  mkdirSync(keysDir, { recursive: true });
  const roleNames = ["depositor", "provider", "oracle"] as const;
  const roles: Array<[string, Keypair, boolean]> = roleNames.map((name) => {
    const path = resolve(keysDir, `${name}.json`);
    const { keypair, reused } = loadOrGenerate(path);
    return [name, keypair, reused];
  });

  for (const [name, keypair, reused] of roles) {
    const path = resolve(keysDir, `${name}.json`);
    writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
    const balance = await connection.getBalance(keypair.publicKey, "confirmed");
    if (!reused || balance === 0) {
      const sig = await connection.requestAirdrop(
        keypair.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature: sig, ...latest },
        "confirmed"
      );
    }
    console.log(
      `${name.padEnd(9)} ${keypair.publicKey.toBase58()}  -> ${path}${reused ? " (reused)" : ""}`
    );
  }


  // Fund the treasury so the fee arriving there is observable as a balance.
  const treasuryTx = await connection.requestAirdrop(TREASURY, LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: treasuryTx, ...latest },
    "confirmed"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
