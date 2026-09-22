/**
 * The challenge-window scheduler.
 *
 * A polling loop, which the brief explicitly allows ("a cron/polling job is
 * fine for this prototype"). It is deliberately not a job queue: there is no
 * work to fan out, no per-job retry policy, and the only state it needs is
 * "which deals are due", which is a query the database can already answer.
 *
 * Design notes that matter more than the scheduling mechanism:
 *
 *   - **Overlap is prevented in-process.** `setInterval`-with-async-handler is
 *     a classic way to pile up runs when one is slow; a `running` flag makes a
 *     slow run skip the next tick instead. Cross-process overlap is prevented
 *     by the database (see `claimDueForSettlement`), so the flag is a
 *     courtesy, not the safety mechanism.
 *
 *   - **Errors never kill the loop.** A throw from the job is caught and
 *     logged. A scheduler that dies on one bad deal stops settling every other
 *     deal, which is a far worse failure than one delayed settlement.
 *
 *   - **`runOnce` is exposed separately** so tests and the manual endpoint can
 *     drive a single tick without starting a timer.
 */

import type { Logger } from "../logger";
import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { JobRunSummary } from "../service/oracleService";

export interface JobRunnerDeps {
  runJob: () => Promise<JobRunSummary>;
  intervalMs: number;
  logger: Logger;
  registry: SecretRegistry;
}

export class ChallengeWindowScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly deps: JobRunnerDeps) {}

  /** Run one tick, guarding against overlap. Safe to call directly. */
  async runOnce(): Promise<JobRunSummary | null> {
    if (this.running) {
      this.deps.logger.debug("challenge-window tick skipped: previous run still going");
      return null;
    }
    this.running = true;
    try {
      return await this.deps.runJob();
    } catch (err) {
      // A failed run must not stop the loop.
      this.deps.logger.error("challenge window job threw", {
        error: safeErrorMessage(err, this.deps.registry),
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.deps.logger.info("challenge-window scheduler started", {
      intervalMs: this.deps.intervalMs,
    });
    // `unref` so a scheduler never keeps the process alive on its own; the HTTP
    // server is what owns the process lifetime.
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}
