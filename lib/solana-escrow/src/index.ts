/**
 * ADADIVE Solana escrow — shared client library.
 *
 * This is the single source of truth for the on-chain escrow client, shared by
 * the browser app (`artifacts/cardano-storage`) and the oracle backend
 * (`artifacts/oracle-backend`). The backend imports `findDealAddress` from here
 * so the PDA it derives matches the one the UI initializes, and imports the
 * `BackendApi` transport so the challenge/settle/dispute conversation is defined
 * once.
 *
 * See `SOLANA_MIGRATION.md` for the Cardano → Solana mapping.
 */
export * from "./solana";
export * from "./backend/api";
export { encodeBase58 } from "./backend/base58";
export * from "./format";
