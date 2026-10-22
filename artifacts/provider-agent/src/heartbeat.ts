/**
 * Periodic heartbeat.
 *
 * Says "this node is still here" so the oracle's findprovs verification can
 * distinguish "the node is up but not advertising the content" (a real problem)
 * from "the node is offline" — the two halves of the at-risk check. A stale
 * heartbeat plus a missing findprovs entry is what flags a deal at-risk; either
 * alone is only a warning.
 *
 * Same `runOnce`/`start` shape as the poller, and the same rule that a failed
 * beat never stops the loop.
 */

import type { Logger } from "./logger";
import type { IpfsNode } from "./ipfs";
import type { ProviderApi } from "./api";

export interface HeartbeatDeps {
  api: ProviderApi;
  ipfs: IpfsNode;
  logger: Logger;
  intervalMs: number;
}

export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: HeartbeatDeps) {}

  /** Send one heartbeat. Returns the peer id reported, or `null` on failure. */
  async runOnce(): Promise<string | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const peerId = await this.deps.ipfs.peerId();
      await this.deps.api.heartbeat(peerId);
      this.deps.logger.debug("heartbeat sent", { peerId });
      return peerId;
    } catch (err) {
      this.deps.logger.warn("heartbeat failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.deps.logger.info("heartbeat started", { intervalMs: this.deps.intervalMs });
    // Beat once immediately so the node is not "stale" until the first interval
    // has elapsed, then on the interval.
    void this.runOnce();
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
