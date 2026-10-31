/**
 * A fetch wrapper that aborts after a timeout, plus the message the UI shows.
 *
 * The oracle backend runs on a free host that sleeps when idle; the first
 * sign-in after a nap can take up to a minute to wake it. Without a timeout the
 * `fetch` hangs and the UI spins forever with no explanation. This wrapper
 * bounds the wait with a real `AbortController` — the request is genuinely
 * aborted, not merely raced — and turns the abort into one plain sentence.
 *
 * It is deliberately a wrapper around `fetch` rather than a change to the shared
 * `BackendApi`: the client keeps its transport, this only decorates it, so no
 * API or backend behaviour moves.
 *
 * Kept free of React and of the shared library so it can be unit-tested directly.
 */

/** How long a sign-in request may take before it is aborted. */
export const SIGN_IN_TIMEOUT_MS = 90_000;

/** How long before the "waking the server" notice appears. */
export const WAKING_NOTICE_MS = 5_000;

/** Shown when a sign-in request is aborted by the timeout. */
export const SERVER_TIMEOUT_MESSAGE = "The server did not respond, please try again.";

/** Shown while the first sign-in waits on a cold backend. */
export const WAKING_MESSAGE =
  "Waking the server, this can take up to a minute on first use…";

/**
 * Wrap `fetch` so a request is aborted after `timeoutMs`.
 *
 * On timeout the returned promise rejects with an `Error` whose message is
 * exactly `SERVER_TIMEOUT_MESSAGE`, so the cause is identifiable after the
 * shared client has wrapped it (see `isTimeoutError`). An abort signal supplied
 * by the caller is forwarded, so this composes with any future cancellation.
 */
export function fetchWithTimeout(
  timeoutMs: number,
  base: typeof fetch = globalThis.fetch.bind(globalThis)
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const upstream = init?.signal ?? null;
    const onUpstreamAbort = () => controller.abort();
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener("abort", onUpstreamAbort, { once: true });
    }

    try {
      return await base(input, { ...init, signal: controller.signal });
    } catch (err) {
      // A browser may reject an aborted fetch with a generic `AbortError`; the
      // timeout flag is what makes the cause certain rather than guessed.
      if (timedOut) throw new Error(SERVER_TIMEOUT_MESSAGE);
      throw err;
    } finally {
      clearTimeout(timer);
      if (upstream) upstream.removeEventListener("abort", onUpstreamAbort);
    }
  }) as typeof fetch;
}

/**
 * True when an error came from the timeout.
 *
 * The shared `BackendApi` rewrites a transport failure into its own message
 * ("could not reach the backend at …: …"), so the check is on the embedded
 * sentence rather than on the error type.
 */
export function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.includes(SERVER_TIMEOUT_MESSAGE);
}
