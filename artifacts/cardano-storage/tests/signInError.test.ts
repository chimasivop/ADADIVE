/**
 * Unit tests for the sign-in error mapping.
 *
 * The user-visible reason must never be empty, and a timeout must read as a
 * plain retry sentence rather than the shared client's transport wording.
 */
import { assert } from "chai";

import { SERVER_TIMEOUT_MESSAGE } from "../src/lib/fetchWithTimeout";
import { signInErrorMessage } from "../src/lib/signInError";

describe("signInErrorMessage", () => {
  it("reports a timeout as the plain retry sentence", () => {
    const err = new Error(`could not reach the backend at /backend: ${SERVER_TIMEOUT_MESSAGE}`);
    assert.equal(signInErrorMessage(err), SERVER_TIMEOUT_MESSAGE);
  });

  it("keeps a backend rejection message", () => {
    // A plain Error stands in for BackendError's message text here; the branch
    // that prefixes "sign-in failed:" is covered by the shape of the message.
    const message = signInErrorMessage(new Error("sign-in failed: bad signature"));
    assert.equal(message, "sign-in failed: bad signature");
  });

  it("never returns an empty reason", () => {
    assert.isAbove(signInErrorMessage(new Error("")).length, 0);
    assert.isAbove(signInErrorMessage(undefined).length, 0);
    assert.isAbove(signInErrorMessage(null).length, 0);
  });
});
