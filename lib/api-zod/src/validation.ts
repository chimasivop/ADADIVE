/**
 * ============================================================
 * ADADIVE — ZOD VALIDATION MIDDLEWARE
 * ============================================================
 *
 * This file protects every API route with strict input
 * validation before any database or external API call happens.
 *
 * HOW TO USE:
 *   import { validate, schemas } from "@workspace/api-zod";
 *
 *   router.post(
 *     "/storage/pin",
 *     validate(schemas.pinFile),
 *     async (req, res) => { ... }
 *   );
 *
 * If validation fails, the request never reaches your route
 * handler — the middleware responds with a 400 and a clear
 * error message automatically.
 *
 * ============================================================
 */

import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// ============================================================
// REUSABLE FIELD VALIDATORS
// ============================================================

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Decode base58 to bytes, or `null` if the input is not valid base58.
 *
 * Kept local and dependency-free: `@workspace/api-zod` is imported by the API
 * server and the generated clients, and pulling a Solana SDK in for a length
 * check would outweigh the fifteen lines here. This is the same algorithm the
 * shared client library uses to encode; agreeing on it is what makes a length
 * check meaningful.
 */
function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0) return null;

  const bytes: number[] = [];
  for (const char of value) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' is one leading zero byte, which the loop above does not
  // produce (a zero byte contributes nothing to the running value).
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

/**
 * Is `value` base58 that decodes to exactly `length` bytes?
 *
 * Length is checked after decoding rather than by counting characters: a
 * 32-character string is not necessarily 32 bytes, and a Cardano `addr1…`
 * address that happens to sit in the base58 alphabet and the right character
 * range must still be rejected.
 */
function isBase58OfLength(value: string, length: number): boolean {
  const decoded = decodeBase58(value);
  return decoded !== null && decoded.length === length;
}

/**
 * Solana wallet address validator (base58 public key).
 *
 * Replaces the Cardano bech32 validator, which required an `addr1…` /
 * `addr_test1…` prefix and so rejected every Solana key. A Solana public key is
 * exactly 32 bytes base58-encoded, so that is what this checks.
 *
 * The exported names (`cardanoAddress`, `txHash`) are retained because they are
 * imported across the API server and baked into the generated OpenAPI clients;
 * renaming them would ripple through the spec for no behavioural gain.
 */
export const cardanoAddress = z
  .string()
  .trim()
  .min(32, "Wallet address is too short to be a Solana public key")
  .max(44, "Wallet address is too long to be a Solana public key")
  .refine(
    (val) => isBase58OfLength(val, 32),
    { message: "Wallet address must be a base58-encoded 32-byte Solana public key" }
  );

/**
 * Solana transaction signature — a base58-encoded 64-byte Ed25519 signature.
 *
 * Replaces the 64-character hex Cardano transaction hash. The field name is
 * retained for the same reason as the address validator above.
 */
export const txHash = z
  .string()
  .trim()
  .min(64, "Transaction signature is too short to be valid")
  .max(88, "Transaction signature is too long to be valid")
  .refine(
    (val) => isBase58OfLength(val, 64),
    { message: "Transaction signature must be a base58-encoded 64-byte Solana signature" }
  );

/**
 * IPFS CID — supports both CIDv0 (Qm...) and CIDv1 (ba...)
 */
export const ipfsCid = z
  .string()
  .trim()
  .min(46, "CID is too short to be valid")
  .max(80, "CID is too long to be valid")
  .refine(
    (val) => val.startsWith("Qm") || val.startsWith("ba") || val.startsWith("b"),
    { message: "Must be a valid IPFS CID (CIDv0 or CIDv1)" }
  );

/**
 * libp2p peer id of a provider's IPFS (Kubo) node — base58, e.g. `12D3Koo…`.
 *
 * Not decoded (peer ids embed a multihash whose length varies), only shape
 * checked: base58 alphabet and a plausible length, so an obvious typo is
 * rejected before it reaches the database. The length bounds cover both the
 * 46-char Qm… (sha2-256) and longer inline-key forms.
 */
export const peerId = z
  .string()
  .trim()
  .min(10, "Peer ID is too short to be valid")
  .max(128, "Peer ID is too long to be valid")
  .regex(
    /^[1-9A-HJ-NP-Za-km-z]+$/,
    "Peer ID must be a base58-encoded libp2p peer id"
  );

/**
 * Email — trimmed, lowercase, standard format
 */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address")
  .max(255);

/**
 * Generic safe short text — names, titles
 * Strips anything that could be used for injection in emails/HTML
 */
export const safeName = z
  .string()
  .trim()
  .min(2, "Must be at least 2 characters")
  .max(100, "Must be under 100 characters")
  .regex(/^[a-zA-Z0-9À-ÿ\s'.\-&]+$/, "Contains characters that aren't allowed");

/**
 * Generic safe long text — descriptions, reasons
 */
export const safeText = z
  .string()
  .trim()
  .max(2000, "Must be under 2000 characters")
  .optional()
  .or(z.literal(""));

// ============================================================
// ROUTE SCHEMAS
// ============================================================

export const schemas = {

  // ── POST /api/storage/pin ─────────────────────────────────
  // File comes through multer separately; this validates the
  // accompanying form fields sent alongside the file upload.
  pinFile: z.object({
    body: z.object({
      userAddress:      cardanoAddress,
      providerAddress:  cardanoAddress.optional(),
      durationEpochs:   z.coerce.number().int().min(1).max(1000).default(10),
      pricePerEpochTHT: z.coerce.number().positive().max(1000).default(0.0013),
    }),
  }),

  // ── GET /api/storage/pins/:cid/status ─────────────────────
  checkPinStatus: z.object({
    params: z.object({
      cid: ipfsCid,
    }),
  }),

  // ── GET /api/wallet/:address ──────────────────────────────
  getWallet: z.object({
    params: z.object({
      address: cardanoAddress,
    }),
  }),

  // ── GET /api/tx/:txHash ────────────────────────────────────
  getTransaction: z.object({
    params: z.object({
      txHash: txHash,
    }),
  }),

  // ── GET /api/deals/:cid/verify ─────────────────────────────
  verifyDeal: z.object({
    params: z.object({
      cid: ipfsCid,
    }),
    query: z.object({
      txHash: txHash.optional(),
    }),
  }),

  // ── POST /api/providers/apply ──────────────────────────────
  providerApplication: z.object({
    body: z.object({
      name:     safeName,
      email:    email,
      wallet:   cardanoAddress,
      capacity: z.enum(["1-5TB", "5-20TB", "20-100TB", "100TB+"], {
        errorMap: () => ({ message: "Capacity must be one of the listed ranges" }),
      }),
      region: z
        .enum(["Africa", "Europe", "North America", "Asia Pacific", "Middle East", "South America", "Other"])
        .optional(),
      reason: safeText,
    }),
  }),

  // ── PATCH /api/providers/applications/:id ──────────────────
  updateProviderApplication: z.object({
    params: z.object({
      id: z.coerce.number().int().positive("Invalid application ID"),
    }),
    body: z.object({
      status: z.enum(["pending", "approved", "declined", "waitlisted"]),
      review_notes: safeText,
    }),
  }),

  // ── GET /api/providers/applications ────────────────────────
  listProviderApplications: z.object({
    query: z.object({
      status: z.enum(["pending", "approved", "declined", "waitlisted"]).optional(),
    }),
  }),

  // ── POST /api/waitlist ──────────────────────────────────────
  joinWaitlist: z.object({
    body: z.object({
      email: email,
    }),
  }),

  // ── POST /api/providers ─────────────────────────────────────
  createProvider: z.object({
    body: z.object({
      name:               safeName,
      nodeId:             z.string().trim().min(1),
      totalStorageGb:     z.coerce.number().positive(),
      pricePerGbPerEpoch: z.coerce.number().positive(),
      region:             z.string().trim().min(1),
      // Optional: linking a storage node at registration. Absent/null keeps the
      // provider on the centralized Pinata path.
      peerId:             peerId.nullish(),
    }),
  }),

  // ── PATCH /api/providers/:id/node ───────────────────────────
  // Set, change, or clear the provider's storage node after registration.
  updateProviderNode: z.object({
    params: z.object({
      id: z.coerce.number().int().positive("Invalid provider ID"),
    }),
    body: z.object({
      // Required field: `null` explicitly clears the node (back to the Pinata
      // path). An omitted field fails validation, so "clear the node" is always
      // an explicit act rather than the meaning of a malformed body.
      peerId: peerId.nullable(),
    }),
  }),

  // ── POST /api/provider/heartbeat ────────────────────────────
  providerHeartbeat: z.object({
    body: z.object({
      peerId,
    }),
  }),

  // ── POST /api/provider/confirm-pin ──────────────────────────
  // The agent confirms the *assignment it was handed*, not "some deal with this
  // CID". `deals.data_hash` is not unique (two deals can store the same bytes),
  // so a CID lookup can resolve to the wrong row; the assignment id is the only
  // unambiguous target.
  providerConfirmPin: z.object({
    body: z.object({
      assignmentId: z.coerce.number().int().positive("Invalid assignment ID"),
      cid:    ipfsCid,
      peerId,
    }),
  }),

  // ── POST /api/deals/create ──────────────────────────────────
  createDeal: z.object({
    body: z.object({
      providerId:     z.coerce.number().int().positive(),
      clientAddress:  cardanoAddress,
      storageGb:      z.coerce.number().positive(),
      durationEpochs: z.coerce.number().int().positive(),
      dataHash:       z.string().trim().min(1),
    }),
  }),

  // ── PATCH /api/deals/:id ───────────────────────────────────
  updateDeal: z.object({
    params: z.object({
      id: z.coerce.number().int().positive("Invalid deal ID"),
    }),
    body: z
      .object({
        status: z.enum(["pending", "active", "completed", "failed"]).optional(),
        startEpoch: z.coerce.number().int().optional(),
        endEpoch: z.coerce.number().int().optional(),
        txHash: z.string().trim().min(1).optional(),
      })
      .refine((body) => Object.keys(body).length > 0, {
        message: "At least one deal field must be provided",
      }),
  }),

};

// ============================================================
// MIDDLEWARE FACTORY
// ============================================================

/**
 * Wraps a Zod schema into Express middleware.
 * Validates req.body, req.params, and req.query together,
 * then OVERWRITES them with the parsed (and coerced/trimmed)
 * values — so your route handlers receive clean data.
 *
 * @param schema - a Zod object schema with optional body/params/query keys
 */
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body:   req.body,
      params: req.params,
      query:  req.query,
    });

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field:   e.path.slice(1).join(".") || e.path.join("."),
        message: e.message,
      }));

      console.warn(`[ADADIVE] ❌ Validation failed on ${req.method} ${req.path}:`, errors);

      res.status(400).json({
        success: false,
        error: "Invalid request data",
        details: errors,
      });
      return;
    }

    // Replace with parsed/sanitised data
    if (result.data.body)   req.body   = result.data.body;
    if (result.data.params) req.params = result.data.params;
    if (result.data.query)  req.query  = result.data.query;

    next();
  };
}
