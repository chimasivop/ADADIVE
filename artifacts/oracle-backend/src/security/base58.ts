/**
 * Minimal base58.
 *
 * There is no base58 codec in Node's standard library, and the two places that
 * need one here are both security-sensitive in different ways:
 *
 *   - `redact.ts` needs *encode*, so that a secret's base58 form (the wallet
 *     import format, and the form a Solana error message would quote back) is
 *     scrubbed alongside its hex and base64 forms.
 *   - `oracle/keyProvider.ts` needs *decode*, so a key provisioned as base58
 *     can be loaded.
 *
 * It is written out rather than pulled from `bs58` because it is twenty lines,
 * has no dependencies, and — more to the point — the redaction registry must
 * not depend on a codec whose failure modes it cannot see. A silent `null` from
 * a decode here is a startup error with an actionable message, not a corrupted
 * key.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) INDEX.set(ALPHABET[i], i);

/** Encode bytes as base58 (Bitcoin alphabet, leading zero bytes as '1'). */
export function encodeBase58(bytes: Uint8Array): string {
  // Big-integer base conversion over an array of base-58 "digits", least
  // significant first.
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

/** Decode base58, or return `null` if the input is not valid base58. */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  const bytes: number[] = [];
  for (const char of input) {
    const value = INDEX.get(char);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading '1's are leading zero bytes, which the loop above drops.
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}
