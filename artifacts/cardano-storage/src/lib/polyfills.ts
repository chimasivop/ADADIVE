/**
 * Browser polyfills. Must be the first import in `main.tsx`.
 *
 * `@solana/web3.js` and the Anchor client are written for Node: they assume a
 * global `Buffer` for base58/pubkey work (the escrow client uses it in
 * `constants.ts` for the PDA seeds). Vite does not shim Node globals, so without
 * this the app dies with `Buffer is not defined` during module evaluation,
 * before React ever mounts.
 *
 * ESM evaluates imports depth-first in declaration order, so importing this
 * module first in `main.tsx` guarantees `Buffer` exists before any library
 * module runs. This replaces the Cardano build's `cbor-x`-era assumptions; the
 * `cbor-x` dependency and its CIP-30 multi-asset parsing are gone.
 */
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
