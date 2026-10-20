/**
 * ADADIVE Solana escrow — client library.
 *
 * A thin layer over the Anchor-generated client for the four deal flows, plus
 * the wallet plumbing needed to drive them from a browser wallet or a raw
 * keypair. See `PHASE2_NOTES.md` for the two-party signature design.
 */
export {
  DEAL_SEED,
  PLATFORM_CONFIG_SEED,
  ESCROW_PROGRAM_ID,
  FEE_BASIS_POINTS_DENOMINATOR,
  LAMPORTS_PER_SOL,
} from "./constants";

export { findDealAddress, findPlatformConfigAddress } from "./pda";

export {
  computeFeeSplit,
  type FeeSplit,
  type PlatformConfigView,
} from "./fee";

export { ESCROW_IDL, type EscrowProgram } from "./idl";

/**
 * Re-export Anchor's `BN`, the integer type every instruction argument uses.
 *
 * Callers that build an instruction by hand (the oracle's live cap test) need
 * it, and getting it from here means they do not have to depend on
 * `@anchor-lang/core` directly or risk resolving a second copy of it.
 */
export { BN } from "@anchor-lang/core";

export {
  AdapterWallet,
  KeypairWallet,
  makeEscrowProgram,
  makeProvider,
  assertProgramIdMatchesIdl,
  type SignableWallet,
} from "./wallet";

export {
  DEFAULT_DEAL_DURATION_SECONDS,
  EscrowClient,
  buildCancelTransaction,
  buildInitializeTransaction,
  buildRefundTransaction,
  buildSettleTransaction,
  deserializeSummary,
  deserializeTransaction,
  fetchDeal,
  fetchPlatformConfig,
  openEnvelope,
  partialSign,
  platformConfigAddress,
  prepareReceivedTransaction,
  previewSettleSplit,
  relayEnvelope,
  serializeSummary,
  serializeTransaction,
  submitTransaction,
  type DealView,
  type InitializeEscrowParams,
  type PreparedTransaction,
  type RelayEnvelope,
  type SerializedSummary,
  type TransactionSummary,
} from "./escrow";
