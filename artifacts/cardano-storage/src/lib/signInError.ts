/**
 * The message the UI shows when sign-in fails.
 *
 * Extracted from `useBackendSession` so the mapping from a thrown error to
 * user-visible prose can be tested without rendering React. The one case that
 * matters is the timeout: the shared `BackendApi` wraps a transport failure in
 * its own "could not reach the backend at …" sentence, so the raw error is
 * checked for the timeout marker and replaced with the plain retry sentence.
 */

import { BackendError } from "@workspace/solana-escrow";
import { SERVER_TIMEOUT_MESSAGE, isTimeoutError } from "./fetchWithTimeout";

/** Never returns an empty string; a blank reason becomes a generic sentence. */
export function signInErrorMessage(err: unknown): string {
  if (isTimeoutError(err)) return SERVER_TIMEOUT_MESSAGE;
  if (err instanceof BackendError) return `sign-in failed: ${err.message}`;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.trim().length > 0 ? message : "sign-in failed. Please try again.";
}
