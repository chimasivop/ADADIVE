/**
 * Minimal base58 encoder for the browser.
 *
 * `signMessage` returns a `Uint8Array`, and the backend's `/auth/verify` expects
 * a base58 string — so the client needs an encoder. Base58 exists as a
 * transitive dependency (`bs58`, via `@solana/web3.js`) but is not declared, and
 * this is twenty lines.
 *
 * Only `encode` is provided. The one thing this client does with base58 is
 * render a raw signature for transport; decoding signatures is not the client's
 * job, and a decoder that is never called is a decoder that is never tested.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
