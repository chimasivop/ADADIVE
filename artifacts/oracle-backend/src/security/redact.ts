/**
 * Secret handling helpers.
 *
 * The oracle keypair is the one piece of genuinely sensitive material this
 * service holds, and the failure mode that matters is not "an attacker read the
 * database" — it is "a key leaked into a log line, an HTTP response body, or a
 * stack trace". Those are cheap to prevent and expensive to discover, so the
 * protection is centralised here rather than left to each call site's
 * discipline.
 *
 * Two mechanisms, used together:
 *
 *   - `SecretString` — a wrapper whose string/JSON/inspect forms are always
 *     `[redacted]`. Anything holding key material holds it in one of these, so
 *     an accidental `console.log` or template literal cannot print it.
 *   - `SecretRegistry` — the last line of defence for *derived* values (a
 *     base58 encoding, a hex dump, a JSON array of bytes, a message that
 *     embedded the key). Registered values are scrubbed out of any text passing
 *     through `redact()`, which is what every error path routes through.
 *
 * The base58 case is the one that actually bites: a Solana key's *wallet import
 * format* is base58, and a surprising number of failures quote it back
 * (`Invalid signature: <key>`, `Account <key> not found`). Encoding it here, in
 * the registry, is what closes that hole — see `tests/oracleKeySecurity.test.ts`.
 */

import { encodeBase58, decodeBase58 } from "./base58";

export const REDACTED = "[redacted]";

/**
 * A string whose value does not survive being stringified.
 *
 * `reveal()` is the single, greppable escape hatch. If you need the plaintext,
 * you have to say so explicitly, which makes accidental disclosure a reviewable
 * act rather than a default.
 */
export class SecretString {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The only way to get the plaintext out. */
  reveal(): string {
    return this.#value;
  }

  get length(): number {
    // Length alone is not sensitive and is genuinely useful when debugging
    // "why does this secret fail to parse".
    return this.#value.length;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  /** Node's util.inspect hook, so `console.log(secretString)` is also safe. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * Known secret substrings, scrubbed from outbound text.
 *
 * Deliberately an allow-list of known values rather than a blanket
 * "looks like base58" regex: over-redaction silently destroys error messages
 * that operators need, and under-redaction only happens for values nobody
 * registered. Registration happens exactly where a secret is first decoded.
 */
export class SecretRegistry {
  readonly #values: string[] = [];

  /**
   * Register a secret and the encodings it is likely to appear in.
   *
   * A 64-byte Solana secret key shows up in practice as base58 (wallet import
   * format), as a JSON array (the `solana-keygen` file format), as hex, and as
   * base64. Every one of them is derived and registered here, because a caller
   * holding only the decoded bytes cannot be expected to know which form an
   * upstream error message will quote back.
   *
   * Note that a *public* key also reaches this method, via the string overload,
   * when callers choose to register one. That is harmless — a public key is not
   * sensitive — and it keeps the call sites uniform.
   */
  register(secret: Uint8Array | string): void {
    if (typeof secret === "string") {
      this.#add(secret);
      return;
    }
    const bytes = Uint8Array.from(secret);
    this.#add(encodeBase58(bytes));
    this.#add(Buffer.from(bytes).toString("base64"));
    this.#add(Buffer.from(bytes).toString("hex"));
    const arr = JSON.stringify(Array.from(bytes));
    this.#add(arr);
    this.#add(arr.replace(/,/g, ", "));
  }

  /** Replace every registered secret in `text`. */
  redact(text: string): string {
    let out = text;
    for (const value of this.#values) {
      if (value.length === 0) continue;
      out = out.split(value).join(REDACTED);
    }
    return out;
  }

  #add(value: string): void {
    // Very short values would match everywhere and turn logs into noise.
    if (value.length < 8) return;
    if (!this.#values.includes(value)) this.#values.push(value);
  }
}

/**
 * A narrow, *heuristic* scrubber for secret-shaped tokens.
 *
 * The registry can only redact secrets it has been told about. There is one
 * path where that is not enough: a secrets-manager SDK that fails to *fetch*
 * the key and quotes the value it was trying to validate back in its error
 * message. At that moment the service has never seen the secret, so the
 * registry cannot help.
 *
 * This masks only strings that are exactly key-shaped — 64 bytes, in hex,
 * base58, base64 or JSON-array form — and deliberately leaves 32-byte public
 * keys alone (a 43-44 char base58 public key is below the length floor, and a
 * short hex string is not 128 chars), since those appear legitimately in Solana
 * errors and are the most useful thing in them.
 *
 * It is belt-and-braces, not the primary mechanism: the primary mechanism is
 * that the value is registered the moment it is decoded. This exists so that a
 * hostile or careless SDK cannot turn a startup failure into a disclosure.
 */
export function scrubKeyShapedTokens(text: string): string {
  return (
    text
      // 128 hex characters = 64 bytes = a Solana secret key.
      .replace(/\b[0-9a-fA-F]{128}\b/g, REDACTED)
      // Base58 runs that decode to exactly 64 bytes.
      .replace(/[1-9A-HJ-NP-Za-km-z]{80,100}/g, (match) => {
        const decoded = decodeBase58(match);
        return decoded && decoded.length === 64 ? REDACTED : match;
      })
      // Base64 runs that decode to 64 bytes.
      .replace(/\b[A-Za-z0-9+/]{86,90}={0,2}\b/g, (match) => {
        if (match.length % 4 !== 0) return match;
        const decoded = Buffer.from(match, "base64");
        return decoded.length === 64 ? REDACTED : match;
      })
      // A JSON array of 64 byte values.
      .replace(/\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/g, REDACTED)
  );
}

/** The process-wide registry, used in addition to any handler-local one. */
export const globalSecretRegistry = new SecretRegistry();

/** Redact against a specific registry plus the global one. */
export function redact(text: string, registry?: SecretRegistry): string {
  const first = registry ? registry.redact(text) : text;
  return globalSecretRegistry.redact(first);
}

/**
 * Turn anything thrown into a message safe to log or return.
 *
 * Stack traces are included for logging but never for HTTP responses; a stack
 * can contain captured locals on some engines, so it still goes through
 * `redact`.
 */
export function safeErrorMessage(err: unknown, registry?: SecretRegistry): string {
  if (err instanceof Error)
    return scrubKeyShapedTokens(redact(err.message, registry));
  if (typeof err === "string")
    return scrubKeyShapedTokens(redact(err, registry));
  try {
    return scrubKeyShapedTokens(redact(JSON.stringify(err), registry));
  } catch {
    return "unknown error";
  }
}

export function safeStack(err: unknown, registry?: SecretRegistry): string {
  if (err instanceof Error && err.stack) return redact(err.stack, registry);
  return safeErrorMessage(err, registry);
}
