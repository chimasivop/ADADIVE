import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { validate, schemas } from "@workspace/api-zod";
import * as storage from "../lib/storage.js";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

function requirePinata(res: Response): boolean {
  if (!process.env.PINATA_JWT) {
    res.status(503).json({ error: "PINATA_JWT is not configured" });
    return false;
  }
  return true;
}

// ── POST /storage/pin — upload file → Pinata IPFS → deal package ─────────────
router.post(
  "/storage/pin",
  requireAuth,
  upload.single("file"),
  validate(schemas.pinFile),
  async (req: Request, res: Response): Promise<void> => {
    if (!requirePinata(res)) return;

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    try {
      const body = req.body;
      const result = await storage.createStorageDeal(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        {
          providerAddress:  body.providerAddress,
          userAddress:      body.userAddress,
          durationEpochs:   body.durationEpochs,
          pricePerEpochTHT: body.pricePerEpochTHT,
        },
      );
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

// ── GET /storage/pins/:cid/status — check if CID is still pinned ─────────────
router.get(
  "/storage/pins/:cid/status",
  validate(schemas.checkPinStatus),
  async (req: Request, res: Response): Promise<void> => {
    if (!requirePinata(res)) return;
    try {
      const result = await storage.checkPinStatus(req.params.cid as string);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

// ── GET /network/status — Koios / Cardano network health ─────────────────────
router.get("/network/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const tip = await storage.getNetworkTip();
    res.json({ status: "online", ...tip });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: "offline", error: msg });
  }
});

// ── GET /wallet/:address — address info from Koios ────────────────────────────
router.get(
  "/wallet/:address",
  validate(schemas.getWallet),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await storage.getAddressInfo(req.params.address as string);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;
