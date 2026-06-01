import { Router, type IRouter } from "express";
import { db, waitlistTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { JoinWaitlistBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/waitlist", async (req, res): Promise<void> => {
  const parsed = JoinWaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  try {
    const [entry] = await db
      .insert(waitlistTable)
      .values({ email: parsed.data.email })
      .returning();
    res.status(201).json(entry);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "23505"
    ) {
      res.status(409).json({ error: "Already on waitlist" });
      return;
    }
    req.log.error(err, "Failed to insert waitlist entry");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/waitlist", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const entries = await db
    .select()
    .from(waitlistTable)
    .orderBy(desc(waitlistTable.createdAt));
  res.json(entries);
});

export default router;
