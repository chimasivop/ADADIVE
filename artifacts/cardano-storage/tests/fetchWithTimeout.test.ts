/**
 * Unit tests for the sign-in timeout wrapper.
 *
 * The oracle's free host sleeps when idle, so a sign-in can hang for a minute on
 * first use. Without a bound the UI spins forever with no explanation. These
 * tests use a fake `fetch` that never resolves and a short timeout, so the
 * behaviour is checked without a real 90-second wait.
 */
import { assert } from "chai";

import {
  SERVER_TIMEOUT_MESSAGE,
  fetchWithTimeout,
  isTimeoutError,
} from "../src/lib/fetchWithTimeout";

/** A `fetch` that never settles until its abort signal fires. */
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      }
    })) as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("aborts a hanging request and reports the timeout message", async () => {
    const bounded = fetchWithTimeout(20, hangingFetch());
    try {
      await bounded("https://example.invalid/slow");
      assert.fail("expected the request to reject");
    } catch (err) {
      assert.instanceOf(err, Error);
      assert.equal((err as Error).message, SERVER_TIMEOUT_MESSAGE);
      assert.isTrue(isTimeoutError(err));
    }
  });

  it("passes through a fast response unchanged", async () => {
    const ok = new Response("{}", { status: 200 });
    const base = (async () => ok) as unknown as typeof fetch;
    const bounded = fetchWithTimeout(1000, base);
    const response = await bounded("https://example.invalid/fast");
    assert.equal(response.status, 200);
  });

  it("does not rewrite an unrelated transport failure as a timeout", async () => {
    const base = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const bounded = fetchWithTimeout(1000, base);
    try {
      await bounded("https://example.invalid/down");
      assert.fail("expected the request to reject");
    } catch (err) {
      assert.equal((err as Error).message, "fetch failed");
      assert.isFalse(isTimeoutError(err));
    }
  });

  it("forwards a caller-supplied abort signal", async () => {
    const controller = new AbortController();
    const bounded = fetchWithTimeout(10_000, hangingFetch());
    const pending = bounded("https://example.invalid/cancel", { signal: controller.signal });
    controller.abort();
    try {
      await pending;
      assert.fail("expected the request to reject");
    } catch (err) {
      // Aborted by the caller, not the timer, so it is not a timeout.
      assert.isFalse(isTimeoutError(err));
    }
  });
});

describe("isTimeoutError", () => {
  it("recognises the message embedded by the shared client", () => {
    // BackendApi wraps a transport failure in its own sentence.
    const wrapped = new Error(`could not reach the backend at /backend: ${SERVER_TIMEOUT_MESSAGE}`);
    assert.isTrue(isTimeoutError(wrapped));
  });

  it("is false for other errors", () => {
    assert.isFalse(isTimeoutError(new Error("sign-in failed: bad signature")));
    assert.isFalse(isTimeoutError(null));
  });
});
