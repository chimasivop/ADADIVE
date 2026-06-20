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

/**
 * Cardano address validator.
 * Accepts both mainnet (addr1...) and testnet (addr_test1...)
 * Bech32 addresses are long, so we check prefix + reasonable length
 * rather than a full Bech32 decode (keeps this dependency-free).
 */
export const cardanoAddress = z
  .string()
  .trim()
  .min(20, "Wallet address is too short to be valid")
  .max(120, "Wallet address is too long to be valid")
  .refine(
    (val) => val.startsWith("addr1") || val.startsWith("addr_test1"),
    { message: "Wallet address must start with 'addr1' (mainnet) or 'addr_test1' (testnet)" }
  );

/**
 * Cardano transaction hash — 64 character hex string
 */
export const txHash = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/, "Transaction hash must be a 64-character hex string");

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

  // ── POST /api/deals/create ──────────────────────────────────
  createDeal: z.object({
    body: z.object({
      providerAddress:  cardanoAddress,
      userAddress:      cardanoAddress,
      durationEpochs:   z.coerce.number().int().min(1).max(1000),
      pricePerEpochTHT: z.coerce.number().positive().max(1000),
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

      return res.status(400).json({
        success: false,
        error: "Invalid request data",
        details: errors,
      });
    }

    // Replace with parsed/sanitised data
    if (result.data.body)   req.body   = result.data.body;
    if (result.data.params) req.params = result.data.params;
    if (result.data.query)  req.query  = result.data.query;

    next();
  };
}
