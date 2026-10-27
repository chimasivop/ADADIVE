/**
 * The api-server client the advisor uses to fetch *read-only* evidence.
 *
 * One GET, two possible credentials, mirroring the api-server's own auth split:
 *
 *   - `GET /internal/provider-reliability/:id` with the shared
 *     `INTERNAL_API_TOKEN` — for a server-side advisor with no wallet.
 *   - `GET /provider/reliability` with a wallet session bearer
 *     (`RELIABILITY_AGENT_TOKEN`) — for a caller acting as the provider.
 *
 * Both return the same evidence shape. Only a GET is ever issued: this client
 * cannot mutate anything, which is the point.
 */

import type { ReliabilityEvidence } from "./evidence";
import type { Logger } from "./logger";

export interface EvidenceClientDeps {
  apiBaseUrl: string;
  logger: Logger;
  internalApiToken?: string | null;
  sessionToken?: string | null;
  fetchImpl?: typeof fetch;
}

export class EvidenceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "EvidenceError";
  }
}

export class EvidenceClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: EvidenceClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Fetch evidence for one provider id. Uses the internal token when present,
   * otherwise the wallet session token. Throws `EvidenceError` when neither is
   * configured or the request fails.
   */
  async fetch(providerId: number): Promise<ReliabilityEvidence> {
    const internal = this.deps.internalApiToken?.trim();
    const session = this.deps.sessionToken?.trim();

    let path: string;
    let token: string;
    if (internal) {
      path = `/internal/provider-reliability/${providerId}`;
      token = internal;
    } else if (session) {
      path = `/provider/reliability`;
      token = session;
    } else {
      throw new EvidenceError(
        "no credential: set INTERNAL_API_TOKEN (shared token) or " +
          "RELIABILITY_AGENT_TOKEN (wallet session)",
        0
      );
    }

    const res = await this.fetchImpl(`${this.deps.apiBaseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* body was not JSON */
      }
      throw new EvidenceError(
        `GET ${path} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status
      );
    }

    return (await res.json()) as ReliabilityEvidence;
  }
}
