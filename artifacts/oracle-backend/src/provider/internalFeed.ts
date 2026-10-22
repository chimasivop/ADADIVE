/**
 * The api-server's internal provider feed, as the oracle reads and writes it.
 *
 * ## Why HTTP rather than a direct query
 *
 * The oracle and the api-server own *separate databases* (see AGENTS.md): the
 * api-server's `deal_assignments` / `providers` tables live in `adadive`, the
 * oracle's `deals` / `disputes` in `adadive_oracle`. The oracle therefore cannot
 * SELECT the assignment table. Rather than merge the two databases (which would
 * break the documented split and the `deals`-table name collision it avoids),
 * the api-server exposes two narrow, token-guarded endpoints and the oracle
 * calls them:
 *
 *   GET   /internal/provider-assignments       — the work list
 *   PATCH /internal/provider-assignments/:id   — write the verdict back
 *
 * ## Auth
 *
 * A shared bearer token (`INTERNAL_API_TOKEN`), *not* a wallet session: the
 * oracle is a service, and forcing it through a wallet sign-in would be inventing
 * an identity it does not have. The api-server disables these routes outright
 * when the token is unset, so they are never an open channel.
 */

import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { Logger } from "../logger";
import type { AssignmentView } from "./providerVerification";

export interface InternalFeedOptions {
  /** api-server base URL including its `/api` prefix. */
  baseUrl: string;
  token: string;
  timeoutMs: number;
  logger: Logger;
  fetchImpl?: typeof fetch;
  registry?: SecretRegistry;
}

export class InternalFeedError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "InternalFeedError";
  }
}

export class InternalProviderFeed {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: InternalFeedOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** The assignments the oracle should verify this tick. */
  async listAssignments(): Promise<AssignmentView[]> {
    const res = await this.#request("GET", "/internal/provider-assignments");
    const body = (await res.json()) as { assignments?: AssignmentView[] };
    return body.assignments ?? [];
  }

  /** Persist a verdict. `atRisk` is required; the detail is optional. */
  async recordVerdict(
    assignmentId: number,
    atRisk: boolean,
    detail: string,
    consecutiveConclusiveNegatives: number
  ): Promise<void> {
    await this.#request(
      "PATCH",
      `/internal/provider-assignments/${assignmentId}`,
      { atRisk, verificationDetail: detail, consecutiveConclusiveNegatives }
    );
  }

  /**
   * Advance only the streak, leaving the stored verdict alone. Used for a
   * conclusive negative that is still below the at-risk threshold: the counter
   * must move, but writing a verdict would clear an existing one.
   */
  async recordNegativeStreak(
    assignmentId: number,
    consecutiveConclusiveNegatives: number
  ): Promise<void> {
    await this.#request(
      "PATCH",
      `/internal/provider-assignments/${assignmentId}/streak`,
      { consecutiveConclusiveNegatives }
    );
  }

  async #request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}${path}`;
    this.options.logger.debug("internal feed request", { method, url });

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new InternalFeedError(
        `could not reach the api-server's internal feed: ` +
          safeErrorMessage(err, this.options.registry)
      );
    }

    if (!res.ok) {
      throw new InternalFeedError(
        `internal feed ${method} ${path} returned HTTP ${res.status}`,
        res.status
      );
    }
    return res;
  }
}
