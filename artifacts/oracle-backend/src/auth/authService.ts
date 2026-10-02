/**
 * Wallet-signature authentication.
 *
 * Two operations, and the security of the whole phase lives in the second one:
 *
 *   `issueChallenge(wallet)` — mint a one-time, short-lived message for a wallet
 *                              to sign. Cheap, unauthenticated, and harmless on
 *                              its own: it creates a row and returns text.
 *
 *   `verify({ wallet, nonce, signature })` — the authentication boundary. It
 *                              checks that the challenge exists, is unexpired,
 *                              is unused, is for this wallet, and that the
 *                              signature is this wallet's signature over the
 *                              *stored* message bytes. Only then does it mint a
 *                              session token, with `sub` set from the verified
 *                              wallet.
 *
 * ## The order of checks in `verify`, and why
 *
 * Signature verification happens **before** consuming the challenge. Consuming
 * first would let an attacker burn any wallet's outstanding challenge by
 * submitting garbage signatures — a trivial denial of service on sign-in. So:
 * verify the signature (cheap, no writes), then consume atomically.
 *
 * The reverse hazard — a valid signature replayed twice — is handled by the
 * conditional UPDATE in `AuthChallengeRepository.consume`, not by this ordering.
 * The two mechanisms compose: signature-first stops the DoS, consume-once stops
 * the replay.
 *
 * ## What `sub` is set from
 *
 * The wallet that the *signature* proved control of, which is required to equal
 * the wallet the challenge was issued to. Never a request-body field. A caller
 * cannot ask for a session as some other address, because that would require
 * producing a signature under that address's key.
 */

import { PublicKey } from "@solana/web3.js";

import type { AuthConfig } from "../config";
import {
  buildChallengeMessage,
  challengeMessageBytes,
  generateNonce,
  type SolanaChainId,
} from "./challengeMessage";
import {
  issueSessionToken,
  verifySessionToken,
  type SessionClaims,
  type SessionVerification,
} from "./sessionToken";
import { verifyEd25519Signature, decodeSignature, parsePublicKey } from "./signature";
import type { AuthChallengeRepository, AuthChallenge } from "../db/authChallengeRepository";
import type { SessionSecret } from "./sessionSecret";
import type { Logger } from "../logger";
import type { SecretRegistry } from "../security/redact";

export interface AuthServiceDeps {
  challenges: AuthChallengeRepository;
  sessionSecret: SessionSecret;
  config: AuthConfig;
  logger: Logger;
  registry: SecretRegistry;
  /** Injectable clock, for expiry tests that must not sleep. */
  now?: () => Date;
}

export interface IssuedChallenge {
  /** The exact message to sign. */
  message: string;
  /** The nonce, which the client echoes back to `/auth/verify`. */
  nonce: string;
  expiresAt: Date;
}

/** Why a verify attempt was refused. Each maps to a 401 (or 403) at the edge. */
export type AuthFailureReason =
  | "invalid_wallet"
  | "challenge_not_found"
  | "challenge_expired"
  | "challenge_already_used"
  | "challenge_wallet_mismatch"
  | "invalid_signature";

export type VerifyResult =
  | {
      ok: true;
      token: string;
      wallet: string;
      expiresAt: Date;
      claims: SessionClaims;
    }
  | { ok: false; reason: AuthFailureReason };

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /**
   * Issue a challenge for a wallet.
   *
   * The wallet is validated as a real public key first: issuing a challenge for
   * a malformed address would create a row nobody can ever use, and would turn
   * the endpoint into a small storage-growth vector.
   */
  async issueChallenge(walletBase58: string): Promise<IssuedChallenge | null> {
    const wallet = parsePublicKey(walletBase58);
    if (!wallet) return null;

    const nonce = generateNonce();
    const issuedAt = this.now();
    const expiresAt = new Date(
      issuedAt.getTime() + this.deps.config.challengeTtlSeconds * 1000
    );

    const message = buildChallengeMessage({
      domain: this.deps.config.domain,
      uri: this.deps.config.uri,
      wallet: wallet.toBase58(),
      nonce,
      issuedAt,
      expiresAt,
      chainId: this.deps.config.chainId as SolanaChainId,
    });

    // Stored verbatim. Verification compares against these exact bytes, so a
    // formatting change can never silently invalidate outstanding challenges.
    const stored = await this.deps.challenges.issue({
      wallet: wallet.toBase58(),
      nonce,
      message,
      domain: this.deps.config.domain,
      expiresAt,
    });

    this.deps.logger.info("sign-in challenge issued", {
      wallet: stored.wallet,
      nonce: stored.nonce,
      expiresAt: stored.expiresAt.toISOString(),
    });

    return { message: stored.message, nonce: stored.nonce, expiresAt: stored.expiresAt };
  }

  /**
   * Verify a signed challenge and issue a session token.
   *
   * The signature is over the message stored for the challenge, retrieved by
   * nonce — not over a message the caller supplies. If the caller could supply
   * the message, they could sign an innocuous one and present it as a challenge
   * for a different wallet; verifying against the stored bytes closes that.
   */
  async verify(params: {
    walletBase58: string;
    nonce: string;
    signatureBase58: string;
  }): Promise<VerifyResult> {
    const wallet = parsePublicKey(params.walletBase58);
    if (!wallet) return { ok: false, reason: "invalid_wallet" };

    const challenge = await this.deps.challenges.findByNonce(params.nonce);
    if (!challenge) return { ok: false, reason: "challenge_not_found" };

    // Read-only pre-checks, purely so the caller gets a legible reason. The
    // binding guarantee is in `consume` below; these cannot be relied on alone
    // because they race.
    if (challenge.consumedAt !== null) {
      return { ok: false, reason: "challenge_already_used" };
    }
    if (challenge.wallet !== wallet.toBase58()) {
      return { ok: false, reason: "challenge_wallet_mismatch" };
    }
    if (challenge.expiresAt.getTime() <= this.now().getTime()) {
      return { ok: false, reason: "challenge_expired" };
    }

    // Signature check before consuming, so a garbage signature cannot burn a
    // legitimate challenge (see the class comment).
    const signature = decodeSignature(params.signatureBase58);
    if (!signature) return { ok: false, reason: "invalid_signature" };

    const signatureValid = verifyEd25519Signature({
      publicKey: wallet,
      message: challengeMessageBytes(challenge.message),
      signature,
    });
    if (!signatureValid) {
      this.deps.logger.warn("sign-in rejected: signature did not verify", {
        wallet: wallet.toBase58(),
        nonce: params.nonce,
      });
      return { ok: false, reason: "invalid_signature" };
    }

    // Now consume it, atomically. Losing this race means a concurrent request
    // already consumed it, which is a replay.
    const consumed = await this.deps.challenges.consume({
      nonce: params.nonce,
      wallet: wallet.toBase58(),
      domain: this.deps.config.domain,
    });
    if (!consumed.ok) {
      return { ok: false, reason: mapChallengeFailure(consumed.reason) };
    }

    const issuedAt = this.now();
    const token = issueSessionToken({
      wallet: wallet.toBase58(),
      secret: this.deps.sessionSecret.reveal(),
      issuer: this.deps.config.issuer,
      audience: this.deps.config.audience,
      ttlSeconds: this.deps.config.sessionTtlSeconds,
      now: () => issuedAt,
    });

    const verification = verifySessionToken({
      token,
      secret: this.deps.sessionSecret.reveal(),
      issuer: this.deps.config.issuer,
      audience: this.deps.config.audience,
      now: () => issuedAt,
    });
    if (!verification.valid) {
      // A token we just minted failing verification is an internal inconsistency;
      // refuse rather than hand out something we cannot validate.
      throw new Error(
        `issued session token failed verification: ${verification.reason}`
      );
    }

    this.deps.logger.info("sign-in succeeded", {
      wallet: wallet.toBase58(),
      // The token id is a non-secret identifier; the token itself is never logged.
      jti: verification.claims.jti,
      expiresAt: new Date(verification.claims.exp * 1000).toISOString(),
    });

    return {
      ok: true,
      token,
      wallet: wallet.toBase58(),
      expiresAt: new Date(verification.claims.exp * 1000),
      claims: verification.claims,
    };
  }

  /** Validate a session token presented on a mutating request. */
  verifySession(token: string): SessionVerification {
    return verifySessionToken({
      token,
      secret: this.deps.sessionSecret.reveal(),
      issuer: this.deps.config.issuer,
      audience: this.deps.config.audience,
      now: this.deps.now ? this.deps.now : undefined,
    });
  }

  /**
   * The wallet a valid session belongs to, or `null`.
   *
   * The single place identity is derived from a token, so no handler invents
   * its own extraction.
   */
  authenticatedWallet(token: string): string | null {
    const result = this.verifySession(token);
    if (!result.valid) return null;
    // `sub` is set from a verified signature; a token cannot claim another
    // address without the signing secret, which only this service holds.
    return result.claims.sub;
  }
}

function mapChallengeFailure(
  reason: "not_found" | "expired" | "already_used" | "wallet_mismatch" | "domain_mismatch"
): AuthFailureReason {
  switch (reason) {
    case "not_found":
      return "challenge_not_found";
    case "expired":
      return "challenge_expired";
    case "already_used":
      return "challenge_already_used";
    case "wallet_mismatch":
      return "challenge_wallet_mismatch";
    case "domain_mismatch":
      // A domain mismatch is a signature minted for another origin. Report it as
      // a bad challenge rather than inventing a distinct client-visible category.
      return "challenge_not_found";
  }
}

export type { AuthChallenge, PublicKey };
