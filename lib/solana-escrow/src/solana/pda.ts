import { PublicKey } from "@solana/web3.js";

import { DEAL_SEED, PLATFORM_CONFIG_SEED } from "./constants";

/**
 * Address derivation for the two on-chain accounts the client needs to name.
 *
 * Both are PDAs, so the client can compute them from public data alone — no
 * RPC round trip is needed to *address* an account, only to read its contents.
 * That mirrors the on-chain `seeds = [...]` declarations; the duplication is
 * unavoidable because an Anchor IDL does not expose a reusable seed spec.
 */

/** The singleton fee/treasury config, at `[b"platform_config"]`. */
export function findPlatformConfigAddress(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PLATFORM_CONFIG_SEED], programId);
}

/**
 * A deal, at `[b"deal", depositor, deal_id]`.
 *
 * The depositor and `deal_id` are part of the address, so two different
 * depositors (or two deals by the same depositor) can never collide. The
 * `deal_id` is hashed into the PDA as raw UTF-8 bytes, exactly as
 * `deal_id.as_bytes()` does on-chain; the 64-byte cap enforced by `initialize`
 * keeps a long id from being silently truncated by the seed hashing.
 */
export function findDealAddress(
  programId: PublicKey,
  depositor: PublicKey,
  dealId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEAL_SEED, depositor.toBuffer(), Buffer.from(dealId, "utf8")],
    programId
  );
}
