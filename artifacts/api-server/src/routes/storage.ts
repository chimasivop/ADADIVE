import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import * as storage from "../lib/storage.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

function requirePinata(res: Response): boolean {
  if (!process.env.PINATA_API_KEY || !process.env.PINATA_API_SECRET) {
    res.status(503).json({ error: "PINATA_API_KEY and PINATA_API_SECRET are not configured" });
    return false;
  }
  return true;
}

function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── POST /storage/pin — upload file → Pinata IPFS → deal package ─────────────
router.post("/storage/pin", async (req: Request, res: Response): Promise<void> => {
  if (!requirePinata(res)) return;

  try {
    await runUpload(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `File upload error: ${msg}` });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const body = req.body as Record<string, string>;
    const result = await storage.createStorageDeal(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      {
        providerAddress:  body.providerAddress,
        userAddress:      body.userAddress,
        durationEpochs:   parseInt(body.durationEpochs)   || 10,
        pricePerEpochTHT: parseFloat(body.pricePerEpochTHT) || 0.0013,
      },
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /storage/pins/:cid/status — check if CID is still pinned ─────────────
router.get("/storage/pins/:cid/status", async (req: Request, res: Response): Promise<void> => {
  if (!requirePinata(res)) return;
  try {
    const result = await storage.checkPinStatus(String(req.params.cid));
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

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
router.get("/wallet/:address", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await storage.getAddressInfo(String(req.params.address));
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
