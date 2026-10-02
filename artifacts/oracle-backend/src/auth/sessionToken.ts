/**
 * Session tokens — the oracle's view.
 *
 * The implementation moved to `@workspace/solana-escrow/backend/session`, so the
 * service that *issues* a session and the service that *verifies* it run the
 * same code over the same base64url and HMAC helpers. Two copies would be a
 * difference that never shows up until a token mysteriously fails to verify —
 * exactly the class of bug this file used to be able to introduce.
 *
 * The prose that used to live here — why the verifier is hand-written, why `alg`
 * is checked rather than honoured, what each claim means — moved with the code.
 * This module stays the oracle's single import point.
 *
 * The session secret is a *symmetric* key and is deliberately not the oracle
 * key: a leaked session does not imply a leaked oracle key. `parseSessionSecret`
 * is likewise not the oracle key parser — interpreting 32 bytes as a Solana seed
 * would silently accept a value that is not a keypair at all.
 */

export {
  JWT_ALGORITHM,
  issueSessionToken,
  verifySessionToken,
  parseSessionSecret,
  type SessionClaims,
  type SessionVerification,
  type SessionFailureReason,
  type IssueSessionParams,
  type VerifySessionParams,
} from "@workspace/solana-escrow/backend/session";
