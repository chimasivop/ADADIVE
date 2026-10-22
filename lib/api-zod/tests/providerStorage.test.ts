/**
 * Tests for the provider-storage validators added by the provider-run storage
 * layer: the `peerId` field and the three schemas that use it.
 *
 * `peerId` is the gate every new provider endpoint runs through, so its rules
 * are worth pinning down: a libp2p peer id is base58, and the two shapes in the
 * wild are the 46-character `Qm…` (sha2-256 multihash) and the longer
 * `12D3Koo…` inline-key form. The positive cases are hand-built from the real
 * alphabet because generating a peer id would need a libp2p keygen the API
 * layer has no reason to depend on.
 */
import { assert } from "chai";

import { peerId, schemas } from "../src/validation";

const QM_PEER = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const ED25519_PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";

describe("peerId", () => {
  it("accepts a Qm… (sha2-256) peer id", () => {
    assert.equal(peerId.parse(QM_PEER), QM_PEER);
  });

  it("accepts a 12D3Koo… (ed25519 inline key) peer id", () => {
    assert.equal(peerId.parse(ED25519_PEER), ED25519_PEER);
  });

  it("trims surrounding whitespace", () => {
    assert.equal(peerId.parse(`  ${QM_PEER}  `), QM_PEER);
  });

  it("rejects a peer id containing characters outside the base58 alphabet", () => {
    // 0, O, I and l are excluded from base58, so their presence is a typo, not
    // a peer id.
    assert.throws(() => peerId.parse("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79oj0nPbdG"));
  });

  it("rejects an empty or too-short value", () => {
    assert.throws(() => peerId.parse(""));
    assert.throws(() => peerId.parse("12D3Koo"));
  });

  it("rejects a value that is too long to be a peer id", () => {
    assert.throws(() => peerId.parse("1".repeat(129)));
  });
});

describe("createProvider schema", () => {
  const base = {
    name: "Provider One",
    nodeId: "pool1abc",
    totalStorageGb: 100,
    pricePerGbPerEpoch: 0.001,
    region: "us-east",
  };

  it("accepts a body with no peerId (the Pinata path)", () => {
    const parsed = schemas.createProvider.parse({ body: base });
    assert.isUndefined(parsed.body.peerId);
  });

  it("accepts a null peerId", () => {
    const parsed = schemas.createProvider.parse({ body: { ...base, peerId: null } });
    assert.isNull(parsed.body.peerId);
  });

  it("accepts a valid peerId", () => {
    const parsed = schemas.createProvider.parse({ body: { ...base, peerId: ED25519_PEER } });
    assert.equal(parsed.body.peerId, ED25519_PEER);
  });

  it("rejects a malformed peerId", () => {
    assert.throws(() =>
      schemas.createProvider.parse({ body: { ...base, peerId: "not a peer id" } })
    );
  });
});

describe("updateProviderNode schema", () => {
  it("accepts null, the explicit way to clear the node", () => {
    const parsed = schemas.updateProviderNode.parse({
      params: { id: "7" },
      body: { peerId: null },
    });
    assert.isNull(parsed.body.peerId);
  });

  it("coerces the numeric id from a path string", () => {
    const parsed = schemas.updateProviderNode.parse({
      params: { id: "7" },
      body: { peerId: ED25519_PEER },
    });
    assert.equal(parsed.params.id, 7);
  });

  it("rejects a body that omits peerId", () => {
    // Clearing the node must be an explicit `null`, never the meaning of an
    // empty body.
    assert.throws(() =>
      schemas.updateProviderNode.parse({ params: { id: "7" }, body: {} })
    );
  });
});

describe("providerHeartbeat and providerConfirmPin schemas", () => {
  it("requires a peerId on heartbeat", () => {
    assert.throws(() => schemas.providerHeartbeat.parse({ body: {} }));
    const parsed = schemas.providerHeartbeat.parse({ body: { peerId: ED25519_PEER } });
    assert.equal(parsed.body.peerId, ED25519_PEER);
  });

  it("requires an assignmentId, a valid cid and a peerId on confirm-pin", () => {
    const cid = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
    const parsed = schemas.providerConfirmPin.parse({
      body: { assignmentId: 12, cid, peerId: ED25519_PEER },
    });
    assert.equal(parsed.body.cid, cid);
    assert.equal(parsed.body.assignmentId, 12);

    // The assignment id is the unambiguous target; a body that omits it must not
    // be accepted (a CID alone can name more than one deal).
    assert.throws(() =>
      schemas.providerConfirmPin.parse({ body: { cid, peerId: ED25519_PEER } })
    );
    assert.throws(() =>
      schemas.providerConfirmPin.parse({ body: { assignmentId: 0, cid, peerId: ED25519_PEER } })
    );
    assert.throws(() =>
      schemas.providerConfirmPin.parse({ body: { assignmentId: 12, peerId: ED25519_PEER } })
    );
    assert.throws(() =>
      schemas.providerConfirmPin.parse({
        body: { assignmentId: 12, cid, peerId: "bad peer!" },
      })
    );
  });
});
