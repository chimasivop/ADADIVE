/**
 * The api-server client used by the agent.
 *
 * Three calls, all bearer-authenticated with the wallet session:
 *
 *   GET  /provider/assignments   — deals assigned to this wallet's node
 *   POST /provider/confirm-pin   — "I fetched and pinned this CID on this node"
 *   POST /provider/heartbeat     — "this node is alive"
 *
 * On a 401 the session is refreshed once and the call retried: a token can
 * expire between polls, and re-signing in is cheaper than failing a poll cycle.
 */

import type { WalletSession } from "./auth";
import type { Logger } from "./logger";

export interface Assignment {
  assignmentId: number;
  dealId: number;
  cid: string;
  peerId: string;
  status: string;
  createdAt: string;
}

export interface ApiDeps {
  apiBaseUrl: string;
  session: WalletSession;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export class ProviderApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ApiDeps) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const send = async (token: string) =>
      this.fetchImpl(`${this.deps.apiBaseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

    let res = await send(await this.deps.session.ensure());

    if (res.status === 401) {
      // The token may simply have expired between polls. One refresh, one retry.
      this.deps.logger.debug("api call 401, refreshing session", { path });
      res = await send(await this.deps.session.refresh());
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* body was not JSON */
      }
      throw new ApiError(
        `${method} ${path} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status
      );
    }

    return (await res.json()) as T;
  }

  async listAssignments(): Promise<Assignment[]> {
    const body = await this.request<{ assignments?: Assignment[] }>(
      "GET",
      "/provider/assignments"
    );
    return body.assignments ?? [];
  }

  async confirmPin(cid: string, peerId: string): Promise<void> {
    await this.request("POST", "/provider/confirm-pin", { cid, peerId });
  }

  async heartbeat(peerId: string): Promise<void> {
    await this.request("POST", "/provider/heartbeat", { peerId });
  }
}
