/**
 * Wallet-signature sign-in for the provider-agent.
 *
 * This is the *existing* flow, reused — not a new one. The agent performs the
 * same three steps the browser does, against the oracle backend:
 *
 *   1. `POST /auth/challenge { wallet }` → a one-time message to sign.
 *   2. sign the UTF-8 bytes of that message with the provider wallet's key
 *      (`ed25519.sign(message, seed)`), base58-encoded — what a wallet's
 *      `signMessage` does.
 *   3. `POST /auth/verify { wallet, nonce, signature }` → an HS256 session token
 *      the api-server also accepts.
 *
 * The token is refreshed lazily: it is presented on every api-server call via
 * `authorization()`, and a call that comes back 401 triggers one re-sign-in and
 * a retry. The token is never persisted — a restart simply signs in again.
 */

import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { readFileSync } from "node:fs";

import { encodeBase58 } from "@workspace/solana-escrow/backend/base58";
import type { Logger } from "./logger";

export interface AuthDeps {
  oracleBaseUrl: string;
  wallet: Keypair;
  logger: Logger;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Raised when sign-in could not be completed, so the caller can retry later. */
export class AuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AuthError";
  }
}

/** Load a Solana keypair from a JSON file (the `solana-keygen` format). */
export function loadKeypair(path: string): Keypair {
  const raw = readFileSync(path, "utf8");
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(bytes);
}

/**
 * Session holder. Signs in on demand and serves a bearer token until it is
 * rejected, at which point the caller calls `refresh()`.
 */
export class WalletSession {
  private token: string | null = null;
  private expiresAt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: AuthDeps) {
    // Bind so the instance receiver is not used as `fetch`'s `this` — the same
    // browser "Illegal invocation" trap documented for the shared backend client.
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get wallet(): string {
    return this.deps.wallet.publicKey.toBase58();
  }

  /** A valid token, signing in first if there is none or it has expired. */
  async ensure(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.expiresAt) return this.token;
    return this.refresh();
  }

  /** Force a fresh sign-in and return the new token. */
  async refresh(): Promise<string> {
    const message = await this.#challenge();
    const signature = encodeBase58(
      ed25519.sign(
        Buffer.from(message.message, "utf8"),
        this.deps.wallet.secretKey.slice(0, 32)
      )
    );

    const res = await this.fetchImpl(`${this.deps.oracleBaseUrl}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: this.wallet,
        nonce: message.nonce,
        signature,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new AuthError(
        `sign-in failed: oracle returned HTTP ${res.status}`,
        res.status
      );
    }

    const body = (await res.json()) as { token?: string; expiresAt?: string };
    if (!body.token) {
      throw new AuthError("sign-in failed: oracle returned no token");
    }

    this.token = body.token;
    // Refresh a minute before the stated expiry so a token is never presented
    // in its final second. If the oracle did not state an expiry, assume a
    // conservative 5 minutes.
    const expiry = body.expiresAt ? Date.parse(body.expiresAt) : NaN;
    this.expiresAt = Number.isFinite(expiry)
      ? expiry - 60_000
      : Date.now() + 5 * 60_000;

    this.deps.logger.info("signed in", { wallet: this.wallet });
    return this.token;
  }

  async #challenge(): Promise<{ message: string; nonce: string }> {
    const res = await this.fetchImpl(`${this.deps.oracleBaseUrl}/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: this.wallet }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new AuthError(
        `could not obtain a challenge: oracle returned HTTP ${res.status}`,
        res.status
      );
    }

    const body = (await res.json()) as { message?: string; nonce?: string };
    if (!body.message || !body.nonce) {
      throw new AuthError("challenge response was missing message or nonce");
    }
    return { message: body.message, nonce: body.nonce };
  }
}
