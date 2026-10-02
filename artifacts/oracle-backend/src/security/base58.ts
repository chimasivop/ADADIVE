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
 * The implementation now lives in `@workspace/solana-escrow/backend/base58`, so
 * the encoder the browser signs with and the decoders both servers verify with
 * are the same twenty lines rather than three copies that have to agree. This
 * module remains the oracle's single import point, so nothing else in this
 * service has to know where the codec moved to.
 *
 * It is written out rather than pulled from `bs58` because it is twenty lines,
 * has no dependencies, and — more to the point — the redaction registry must
 * not depend on a codec whose failure modes it cannot see. A silent `null` from
 * a decode here is a startup error with an actionable message, not a corrupted
 * key.
 */

export { encodeBase58, decodeBase58 } from "@workspace/solana-escrow/backend/base58";

