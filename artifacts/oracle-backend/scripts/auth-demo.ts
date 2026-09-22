/**
 * Manual walkthrough of the wallet sign-in flow.
 *
 * Phase 3.5 requires wallet-signature auth but explicitly does not require a
 * frontend for it. This script is the substitute the brief allows: it performs
 * the exact HTTP conversation a wallet adapter would perform, prints each step,
 * and demonstrates that a request without a session is refused. Run it against a
 * locally-started service:
 *
 *   npm run dev                     # or: npm start, after npm run build
 *   npm run auth:demo               # in another shell
 *
 * It generates a throwaway keypair, so it needs no fixture and touches no real
 * funds. The output is deliberately readable: the point of this phase is that
 * the *server* proves the caller holds the key, and the fastest way to believe
 * that is to watch a signature be produced and accepted.
 *
 * The equivalent `curl` conversation, for reference:
 *
 *   # 1. ask for a challenge
 *   curl -s localhost:4000/auth/challenge \
 *     -H 'content-type: application/json' \
 *     -d '{"wallet":"<BASE58_PUBKEY>"}'
 *
 *   # 2. sign the returned `message` with the wallet, then present it
 *   curl -s localhost:4000/auth/verify \
 *     -H 'content-type: application/json' \
 *     -d '{"wallet":"<BASE58_PUBKEY>","nonce":"<NONCE>","signature":"<BASE58_SIG>"}'
 *
 *   # 3. use the returned token
 *   curl -s localhost:4000/deals \
 *     -H 'content-type: application/json' \
 *     -H 'authorization: Bearer <TOKEN>' \
 *     -d '{"dealId":"demo","depositor":"<BASE58_PUBKEY>","provider":"<OTHER>","cid":"<CID>","amountLamports":"1000000000"}'
 *
 * Signing step 2 by hand is the awkward part, which is why this script exists:
 * `ed25519.sign(message, seed)` over the UTF-8 bytes of the message, base58
 * encoded. That is exactly what a wallet's `signMessage` does.
 */

import { Keypair } from "@solana/web3.js";

import { ed25519 } from "@noble/curves/ed25519";
import { encodeBase58 } from "../src/security/base58";

const BASE_URL = process.env.ORACLE_BASE_URL ?? "http://127.0.0.1:4000";

async function postJson(
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* leave null */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`\nSign-in demo against ${BASE_URL}\n`);

  const wallet = Keypair.generate();
  const publicKey = wallet.publicKey.toBase58();
  console.log(`1. Generated a throwaway wallet: ${publicKey}\n`);

  // A mutating request with no session must be refused. This is the behaviour
  // the whole phase exists to provide, so it is shown first.
  const refused = await postJson("/deals", {
    dealId: "nope",
    depositor: publicKey,
    provider: publicKey,
    cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
    amountLamports: "1000000000",
  });
  console.log(`2. POST /deals with no token -> ${refused.status} ${JSON.stringify(refused.json)}\n`);

  const challenge = await postJson("/auth/challenge", { wallet: publicKey });
  if (challenge.status !== 201) {
    console.error(
      `Could not obtain a challenge (${challenge.status}): ${JSON.stringify(challenge.json)}`
    );
    process.exit(1);
  }
  console.log(`3. POST /auth/challenge -> ${challenge.status}`);
  console.log(`   Message to sign:\n`);
  for (const line of String(challenge.json.message).split("\n")) {
    console.log(`     | ${line}`);
  }
  console.log();

  const signature = encodeBase58(
    ed25519.sign(
      Buffer.from(String(challenge.json.message), "utf8"),
      wallet.secretKey.slice(0, 32)
    )
  );
  console.log(`4. Signed it with the wallet's private key.`);
  console.log(`   Signature: ${signature.slice(0, 24)}...\n`);

  const verified = await postJson("/auth/verify", {
    wallet: publicKey,
    nonce: challenge.json.nonce,
    signature,
  });
  if (verified.status !== 200) {
    console.error(
      `Verification failed (${verified.status}): ${JSON.stringify(verified.json)}`
    );
    process.exit(1);
  }
  console.log(`5. POST /auth/verify -> ${verified.status}`);
  console.log(`   Token: ${String(verified.json.token).slice(0, 32)}...`);
  console.log(`   Expires: ${verified.json.expiresAt}\n`);

  // Replaying the same challenge must fail: that signature is spent.
  const replay = await postJson("/auth/verify", {
    wallet: publicKey,
    nonce: challenge.json.nonce,
    signature,
  });
  console.log(
    `6. Replaying the same signature -> ${replay.status} (${replay.json?.reason})\n`
  );

  const authed = await postJson(
    "/deals",
    {
      dealId: "auth-demo",
      depositor: publicKey,
      provider: Keypair.generate().publicKey.toBase58(),
      cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
      amountLamports: "1000000000",
    },
    verified.json.token
  );
  console.log(`7. POST /deals with the token -> ${authed.status}`);
  console.log(`   Deal status: ${authed.json?.deal?.status}\n`);

  if (authed.status !== 201 || authed.json?.deal?.status !== "pending_verification") {
    console.error(`Unexpected result: ${JSON.stringify(authed.json)}`);
    process.exit(1);
  }

  console.log("Flow completed: the service verified a real wallet signature.\n");
}

main().catch((err) => {
  console.error(`\nDemo failed: ${err instanceof Error ? err.message : err}\n`);
  console.error("Is the service running?  npm run dev\n");
  process.exit(1);
});
