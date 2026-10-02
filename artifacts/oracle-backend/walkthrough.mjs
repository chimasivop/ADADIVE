// Manual end-to-end walkthrough against the running bundled backend, with the
// browser wallet replaced by a raw ed25519 keypair (the same substitution the
// client library's `KeypairWallet` makes).
import { ed25519 } from "@noble/curves/ed25519";
import { randomBytes } from "node:crypto";

const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = b58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const BASE = "http://127.0.0.1:4100";
const secret = randomBytes(32);
const address = encodeBase58(ed25519.getPublicKey(secret));
console.log("wallet address:", address);

let res = await fetch(`${BASE}/auth/challenge`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: address }),
});
const challenge = await res.json();
console.log("challenge:", res.status, JSON.stringify(challenge).slice(0, 300));

const signature = encodeBase58(
  ed25519.sign(new TextEncoder().encode(challenge.message), secret)
);
console.log("signature chars:", signature.length);

res = await fetch(`${BASE}/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: address, nonce: challenge.nonce, signature }),
});
const verified = await res.json();
console.log("verify:", res.status, JSON.stringify(verified).slice(0, 300));
const token = verified.token ?? verified.sessionToken;

res = await fetch(`${BASE}/deals`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    dealId: "walkthrough-1",
    depositor: address,
    provider: encodeBase58(ed25519.getPublicKey(randomBytes(32))),
    amountLamports: "1000000000",
    cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    metadataHash: "00".repeat(32),
  }),
});
console.log("POST /deals:", res.status, (await res.text()).slice(0, 300));

res = await fetch(`${BASE}/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: address, nonce: challenge.nonce, signature }),
});
console.log("replay verify:", res.status, (await res.text()).slice(0, 200));
