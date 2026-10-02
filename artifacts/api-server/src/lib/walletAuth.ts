/**
 * Wallet-session verification for the api-server.
 *
 * The api-server has two authentication mechanisms now, and they are not
 * interchangeable:
 *
 *   - **OIDC** (`lib/auth.ts`, `routes/auth.ts`) — a `sid` session cookie created
 *     by the authorization-code flow. It identifies a *person*.
 *   - **Wallet signature** (this file) — a bearer token the oracle backend mints
 *     after a Solana wallet signs a challenge. It identifies an *address*.
 *
 * The browser only ever performs the second. `/auth/login` is never called from
 * the app, so no `sid` is ever set, so every route behind the OIDC `requireAuth`
 * is unreachable from the UI — the 401 on Pin Files was the visible symptom.
 *
 * ## Why the api-server verifies rather than issues
 *
 * The frontend holds one session, obtained by signing a challenge against the
 * oracle. The obvious alternative — teach the api-server to run its own
 * challenge/verify and hand out its own token — means the wallet signs twice and
 * the app carries two sessions that expire independently. This keeps one flow:
 * the oracle remains the only place a signature is checked, and therefore the
 * only place identity is created. The api-server only *accepts* what the oracle
 * issued, using the shared verifier so both sides agree on the token format.
 *
 * ## The shared secret
 *
 * Verification needs the oracle's session signing key. In this deployment both
 * services are fed the same `SESSION_SECRET`; if it is absent the api-server
 * **fails closed** for wallet auth rather than inventing a key, so a
 * misconfiguration shows up as a 401 and a log line, not as a service that
 * accepts tokens nobody signed.
 */

import {
  parseSessionSecret,
  verifySessionToken,
  type SessionVerification,
} from "@workspace/solana-escrow/backend/session";
import { logger } from "./logger";

/**
 * Must match the oracle's defaults. A token whose `iss`/`aud` differ is refused,
 * which is the point: a session minted for another service is not accepted here.
 */
export const WALLET_SESSION_ISSUER = process.env.WALLET_SESSION_ISSUER ?? "adadive-oracle-backend";
export const WALLET_SESSION_AUDIENCE = process.env.WALLET_SESSION_AUDIENCE ?? "adadive-api";

/** Minimum key length, matching the oracle's `MIN_SESSION_SECRET_BYTES`. */
const MIN_SECRET_BYTES = 32;

/**
 * `undefined` = not yet read; `null` = read and unusable (fail closed); a value
 * = usable. The three-way distinction matters: conflating "not read" with
 * "unusable" would either re-parse on every request or silently accept nothing.
 */
let cachedSecret: Uint8Array | null | undefined;

/**
 * The session signing key, or `null` when wallet auth is not configured.
 *
 * Cached after the first read: the value cannot change while the process runs,
 * and `parseSessionSecret` throwing on every request would turn a config error
 * into a per-request 500.
 */
function sessionSecret(): Uint8Array | null {
  if (cachedSecret !== undefined) return cachedSecret;
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.trim().length === 0) {
    logger.warn(
      "SESSION_SECRET is not set; wallet-signed sessions will be rejected. " +
        "Set it to the same value the oracle backend uses."
    );
    cachedSecret = null;
    return cachedSecret;
  }

  try {
    const bytes = parseSessionSecret(raw);
    if (bytes.length < MIN_SECRET_BYTES) {
      logger.error(
        { length: bytes.length, required: MIN_SECRET_BYTES },
        "SESSION_SECRET is too short; wallet-signed sessions will be rejected"
      );
      cachedSecret = null;
      return null;
    }
    cachedSecret = bytes;
    return bytes;
  } catch (err) {
    logger.error({ err }, "SESSION_SECRET could not be parsed; wallet auth disabled");
    cachedSecret = null;
    return null;
  }
}

/**
 * A token that arrived on the `Authorization` header, or `null`.
 *
 * Only `Bearer` is read. The OIDC path also accepts this header (see
 * `getSessionId`), but with a `sid` as the value — the two live in different
 * value spaces, so the bearer check runs first and the OIDC fallback still
 * applies when it does not parse as a wallet token.
 */
export function getBearerToken(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** The full verification result, for callers that want the reason. */
export function verifyWalletSession(token: string): SessionVerification {
  const secret = sessionSecret();
  if (!secret) return { valid: false, reason: "bad_signature" };
  return verifySessionToken({
    token,
    secret,
    issuer: WALLET_SESSION_ISSUER,
    audience: WALLET_SESSION_AUDIENCE,
  });
}

/**
 * The wallet a valid token belongs to, or `null`.
 *
 * The single place identity is derived from a wallet token, so no handler
 * invents its own extraction. `sub` was set by the oracle from a wallet that
 * proved it held the key; a token cannot claim another address without the
 * signing secret, which only the oracle and this service hold.
 */
export function authenticatedWallet(token: string): string | null {
  const result = verifyWalletSession(token);
  if (!result.valid) return null;
  return result.claims.sub;
}
