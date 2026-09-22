/**
 * Wallet-signature sign-in against the oracle backend.
 *
 * The conversation, and where each step happens:
 *
 *   1. `POST /auth/challenge {wallet}`      — the backend mints a one-time message
 *   2. `wallet.signMessage(messageBytes)`   — the wallet shows it and signs it
 *   3. `POST /auth/verify {…}`              — the backend verifies the signature
 *                                             over the *stored* message and
 *                                             returns a session token
 *   4. the token rides along as `Authorization: Bearer …` on mutations
 *
 * Two things this hook is careful about:
 *
 * **`signMessage`, not `signTransaction`.** The challenge is a plain text
 * message, not a transaction: there is nothing to submit and no fee to pay. The
 * backend wraps the 32-byte public key and verifies an Ed25519 signature over
 * the raw UTF-8 bytes, so a transaction signature would cover a different
 * message and fail verification.
 *
 * **The base58 encoding.** Wallets return the signature as raw bytes; the
 * backend's `/auth/verify` takes base58. The encoding happens here and nowhere
 * else, so there is one place to look when a signature "does not verify".
 *
 * The token is held in React state, never in `localStorage`: a session is a
 * bearer credential, and persisting it would survive a reload that should
 * re-prompt the wallet.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import {
  BackendApi,
  BackendError,
  encodeBase58,
  type MessageSigner,
  type SessionState,
} from "@workspace/solana-escrow";
import { BACKEND_ENDPOINT } from "@/lib/backend/endpoint";

export type SessionStatus = "signed_out" | "authenticating" | "authenticated" | "error";

export interface BackendSession {
  api: BackendApi;
  session: SessionState | null;
  status: SessionStatus;
  /** The backend's message when sign-in failed; distinct from a deal error. */
  error: string | null;
  /**
   * Sign in if there is no usable session, then return the token.
   *
   * Throws if the wallet refuses the signature or the backend rejects it, so a
   * call site can let the failure abort the mutation it was about to make rather
   * than sending an unauthenticated request.
   */
  ensureSession: () => Promise<string>;
  signOut: () => void;
}

/**
 * Bridge the wallet adapter to the narrow `MessageSigner` the client needs.
 *
 * Returns `null` when the connected wallet cannot sign messages. Phantom and
 * Solflare both can; the check exists so the UI can explain the gap instead of
 * throwing "signMessage is not a function" deep inside a click handler.
 */
export function useMessageSigner(): MessageSigner | null {
  const { publicKey, signMessage } = useWallet();

  return useMemo(() => {
    if (!publicKey || !signMessage) return null;
    return {
      publicKey,
      signMessage: (message: Uint8Array) => signMessage(message),
    };
  }, [publicKey, signMessage]);
}

export function useBackendSession(options: { api?: BackendApi } = {}): BackendSession {
  const api = useMemo(
    () => options.api ?? new BackendApi({ baseUrl: BACKEND_ENDPOINT }),
    [options.api]
  );
  const signer = useMessageSigner();

  const [session, setSession] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<SessionStatus>("signed_out");
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: `ensureSession` is called from event handlers and needs
  // the *current* session synchronously. Reading it from state would race the
  // render that follows a successful sign-in, and two rapid clicks would each
  // start their own sign-in.
  const sessionRef = useRef<SessionState | null>(null);
  const inFlight = useRef<Promise<string> | null>(null);

  const signIn = useCallback(async (): Promise<string> => {
    if (!signer) {
      throw new Error(
        "the connected wallet does not support message signing; reconnect with Phantom or Solflare"
      );
    }
    const wallet = signer.publicKey.toBase58();

    setStatus("authenticating");
    setError(null);
    try {
      const challenge = await api.requestChallenge(wallet);
      // Exactly what the wallet is asked to sign, and exactly what the backend
      // stored. `TextEncoder` is the browser's UTF-8 encoding of the message.
      const messageBytes = new TextEncoder().encode(challenge.message);
      const signatureBytes = await signer.signMessage(messageBytes);

      const verified = await api.verifySignature({
        wallet,
        nonce: challenge.nonce,
        signature: encodeBase58(signatureBytes),
      });

      const next: SessionState = {
        token: verified.token,
        wallet: verified.wallet,
        expiresAt: verified.expiresAt,
      };
      sessionRef.current = next;
      setSession(next);
      setStatus("authenticated");
      return next.token;
    } catch (err) {
      const message =
        err instanceof BackendError
          ? `sign-in failed: ${err.message}`
          : String((err as Error).message ?? err);
      setError(message);
      setStatus("error");
      throw err;
    }
  }, [api, signer]);

  const ensureSession = useCallback(async (): Promise<string> => {
    const current = sessionRef.current;
    if (api.sessionValid(current)) return current!.token;
    // Collapse concurrent callers onto one sign-in: the challenge is single-use,
    // so a second parallel attempt would consume its own nonce and both wallets
    // would prompt.
    if (!inFlight.current) {
      inFlight.current = signIn().finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, [api, signIn]);

  const signOut = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setStatus("signed_out");
    setError(null);
  }, []);

  return { api, session, status, error, ensureSession, signOut };
}
