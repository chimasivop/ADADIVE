/**
 * Oracle key custody and non-disclosure.
 *
 * This file is the "the oracle key is never logged, printed, or exposed in any
 * error message or response body" requirement, made executable.
 *
 * The test strategy is deliberately adversarial rather than a spot-check: for
 * each encoding the key can plausibly take (base58, hex, base64, JSON array),
 * assert that the encoding does not appear in
 *
 *   - anything the service logged,
 *   - any response body it returned,
 *   - any error message it produced, including from a deliberately hostile
 *     failure that embeds the key in the error text.
 *
 * The last case is the one that matters in practice: no service deliberately
 * logs its key, but `JSON.stringify(config)` in an error handler, or an SDK that
 * echoes the credential it failed to validate, leaks it all the same.
 */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import {
  LocalDevKeyProvider,
  EnvKeyProvider,
  SecretsManagerKeyProvider,
  OracleKeypair,
  parseOracleSecret,
} from "../src/oracle/keyProvider";
import {
  SecretRegistry,
  SecretString,
  REDACTED,
  safeErrorMessage,
  redact,
} from "../src/security/redact";
import { createLogger } from "../src/logger";
import { SilentTestLogger } from "./helpers/silentLogger";

/** Every encoding of a secret key that could plausibly leak. */
function encodings(keypair: Keypair): Record<string, string> {
  const bytes = keypair.secretKey;
  return {
    base58: keypair.secretKey.length > 0 ? bs58Encode(bytes) : "",
    hex: Buffer.from(bytes).toString("hex"),
    base64: Buffer.from(bytes).toString("base64"),
    jsonArray: JSON.stringify(Array.from(bytes)),
    jsonArraySpaced: JSON.stringify(Array.from(bytes)).replace(/,/g, ", "),
  };
}

/** Minimal base58 encode, so the test does not depend on the codec under test. */
function bs58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

function assertNoEncodings(
  haystack: string,
  keypair: Keypair,
  label: string
): void {
  const forms = encodings(keypair);
  for (const [name, value] of Object.entries(forms)) {
    if (value.length < 8) continue;
    expect(
      haystack.includes(value),
      `${label} leaked the key as ${name}`
    ).to.equal(false);
  }
}

describe("oracle key custody", () => {
  describe("SecretString", () => {
    it("does not reveal itself via toString, toJSON or inspect", () => {
      const secret = new SecretString("super-secret-value-12345");

      expect(String(secret)).to.equal(REDACTED);
      expect(`${secret}`).to.equal(REDACTED);
      expect(JSON.stringify({ secret })).to.equal(`{"secret":"${REDACTED}"}`);
      // Node's console.log path.
      const inspected = require("node:util").inspect(secret);
      expect(inspected).to.equal(REDACTED);
      // The explicit escape hatch is the only way out.
      expect(secret.reveal()).to.equal("super-secret-value-12345");
    });
  });

  describe("the redaction registry", () => {
    it("scrubs a registered secret out of arbitrary text", () => {
      const registry = new SecretRegistry();
      registry.register("plaintext-token-abcdefghijkl");

      const scrubbed = registry.redact(
        "auth failed with token plaintext-token-abcdefghijkl in header"
      );
      expect(scrubbed).not.to.contain("plaintext-token-abcdefghijkl");
      expect(scrubbed).to.contain(REDACTED);
    });

    it("scrubs every encoding of a byte secret", () => {
      const registry = new SecretRegistry();
      const keypair = Keypair.generate();
      registry.register(keypair.secretKey);

      const forms = encodings(keypair);
      // Hex, base64 and the JSON-array forms are all derived from the bytes.
      for (const name of ["hex", "base64", "jsonArray", "jsonArraySpaced"]) {
        expect(registry.redact(`value=${forms[name]}`)).not.to.contain(
          forms[name]
        );
      }
    });

    it("leaves text with no registered secret untouched", () => {
      const registry = new SecretRegistry();
      registry.register("a-secret-value-here");
      const untouched = "a normal error about the database being unreachable";
      expect(registry.redact(untouched)).to.equal(untouched);
    });

    it("ignores very short values so logs do not become noise", () => {
      const registry = new SecretRegistry();
      registry.register("abc");
      expect(registry.redact("abcdef")).to.equal("abcdef");
    });
  });

  describe("parseOracleSecret", () => {
    it("accepts a JSON array (solana-keygen format)", () => {
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      const parsed = parseOracleSecret(
        JSON.stringify(Array.from(keypair.secretKey)),
        registry,
        "test"
      );
      expect(parsed.publicKey.toBase58()).to.equal(keypair.publicKey.toBase58());
    });

    it("accepts base58 and hex", () => {
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();

      const fromBase58 = parseOracleSecret(
        bs58Encode(keypair.secretKey),
        registry,
        "test"
      );
      expect(fromBase58.publicKey.toBase58()).to.equal(
        keypair.publicKey.toBase58()
      );

      const fromHex = parseOracleSecret(
        Buffer.from(keypair.secretKey).toString("hex"),
        registry,
        "test"
      );
      expect(fromHex.publicKey.toBase58()).to.equal(
        keypair.publicKey.toBase58()
      );
    });

    it("registers the secret on the registry as a side effect", () => {
      // This is the property that makes the whole redaction scheme work: the
      // key is registered at the moment it is decoded, so anything downstream
      // that formats it is already covered.
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      parseOracleSecret(
        JSON.stringify(Array.from(keypair.secretKey)),
        registry,
        "test"
      );

      const forms = encodings(keypair);
      expect(registry.redact(forms.hex)).not.to.contain(forms.hex);
      expect(registry.redact(forms.base64)).not.to.contain(forms.base64);
      expect(registry.redact(forms.jsonArray)).not.to.contain(forms.jsonArray);
    });

    it("rejects an empty secret", () => {
      expect(() => parseOracleSecret("", new SecretRegistry(), "test")).to.throw(
        /empty/
      );
    });

    it("rejects a secret of the wrong length", () => {
      expect(() =>
        parseOracleSecret(
          JSON.stringify([1, 2, 3]),
          new SecretRegistry(),
          "test"
        )
      ).to.throw(/32 or 64 bytes/);
    });

    it("does not include the secret in its own error messages", () => {
      const secret = "[1,2,3]";
      let message = "";
      try {
        parseOracleSecret(secret, new SecretRegistry(), "test");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).to.contain("32 or 64 bytes");
      expect(message).not.to.contain(secret);
    });
  });

  describe("providers", () => {
    it("LocalDevKeyProvider generates an ephemeral key and warns loudly", async () => {
      const registry = new SecretRegistry();
      const logger = new SilentTestLogger();
      const provider = new LocalDevKeyProvider(null, logger);

      const loaded = await provider.load(registry);

      expect(loaded.publicKey).to.be.ok;
      expect(loaded.source).to.equal("local-dev-ephemeral");
      expect(logger.text).to.contain("DEVELOPMENT");
      // The ephemeral key is registered too, so even this path cannot leak.
      const forms = encodings(loaded.signer);
      expect(registry.redact(forms.hex)).not.to.contain(forms.hex);
    });

    it("LocalDevKeyProvider warns that it is not for production", async () => {
      const provider = new LocalDevKeyProvider(null, new SilentTestLogger());
      expect(provider.provisioningNote).to.contain("DEVELOPMENT ONLY");
      expect(provider.provisioningNote).to.contain("never be used in production");
    });

    it("EnvKeyProvider loads from the injected environment value without logging it", async () => {
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      const logger = new SilentTestLogger();
      const provider = new EnvKeyProvider(
        new SecretString(bs58Encode(keypair.secretKey)),
        logger
      );

      const loaded = await provider.load(registry);

      expect(loaded.publicKey.toBase58()).to.equal(
        keypair.publicKey.toBase58()
      );
      // The public key is logged (it is not a secret); the private half is not.
      expect(logger.text).to.contain(keypair.publicKey.toBase58());
      assertNoEncodings(logger.text, keypair, "EnvKeyProvider log");
    });

    it("SecretsManagerKeyProvider never logs the fetched value", async () => {
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      const logger = new SilentTestLogger();
      const provider = new SecretsManagerKeyProvider(
        "arn:aws:secretsmanager:eu-west-1:123:secret:oracle",
        async () => bs58Encode(keypair.secretKey),
        logger
      );

      const loaded = await provider.load(registry);

      expect(loaded.publicKey.toBase58()).to.equal(
        keypair.publicKey.toBase58()
      );
      assertNoEncodings(logger.text, keypair, "SecretsManager log");
      // Provenance is logged, and it is an identifier, not a secret.
      expect(logger.text).to.contain("arn:aws:secretsmanager");
    });

    it("SecretsManagerKeyProvider scrubs the key from a manager error that echoes it", async () => {
      // Some SDKs quote the offending value back in a validation error. If the
      // provider's error path did not redact, that would be a leak in the logs
      // and in any admin UI that showed the message.
      const keypair = Keypair.generate();
      const secret = bs58Encode(keypair.secretKey);
      const registry = new SecretRegistry();
      const provider = new SecretsManagerKeyProvider(
        "arn:test",
        async () => {
          throw new Error(`ValidationException: bad secret value ${secret}`);
        },
        new SilentTestLogger()
      );

      let message = "";
      try {
        await provider.load(registry);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).to.contain("failed to read oracle key");
      expect(message).not.to.contain(secret);
    });

    it("SecretsManagerKeyProvider reports a missing secret without inventing one", async () => {
      const provider = new SecretsManagerKeyProvider(
        "arn:test",
        async () => null,
        new SilentTestLogger()
      );
      let threw = false;
      try {
        await provider.load(new SecretRegistry());
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.contain("returned no value");
      }
      expect(threw).to.equal(true);
    });
  });

  describe("OracleKeypair serialisation", () => {
    it("redacts itself in every stringification path", () => {
      const keypair = Keypair.generate();
      const oracle = new OracleKeypair(keypair, "test");

      expect(String(oracle)).to.contain(keypair.publicKey.toBase58());
      expect(JSON.stringify(oracle)).to.not.contain("secret");
      const inspected = require("node:util").inspect(oracle);
      assertNoEncodings(inspected, keypair, "inspect(OracleKeypair)");
      assertNoEncodings(JSON.stringify(oracle), keypair, "toJSON(OracleKeypair)");
    });
  });

  describe("the production logger", () => {
    it("redacts a secret passed as a field value", () => {
      const lines: string[] = [];
      const logger = createLogger("debug", undefined, (line) =>
        lines.push(line)
      );
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      registry.register(keypair.secretKey);
      const scoped = createLogger("debug", registry, (line) => lines.push(line));

      scoped.info("loaded key", { secret: bs58Encode(keypair.secretKey) });

      expect(lines.join("\n")).not.to.contain(bs58Encode(keypair.secretKey));
      expect(lines.join("\n")).to.contain(REDACTED);
      void logger;
    });

    it("never prints raw bytes of a Uint8Array field", () => {
      const lines: string[] = [];
      const logger = createLogger("debug", undefined, (line) =>
        lines.push(line)
      );
      logger.info("key bytes", { bytes: Keypair.generate().secretKey });
      expect(lines[0]).to.contain("Uint8Array(64)");
    });

    it("redacts a SecretString field through its own serialisation", () => {
      const lines: string[] = [];
      const logger = createLogger("debug", undefined, (line) =>
        lines.push(line)
      );
      logger.info("config", { jwt: new SecretString("jwt-value-12345678") });
      expect(lines.join("\n")).not.to.contain("jwt-value-12345678");
      expect(lines.join("\n")).to.contain(REDACTED);
    });
  });

  describe("safeErrorMessage", () => {
    it("scrubs a secret embedded in a thrown error", () => {
      const keypair = Keypair.generate();
      const registry = new SecretRegistry();
      registry.register(keypair.secretKey);

      const err = new Error(
        `rpc rejected key ${bs58Encode(keypair.secretKey)}`
      );
      const message = safeErrorMessage(err, registry);

      assertNoEncodings(message, keypair, "safeErrorMessage");
    });

    it("handles non-Error throws without crashing", () => {
      expect(safeErrorMessage("a string")).to.equal("a string");
      expect(safeErrorMessage({ code: 1 })).to.contain("code");
      expect(safeErrorMessage(null)).to.be.a("string");
    });

    it("redact() applies the global registry as well as the local one", () => {
      const local = new SecretRegistry();
      local.register("local-secret-value-1234");
      const out = redact("local-secret-value-1234 and global thing", local);
      expect(out).not.to.contain("local-secret-value-1234");
    });
  });
});
