/**
 * HTTP surface for the oracle backend.
 *
 * Seven endpoints, deliberately small:
 *
 *   POST /auth/challenge            issue a one-time challenge to sign
 *   POST /auth/verify               verify the signature → session token
 *   POST /deals                     register a deal (called when it's initialized)
 *   POST /deals/:id/settle          provider requests settlement → verify → open window
 *   POST /deals/:id/dispute         depositor raises a dispute (window must be open)
 *   GET  /deals/:id                 deal state incl. challenge window and disputes
 *   POST /jobs/challenge-window     run the window-close job once (cron/manual)
 *
 * Three things about this layer matter more than the routes:
 *
 * **It never signs.** No handler constructs or submits a settle transaction.
 * Settlement is reached only through the job, whose decision logic lives in
 * `OracleService` and is guarded in SQL. That is what makes "a disputed deal
 * does not settle" a property of one code path rather than of every route.
 *
 * **Mutating routes are authenticated.** `requireAuth` validates a session token
 * issued by `/auth/verify`, whose `sub` came from a wallet signature, and
 * attaches the verified wallet as `req.authenticatedWallet`. Each mutating route
 * then requires that wallet to be the party the action belongs to: the depositor
 * for registration and disputes, the provider for settlement requests. See the
 * per-route comments for why each role is the right one.
 *
 * **It never leaks a secret.** Every response is built from the `Deal` and
 * `Dispute` domain objects, which contain no key material, and every error goes
 * through `safeErrorMessage` against the shared registry before it is written.
 * The oracle key and the session signing secret are loaded at startup and held
 * in objects whose serialisation is redacted, so neither can reach a response
 * even by accident. A test asserts this by grepping every response body for the
 * key's encodings — and the sign-in flow is included in that sweep, since it is
 * the route most likely to echo something back.
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { PublicKey } from "@solana/web3.js";

import { ESCROW_PROGRAM_ID, findDealAddress } from "@workspace/solana-escrow";
import type { Logger } from "../logger";
import type { DealRepository, DisputeRepository } from "../db/repository";
import type { Deal, DealStatus } from "../db/types";
import type { OracleService } from "../service/oracleService";
import type { OracleKeypair } from "../oracle/keyProvider";
import type { AuthService, AuthFailureReason } from "../auth/authService";
import { safeErrorMessage, type SecretRegistry } from "../security/redact";

/**
 * The authenticated wallet, attached to a request by `requireAuth`.
 *
 * Declaration-merged into Express's `Request` so handlers read
 * `req.authenticatedWallet` with a type rather than a cast. It is `string |
 * undefined` and not merely `string`: a route that forgot to mount `requireAuth`
 * would otherwise type-check while `undefined` at runtime, which is exactly the
 * bug a type should catch.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authenticatedWallet?: string;
    }
  }
}

export interface ApiDeps {
  deals: DealRepository;
  disputes: DisputeRepository;
  service: OracleService;
  oracle: OracleKeypair;
  logger: Logger;
  registry: SecretRegistry;
  defaultChallengeWindowSeconds: number;
  /** Runs the challenge-window job once; the tick's implementation detail. */
  runJob: () => Promise<unknown>;
  /**
   * Wallet-signature auth. When present, mutating routes require a valid session
   * token and `req.authenticatedWallet` is populated. When absent, the
   * development posture applies (see `createApp`).
   *
   * There is deliberately no longer a general-purpose `authorize` hook here.
   * Phase 3 had one as a fail-closed stub; now that `auth` exists, an override
   * could only ever *bypass* the session check, and a bypass that is reachable
   * by configuration is a bypass that will eventually be configured.
   */
  auth?: AuthService;
  /**
   * When true, mutating routes are refused with 401 unless a valid session token
   * is presented via `auth`. Defaults to true in `index.ts`.
   */
  requireAuth?: boolean;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** A deal as the API exposes it — no internal columns, no secrets. */
function serializeDeal(deal: Deal) {
  return {
    id: deal.id,
    dealId: deal.dealId,
    dealPda: deal.dealPda,
    depositor: deal.depositor,
    provider: deal.provider,
    // The oracle's *public* key is not a secret and is useful in a response:
    // it lets a client confirm which oracle the deal expects.
    oracle: deal.oracle,
    cid: deal.cid,
    amountLamports: deal.amountLamports.toString(),
    status: deal.status,
    challengeWindowSeconds: deal.challengeWindowSeconds,
    challengeWindowEndsAt: deal.challengeWindowEndsAt?.toISOString() ?? null,
    pinVerifiedAt: deal.pinVerifiedAt?.toISOString() ?? null,
    pinVerificationDetail: deal.pinVerificationDetail,
    settleTxSignature: deal.settleTxSignature,
    settleAttemptedAt: deal.settleAttemptedAt?.toISOString() ?? null,
    settleError: deal.settleError,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

/** Which HTTP status each refusal deserves. */
const DISPUTE_REJECTION_STATUS: Record<string, number> = {
  deal_not_found: 404,
  // 409 rather than 400: the request was well-formed, the deal's state was
  // wrong for it. That distinction matters to a client deciding between "fix
  // my request" and "you were too late".
  window_closed: 409,
  already_settled: 409,
  already_refunded: 409,
  already_disputed: 409,
  not_in_challenge_window: 409,
};

export function createApp(deps: ApiDeps): Express {
  const app = express();
  // A 1KB body limit: the largest thing a client sends is a reason string and a
  // base58 key. A generous limit here is only a DoS surface.
  app.use(express.json({ limit: "4kb" }));

  /** Wrap an async handler so a rejection becomes a scrubbed 500, not a hang. */
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        const message = safeErrorMessage(err, deps.registry);
        // Logged with a stack (redacted); returned without one.
        deps.logger.error("unhandled request error", {
          path: req.path,
          error: message,
        });
        res.status(500).json({ error: message });
      }
    };

  /**
   * Extract a bearer token from the `Authorization` header.
   *
   * Only the `Bearer <token>` scheme is accepted. A token in a query string or
   * a cookie is not supported: query strings land in access logs and proxies,
   * and a cookie brings CSRF into a flow that has no need of it.
   */
  const bearerToken = (req: Request): string | null => {
    const header = req.headers.authorization;
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
  };

  /**
   * Authentication middleware for mutating routes.
   *
   * Two outcomes:
   *
   *   1. `deps.auth` is present — a valid session token is required, and the
   *      verified wallet is attached as `req.authenticatedWallet`. This is the
   *      real path, and it is what runs in production.
   *   2. No `deps.auth` — `requireAuth` decides. False (development) allows the
   *      request through; true refuses, because a service that requires auth but
   *      has no way to authenticate anyone must not mutate.
   *
   * The failure response is a bare 401 with a stable shape. It deliberately does
   * not say *why* the token failed beyond a coarse category: "expired" versus
   * "bad signature" is useful to an operator's logs, not to an unauthenticated
   * caller.
   */
  const requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!deps.auth) {
      if (!deps.requireAuth) {
        // Development posture: no auth configured, mutating routes are open.
        // `loadConfig` refuses to reach this state in production.
        next();
        return;
      }
      res.status(401).json({
        error: "unauthorized",
        detail:
          "this service requires authentication but no auth service is configured",
      });
      return;
    }

    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({
        error: "unauthorized",
        detail: "missing bearer token; obtain one from POST /auth/verify",
      });
      return;
    }

    const result = deps.auth.verifySession(token);
    if (!result.valid) {
      deps.logger.warn("rejected session token", {
        path: req.path,
        // The precise reason goes to the log, where an operator can use it.
        reason: result.reason,
      });
      // ...and a coarse label goes to the caller. Distinguishing "expired" from
      // "bad signature" tells an unauthenticated caller which part of their
      // forgery attempt got closer, for no benefit to a legitimate client that
      // simply needs to sign in again.
      res.status(401).json({ error: "unauthorized", detail: "invalid session" });
      return;
    }

    req.authenticatedWallet = result.claims.sub;
    next();
  };

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      // Public key only — enough to verify the service is running with the
      // oracle you expect, and not a secret.
      oracle: deps.oracle.publicKey.toBase58(),
      oracleSource: deps.oracle.source,
    });
  });

  /**
   * Register a deal. Called when the depositor initializes it on-chain.
   *
   * The PDA is recomputed from the program's seeds rather than trusted from the
   * body, so a caller cannot register a deal PDA that does not correspond to
   * the depositor + dealId it claims. The client library's `findDealAddress`
   * does the derivation; that is the same function the UI and the Phase 2 tests
   * use, so the backend cannot drift from them.
   */
  app.post(
    "/deals",
    requireAuth,
    handle(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const required = [
        "dealId",
        "depositor",
        "provider",
        "cid",
        "amountLamports",
      ] as const;
      for (const field of required) {
        if (typeof body[field] !== "string" && field !== "amountLamports") {
          throw new HttpError(400, `missing or invalid field: ${field}`);
        }
      }
      if (typeof body.dealId !== "string" || body.dealId.length === 0) {
        throw new HttpError(400, "dealId must be a non-empty string");
      }
      if (typeof body.cid !== "string" || body.cid.length === 0) {
        throw new HttpError(400, "cid must be a non-empty string");
      }

      let amount: bigint;
      try {
        amount = BigInt(String(body.amountLamports));
      } catch {
        throw new HttpError(400, "amountLamports must be an integer");
      }
      if (amount <= 0n) throw new HttpError(400, "amountLamports must be positive");

      // Validate the keys before storing them: a malformed depositor would make
      // every later dispute authorisation check fail in a confusing way.
      const keys: Record<string, PublicKey> = {};
      for (const field of ["depositor", "provider", "oracle"] as const) {
        const value = body[field];
        if (value !== undefined) {
          try {
            keys[field] = new PublicKey(String(value));
          } catch {
            throw new HttpError(400, `${field} is not a valid public key`);
          }
        }
      }
      if (!keys.depositor) throw new HttpError(400, "depositor is required");
      if (!keys.provider) throw new HttpError(400, "provider is required");

      // The depositor is the account that signs `initialize` on-chain, so this
      // is the caller's own deal to register. When a session is required, the
      // registered depositor must be the authenticated wallet — otherwise a
      // caller could register a deal in someone else's name, which would later
      // let a *different* wallet's session own the dispute rights on it. In the
      // development posture (`req.authenticatedWallet` unset) the check is
      // skipped, exactly as the other routes skip auth there.
      if (
        req.authenticatedWallet !== undefined &&
        keys.depositor.toBase58() !== req.authenticatedWallet
      ) {
        throw new HttpError(
          403,
          "the authenticated wallet is not the depositor for this deal"
        );
      }

      // The oracle must be *this* service's key. A deal that names a foreign
      // oracle can never be settled by this backend, so accepting it would
      // create a row that sits in the window forever.
      const oracleKey = keys.oracle ?? deps.oracle.publicKey;
      if (!oracleKey.equals(deps.oracle.publicKey)) {
        throw new HttpError(
          400,
          `this backend is the oracle ${deps.oracle.publicKey.toBase58()}; ` +
            `deal was initialized with oracle ${oracleKey.toBase58()}`
        );
      }

      const [derivedPda] = findDealAddress(
        ESCROW_PROGRAM_ID,
        keys.depositor,
        body.dealId
      );
      const claimedPda = typeof body.dealPda === "string" ? body.dealPda : null;
      if (claimedPda && claimedPda !== derivedPda.toBase58()) {
        throw new HttpError(
          400,
          `dealPda ${claimedPda} does not match the derived PDA ${derivedPda.toBase58()}`
        );
      }

      const deal = await deps.deals.create({
        dealId: body.dealId,
        dealPda: derivedPda.toBase58(),
        depositor: keys.depositor.toBase58(),
        provider: keys.provider.toBase58(),
        oracle: oracleKey.toBase58(),
        cid: body.cid,
        amountLamports: amount,
        challengeWindowSeconds: deps.defaultChallengeWindowSeconds,
      });

      res.status(201).json({ deal: serializeDeal(deal) });
    })
  );

  /**
   * The provider asks to settle. Verifies the pin and opens a challenge window.
   *
   * Returns 202 on success — not 200 — because nothing has been settled. The
   * correct reading of a 202 here is "accepted for later processing", which is
   * exactly what happened.
   */
  app.post(
    "/deals/:id/settle",
    requireAuth,
    handle(async (req, res) => {
      const deal = await deps.deals.findByIdentifier(req.params.id);
      if (!deal) throw new HttpError(404, "deal not found");

      // The provider is the party that asks to settle. Requiring their session
      // means a third party cannot open a challenge window on a deal that is
      // not theirs — which, since opening a window is what eventually releases
      // the depositor's funds, would otherwise be a way to hurry along someone
      // else's settlement. Skipped in the development posture.
      if (
        req.authenticatedWallet !== undefined &&
        req.authenticatedWallet !== deal.provider
      ) {
        throw new HttpError(
          403,
          "only the provider may request settlement of this deal"
        );
      }

      const result = await deps.service.requestSettle(deal);
      const body = {
        outcome: result.outcome,
        deal: serializeDeal(result.deal),
        // Present only on the verification paths, and only ever the human-facing
        // detail string, never the Pinata JWT.
        verification: result.ok ? result.verification : undefined,
      };

      if (result.ok) {
        res.status(202).json(body);
        return;
      }
      switch (result.outcome) {
        case "not_pinned":
          res.status(422).json({ ...body, error: "pin not verified" });
          return;
        case "verification_error":
          // 503: we could not decide. Not the provider's fault, and retryable.
          res.status(503).json({
            ...body,
            error: result.error,
          });
          return;
        default:
          res.status(409).json(body);
      }
    })
  );

  /**
   * The depositor disputes a deal while its window is open.
   *
   * ## Authorisation (Phase 3.5)
   *
   * `raisedBy` is no longer a client-supplied claim. It is taken from
   * `req.authenticatedWallet`, which `requireAuth` populates from a session
   * token whose `sub` was set only after an Ed25519 signature over a one-time
   * challenge verified against that wallet's key. The route then requires that
   * wallet to equal the deal's on-chain `depositor`, and rejects with 403
   * otherwise.
   *
   * This closes the forgery gap Phase 3 documented: previously anyone could
   * name any depositor in the body. The `raisedBy` field is still accepted for
   * backward compatibility, but if present it must equal the authenticated
   * wallet — it is never *trusted*, only cross-checked, so a mismatch is a 403
   * rather than a silent override.
   */
  app.post(
    "/deals/:id/dispute",
    requireAuth,
    handle(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const rawReason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (rawReason.length === 0) {
        throw new HttpError(400, "reason is required");
      }
      if (rawReason.length > 2000) {
        // Bounded so a dispute row cannot be used as arbitrary storage.
        throw new HttpError(400, "reason must be at most 2000 characters");
      }
      // Redact on ingestion. A genuine dispute reason never contains a 64-byte
      // key, so this costs a legitimate depositor nothing — but it means the
      // service's own secrets cannot be persisted into `disputes.reason` via a
      // caller who has learned them, and therefore cannot be echoed back by the
      // GET endpoint or re-emitted into an operator's logs later.
      const reason = deps.registry.redact(rawReason);

      const deal = await deps.deals.findByIdentifier(req.params.id);
      if (!deal) throw new HttpError(404, "deal not found");

      // The identity the dispute is raised as. With auth configured this is the
      // cryptographically verified wallet; in the development posture it falls
      // back to the body so the demo and the existing tests still work.
      const authenticatedWallet = req.authenticatedWallet;
      const raisedBy = authenticatedWallet ?? readRaisedBy(body);

      if (authenticatedWallet !== undefined) {
        // A `raisedBy` that contradicts the session is a client bug or an
        // attempt to act as someone else; refuse rather than ignore the field.
        const claimed = typeof body.raisedBy === "string" ? body.raisedBy : null;
        if (claimed !== null && claimed !== authenticatedWallet) {
          throw new HttpError(
            403,
            "raisedBy does not match the authenticated wallet"
          );
        }
      } else if (raisedBy === null) {
        throw new HttpError(400, "raisedBy (depositor public key) is required");
      }

      if (raisedBy !== deal.depositor) {
        // 403, not 400: the request is understood and the caller is simply not
        // allowed to make it. This is the check that closes the forgery gap —
        // an authenticated wallet that is not the depositor is refused here even
        // though its session token is perfectly valid.
        throw new HttpError(403, "only the depositor may dispute this deal");
      }

      // The window/status checks live in the repository, inside the transaction
      // that writes the dispute — see `DisputeRepository.raise`. This route only
      // translates the refusal.
      const result = await deps.service.raiseDispute(deal.id, raisedBy, reason);
      if (!result.ok) {
        const status = DISPUTE_REJECTION_STATUS[result.code] ?? 409;
        res.status(status).json({
          error: disputeRejectionMessage(result.code),
          code: result.code,
        });
        return;
      }

      deps.logger.info("dispute raised", {
        dealPda: deal.dealPda,
        raisedBy,
      });
      res.status(201).json({
        dispute: {
          id: result.dispute.id,
          dealId: result.dispute.dealId,
          raisedBy: result.dispute.raisedBy,
          reason: result.dispute.reason,
          raisedAt: result.dispute.raisedAt.toISOString(),
          resolved: result.dispute.resolved,
        },
        deal: serializeDeal(result.deal),
      });
    })
  );

  app.get(
    "/deals/:id",
    handle(async (req, res) => {
      const deal = await deps.deals.findByIdentifier(req.params.id);
      if (!deal) throw new HttpError(404, "deal not found");
      const disputes = await deps.disputes.listForDeal(deal.id);
      res.json({
        deal: serializeDeal(deal),
        disputes: disputes.map((d) => ({
          id: d.id,
          raisedBy: d.raisedBy,
          reason: d.reason,
          raisedAt: d.raisedAt.toISOString(),
          resolved: d.resolved,
        })),
        // Derived, so a client does not have to reconstruct the state machine.
        canDispute:
          deal.status === "in_challenge_window" &&
          deal.challengeWindowEndsAt !== null &&
          deal.challengeWindowEndsAt.getTime() > Date.now(),
        challengeWindowOpen:
          deal.status === "in_challenge_window" &&
          deal.challengeWindowEndsAt !== null &&
          deal.challengeWindowEndsAt.getTime() > Date.now(),
      });
    })
  );

  /**
   * Run the challenge-window job once.
   *
   * Exposed as an endpoint as well as a timer because it is the only way to
   * drive the settle path deterministically in tests and in an operator's
   * "why hasn't this settled" investigation. In production this should be
   * authenticated or bound to a private interface.
   */
  app.post(
    "/jobs/challenge-window",
    requireAuth,
    handle(async (req, res) => {
      const summary = await deps.runJob();
      res.json(summary as object);
    })
  );

  /* ------------------------------------------------------------------ */
  /* Authentication (Phase 3.5)                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Step 1 of sign-in: ask for a challenge to sign.
   *
   * Unauthenticated by design — this is the bootstrap. It is safe because it
   * only creates a one-time message; it grants nothing. The response contains
   * the exact text to sign and the nonce to echo back.
   *
   * No session or token is returned here, and no identity is proven by calling
   * it, however many times.
   */
  app.post(
    "/auth/challenge",
    handle(async (req, res) => {
      if (!deps.auth) {
        // Sign-in is not configured. 501 rather than 401: the request is fine,
        // the feature is absent, which is a clearer answer to a client trying to
        // figure out why sign-in fails.
        throw new HttpError(501, "authentication is not configured on this service");
      }

      const body = req.body as Record<string, unknown>;
      const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
      if (wallet.length === 0) {
        throw new HttpError(400, "wallet is required");
      }

      const challenge = await deps.auth.issueChallenge(wallet);
      if (!challenge) {
        throw new HttpError(400, "wallet is not a valid Solana public key");
      }

      res.status(201).json({
        message: challenge.message,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    })
  );

  /**
   * Step 2 of sign-in: present the signature, receive a session token.
   *
   * Also unauthenticated — the signature *is* the credential. On success the
   * response carries a bearer token for the `Authorization` header of mutating
   * requests. On failure every reason collapses to 401 with a coarse label:
   * telling an unauthenticated caller whether a nonce exists is a probing
   * oracle, so the log gets the detail and the client does not.
   */
  app.post(
    "/auth/verify",
    handle(async (req, res) => {
      if (!deps.auth) {
        throw new HttpError(501, "authentication is not configured on this service");
      }

      const body = req.body as Record<string, unknown>;
      const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
      const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
      const signature =
        typeof body.signature === "string" ? body.signature.trim() : "";

      if (wallet.length === 0 || nonce.length === 0 || signature.length === 0) {
        throw new HttpError(400, "wallet, nonce and signature are required");
      }

      const result = await deps.auth.verify({
        walletBase58: wallet,
        nonce,
        signatureBase58: signature,
      });

      if (!result.ok) {
        deps.logger.warn("sign-in failed", { wallet, reason: result.reason });
        // 401 for everything: whether the challenge exists, is expired, or the
        // signature was wrong is not information an unauthenticated caller
        // should be able to enumerate.
        res.status(401).json({
          error: "authentication failed",
          reason: authFailureLabel(result.reason),
        });
        return;
      }

      res.status(200).json({
        token: result.token,
        tokenType: "Bearer",
        wallet: result.wallet,
        expiresAt: result.expiresAt.toISOString(),
      });
    })
  );

  return app;
}

/**
 * Read `raisedBy` from a request body as a fallback identity.
 *
 * Used only in the development posture, where no session is configured. Returns
 * `null` for a missing or malformed value so the caller can answer 400; it never
 * *validates* a wallet here, because the authoritative comparison is against
 * the deal's depositor a few lines later.
 */
function readRaisedBy(body: Record<string, unknown>): string | null {
  const raw = body.raisedBy;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return parsePublicKeySafe(raw.trim());
}

function parsePublicKeySafe(value: string): string | null {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

/**
 * Coarse client-facing label for a failed sign-in.
 *
 * Deliberately lossy. The specific reason is logged; the client is told enough
 * to fix a genuine mistake ("expired") without being able to use the endpoint to
 * discover which nonces exist.
 */
function authFailureLabel(reason: AuthFailureReason): string {
  switch (reason) {
    case "challenge_expired":
      return "challenge_expired";
    case "challenge_already_used":
      return "challenge_already_used";
    default:
      return "invalid_challenge_or_signature";
  }
}

/**
 * Human-readable text for each dispute refusal.
 *
 * Kept beside the status map so the two cannot drift, and phrased for a
 * depositor: "the challenge window has already closed" is an answer, "409" is
 * not.
 */
function disputeRejectionMessage(code: string): string {
  switch (code) {
    case "window_closed":
      return "the challenge window has already closed; settlement is no longer disputable";
    case "already_settled":
      return "the deal has already settled";
    case "already_refunded":
      return "the deal has already been refunded";
    case "already_disputed":
      return "a dispute is already open for this deal";
    case "not_in_challenge_window":
      return "the deal is not in a challenge window, so there is nothing to dispute";
    case "deal_not_found":
      return "deal not found";
    default:
      return "dispute refused";
  }
}
