/**
 * `findprovs` — "is *this specific peer* still advertising this content?"
 *
 * The existing Pinata check answers "is this CID pinned somewhere in our
 * account" (see `pinata/pinStatus.ts`). For a deal stored on a provider's own
 * node that question is the wrong one: the CID may be available from any node on
 * the network while the provider that is being paid for it has stopped
 * advertising it. So this client asks the IPFS DHT a *peer-scoped* question via
 * `routing/findprovs <CID>`, and reports whether the assigned peer id appears
 * among the returned providers.
 *
 * ## Why a hand-written client instead of `kubo-rpc-client`
 *
 * The oracle backend is CommonJS, and `kubo-rpc-client` is ESM-only. Rather than
 * add a transpilation step to a service whose one other external dependency is
 * already a hand-written `fetchImpl`-injectable client (`PinataClient`), this
 * mirrors that pattern: the Kubo RPC endpoint is a simple form-POST returning
 * newline-delimited JSON, and `fetchImpl` is injectable so unit tests need no
 * live node. The provider-agent (a separate, ESM package) uses
 * `kubo-rpc-client` directly — it is not bound by this constraint.
 *
 * Failure is not an exception. "The peer is not advertising the content" is an
 * ordinary answer, so it comes back as `advertising: false`; only a transport
 * problem throws, and the caller decides whether that means "at-risk" or
 * "retry". That split is what keeps a Kubo outage from flagging every deal.
 */

import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { Logger } from "../logger";

export interface FindProvsResult {
  /** True when `peerId` is among the providers the DHT returned for `cid`. */
  advertising: boolean;
  /** How many providers the DHT returned, when the query completed. */
  providerCount: number;
  /**
   * True when the query completed and returned an answer we trust. `false`
   * means the answer is inconclusive (e.g. the search hit its limit before
   * finding anyone) and the caller should *not* treat the peer as vanished.
   */
  conclusive: boolean;
  /** Human-readable detail for the audit trail. Never contains a secret. */
  detail: string;
}

export interface KuboFindProvsOptions {
  /** Kubo HTTP RPC base, e.g. `http://127.0.0.1:5001/api/v0`. */
  apiUrl: string;
  timeoutMs: number;
  /** How many providers to request; a small number is enough to see the peer. */
  numProviders: number;
  logger: Logger;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  registry?: SecretRegistry;
}

/** Raised when the DHT could not be queried at all. */
export class FindProvsTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FindProvsTransportError";
  }
}

const CID_PATTERN = /^[a-zA-Z0-9]{10,128}$/;

export class KuboFindProvsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: KuboFindProvsOptions) {
    // A bare `fetch` reference is invoked with this instance as its receiver,
    // which browsers reject ("Illegal invocation"). Node ignores the receiver,
    // but binding here is harmless and consistent with the shared backend client.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Ask the DHT who is advertising `cid`, then answer whether `peerId` is among
   * them. Returns a result for every *answer*; throws only when no answer could
   * be obtained.
   */
  async isPeerAdvertising(cid: string, peerId: string): Promise<FindProvsResult> {
    if (!CID_PATTERN.test(cid)) {
      return {
        advertising: false,
        providerCount: 0,
        conclusive: true,
        detail: `"${cid}" is not a syntactically valid CID`,
      };
    }
    if (peerId.trim().length === 0) {
      return {
        advertising: false,
        providerCount: 0,
        conclusive: true,
        detail: "the assignment has no peer id to check",
      };
    }

    const providers = await this.#findProvs(cid);

    if (providers.hitLimit && !providers.peers.includes(peerId)) {
      // The DHT returned the maximum number of providers and this peer was not
      // among them — but there may be more it did not report. Inconclusive:
      // do not flag the deal on an incomplete answer.
      return {
        advertising: false,
        providerCount: providers.peers.length,
        conclusive: false,
        detail:
          `the DHT returned ${providers.peers.length} providers for ${cid} ` +
          `(the search limit) and ${peerId} was not among them; inconclusive`,
      };
    }

    const advertising = providers.peers.includes(peerId);
    return {
      advertising,
      providerCount: providers.peers.length,
      conclusive: true,
      detail: advertising
        ? `${peerId} is advertising ${cid} (${providers.peers.length} providers seen)`
        : `${peerId} is not among the ${providers.peers.length} providers advertising ${cid}`,
    };
  }

  /**
   * The raw query. Kubo's `routing/findprovs` streams newline-delimited JSON
   * objects, each of which may be a bare provider (`{"ID":"12D3…","Type":…}`) or
   * a wrapper with a `Responses` array; both shapes are handled so this does not
   * depend on one Kubo version's exact framing.
   */
  async #findProvs(cid: string): Promise<{ peers: string[]; hitLimit: boolean }> {
    const url = `${this.options.apiUrl.replace(/\/+$/, "")}/routing/findprovs`;
    const form = new URLSearchParams({
      arg: cid,
      numProviders: String(this.options.numProviders),
    });

    this.options.logger.debug("findprovs request", { url, cid });

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      throw new FindProvsTransportError(
        `Kubo routing/findprovs returned HTTP ${response.status}`,
        response.status
      );
    }

    const text = await response.text();
    const peers = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A malformed line is skipped rather than failing the whole query; the
        // rest of the stream can still name the peer.
        continue;
      }
      collectIds(parsed, peers);
    }

    return {
      peers: [...peers],
      hitLimit: this.options.numProviders > 0 && peers.size >= this.options.numProviders,
    };
  }
}

/**
 * Collect provider ids from one decoded line.
 *
 * Recurses into `Responses` (the wrapper shape) and reads `ID`/`Peer`/`id` (the
 * bare shape). Written defensively because the RPC framing has changed across
 * Kubo versions and a wrong guess here would silently produce "no providers".
 */
function collectIds(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, out);
    return;
  }
  if (value === null || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const id = record.ID ?? record.Peer ?? record.id;
  if (typeof id === "string" && id.length > 0) out.add(id);

  if (record.Responses !== undefined) collectIds(record.Responses, out);
}

/** True when `error` is a Kubo transport failure rather than an answer. */
export function isFindProvsTransportError(error: unknown): boolean {
  return error instanceof FindProvsTransportError;
}

/** Scrub an error for logging. */
export function describeFindProvsError(
  error: unknown,
  registry?: SecretRegistry
): string {
  return safeErrorMessage(error, registry);
}
