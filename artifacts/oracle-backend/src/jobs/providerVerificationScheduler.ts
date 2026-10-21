/**
 * The provider-verification scheduler.
 *
 * A polling loop, same shape and rationale as `challengeWindowScheduler.ts`:
 * overlap is suppressed in-process, an error never kills the loop, and `runOnce`
 * is exposed so tests and a manual endpoint can drive one tick.
 *
 * It is separate from the challenge-window scheduler because the two are
 * independent concerns on independent intervals: the challenge window runs on
 * the order of seconds to settle deals, while DHT verification is a slower,
 * network-bound sweep. Sharing a timer would couple a slow DHT query to a
 * settlement deadline.
 */

import type { Logger } from "../logger";
import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { VerificationRunSummary } from "../provider/providerVerificationService";

export interface ProviderVerificationJobDeps {
  runJob: () => Promise<VerificationRunSummary>;
  intervalMs: number;
  logger: Logger;
  registry: SecretRegistry;
}

export class ProviderVerificationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: ProviderVerificationJobDeps) {}

  /** Run one tick, guarding against overlap. Safe to call directly. */
  async runOnce(): Promise<VerificationRunSummary | null> {
    if (this.running) {
      this.deps.logger.debug("provider-verification tick skipped: previous run still going");
      return null;
    }
    this.running = true;
    try {
      return await this.deps.runJob();
    } catch (err) {
      this.deps.logger.error("provider verification job threw", {
        error: safeErrorMessage(err, this.deps.registry),
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.deps.logger.info("provider-verification scheduler started", {
      intervalMs: this.deps.intervalMs,
    });
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
