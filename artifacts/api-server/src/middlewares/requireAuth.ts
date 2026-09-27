/**
 * Authentication for mutating API routes.
 *
 * There are two independent ways to be authenticated, and a route gated by this
 * middleware accepts either:
 *
 *   - a **wallet-signed session** — a bearer token minted by the oracle backend
 *     after a Solana wallet signed a challenge. This is what the browser app
 *     actually produces.
 *   - an **OIDC session** — the `sid` cookie from the authorization-code flow,
 *     set by `req.user` via the global `authMiddleware`. Retained because it
 *     still gates the Replit-era surfaces the frontend does not use.
 *
 * ## Why `sub` is recorded separately from `req.user`
 *
 * A wallet session identifies an address, not a `User` row, and forcing one into
 * the other would mean inventing a user from a wallet. So the wallet identity
 * goes on `req.walletAddress`, and `req.user` stays exactly what the OIDC path
 * always made it. A handler that needs "who is this" checks `walletAddress`
 * first — that is the caller the app can actually produce.
 */

import { type Request, type Response, type NextFunction } from "express";

import { getBearerToken, verifyWalletSession } from "../lib/walletAuth";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      /** The wallet address a valid wallet-signed session proved, when present. */
      walletAddress?: string;
    }
  }
}

/**
 * Require either a wallet-signed session or an OIDC session.
 *
 * On success `req.walletAddress` and/or `req.user` is populated and the request
 * proceeds. On failure the response is a 401 naming the credential it wanted,
 * because a client that sent *an* `Authorization` header and was refused needs
 * to know it was the token, not the absence of one.
 */
export function requireWalletOrOidcAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = getBearerToken(req as unknown as { headers: Record<string, unknown> });

  if (token) {
    const result = verifyWalletSession(token);
    if (result.valid) {
      req.walletAddress = result.claims.sub;
      next();
      return;
    }

    // A bearer token was presented and rejected. Fall through to the OIDC check
    // only if there is also a session — otherwise say the token was the problem,
    // which is the difference between "sign in" and "your session expired".
    if (!req.isAuthenticated()) {
      logger.warn({ reason: result.reason }, "wallet session rejected");
      res.status(401).json({
        error: "Authentication required",
        detail:
          "provide a wallet-signed session from the oracle backend " +
          "(POST /auth/challenge then /auth/verify) as `Authorization: Bearer …`",
      });
      return;
    }
  }

  if (req.isAuthenticated()) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}
