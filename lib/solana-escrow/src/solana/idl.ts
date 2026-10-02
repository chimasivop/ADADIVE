import { Program, type Idl } from "@anchor-lang/core";
import type { AdadiveEscrow } from "../idl/types/adadive_escrow";
import idlJson from "../idl/adadive_escrow.json";

/**
 * The Anchor-generated IDL, committed under `app/src/idl/`.
 *
 * `scripts/sync-idl.mjs` copies it out of `target/` (a gitignored build
 * artifact) so the app builds from a fresh clone without a Solana toolchain.
 * The generated `AdadiveEscrow` type is the IDL in camelCase, which is what the
 * client coder actually expects.
 */
export const ESCROW_IDL = idlJson as unknown as AdadiveEscrow & Idl;

export type EscrowProgram = Program<AdadiveEscrow>;
