/**
 * The poll loop: turn assignments into locally pinned content.
 *
 * One cycle:
 *
 *   1. Ask the api-server for assignments addressed to this node.
 *   2. For each, fetch and pin the CID on the local Kubo node.
 *   3. Report back with `confirm-pin`, echoing the node's *actual* peer id.
 *
 * Design notes:
 *
 *   - **`runOnce` is exposed separately** from `start`, so tests and a manual
 *     `--once` invocation drive a single cycle without a timer — the same shape
 *     the oracle's challenge-window scheduler uses.
 *
 *   - **Overlap is suppressed in-process.** A slow pin must not let the next
 *     tick start a second cycle over the same assignments.
 *
 *   - **One bad assignment does not stop the cycle.** A pin failure is logged
 *     and the loop moves on; the assignment stays unconfirmed and is retried on
 *     the next poll, which is the correct retry semantics for a transient
 *     network problem.
 *
 *   - **The node's peer id is read once per cycle** rather than per assignment,
 *     and it is the id the node reports — not the one from the assignment. If
 *     they disagree the api-server rejects the confirmation (409), which is the
 *     signal that the agent is pointed at the wrong node.
 */

import type { Logger } from "./logger";
import type { IpfsNode } from "./ipfs";
import type { ProviderApi } from "./api";

export interface PollerDeps {
  api: ProviderApi;
  ipfs: IpfsNode;
  logger: Logger;
  intervalMs: number;
}

export interface PollResult {
  scanned: number;
  pinned: number;
  failed: number;
}

export class AssignmentPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: PollerDeps) {}

  /** Run one cycle. Safe to call directly; skips if one is already running. */
  async runOnce(): Promise<PollResult> {
    if (this.running) {
      this.deps.logger.debug("poll skipped: previous cycle still running");
      return { scanned: 0, pinned: 0, failed: 0 };
    }
    this.running = true;
    const result: PollResult = { scanned: 0, pinned: 0, failed: 0 };
    try {
      const assignments = await this.deps.api.listAssignments();
      result.scanned = assignments.length;
      if (assignments.length === 0) return result;

      let nodePeerId: string;
      try {
        nodePeerId = await this.deps.ipfs.peerId();
      } catch (err) {
        // Without the node's peer id there is nothing useful to confirm. Log and
        // leave the assignments for the next cycle.
        this.deps.logger.error("could not read the local node's peer id", {
          error: err instanceof Error ? err.message : String(err),
        });
        return result;
      }

      for (const assignment of assignments) {
        try {
          await this.deps.ipfs.pinCid(assignment.cid);
          await this.deps.api.confirmPin(assignment.cid, nodePeerId);
          result.pinned += 1;
          this.deps.logger.info("pinned and confirmed", {
            dealId: assignment.dealId,
            cid: assignment.cid,
          });
        } catch (err) {
          result.failed += 1;
          this.deps.logger.error("assignment failed", {
            dealId: assignment.dealId,
            cid: assignment.cid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return result;
    } catch (err) {
      // A failure to fetch the assignment list is the api-server's problem, not
      // a reason to die. The next tick retries.
      this.deps.logger.error("poll cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.deps.logger.info("assignment poller started", {
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
