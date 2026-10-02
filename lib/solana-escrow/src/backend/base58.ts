/**
 * Minimal base58 codec.
 *
 * The browser needs *encode*: `signMessage` returns a `Uint8Array`, and the
 * oracle's `/auth/verify` expects a base58 string. The api-server needs
 * *decode*: it verifies session tokens whose `sub` is a base58 address. Base58
 * exists as a transitive dependency (`bs58`, via `@solana/web3.js`) but is not
 * declared, and this is twenty lines.
 *
 * It lives in the shared library so that the encoder the client signs with and
 * the decoder the servers verify with are the same twenty lines. A second copy
 * would be a second thing to keep in sync, and a disagreement between them
 * would show up only as "the signature does not verify".
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) INDEX.set(ALPHABET[i], i);

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Each leading zero byte encodes as a literal '1'. The remaining suffix is
  // encoded as a big-endian integer, so the zeros are not folded into the value
  // arithmetic as well.
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
  let out = "1".repeat(zeroes);
  if (zeroes === bytes.length) return out;

  const digits: number[] = [0];
  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let top = digits.length - 1;
  while (top > 0 && digits[top] === 0) top--;
  for (let i = top; i >= 0; i--) out += ALPHABET[digits[i]];
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
