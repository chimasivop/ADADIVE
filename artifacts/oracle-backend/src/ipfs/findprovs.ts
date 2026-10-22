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
 *
 * ## What makes an answer conclusive
 *
 * `routing/findprovs` sends **no terminal sentinel**: kad-dht registers for
 * routing query events and forwards each as it happens, then closes the stream
 * when the lookup ends, so the end of a stream is just EOF. (`FinalPeer` is
 * defined in go-libp2p but never emitted by kad-dht; real streams carry only
 * `SendingQuery`/`PeerResponse`/`QueryError`/`Provider`/`Value`/`DialingPeer`.)
 * A closed stream therefore cannot be told from a truncated one by a terminator.
 *
 * Conclusiveness is inferred from the events instead: an absence is believed only
 * when a *result* event was seen (`Provider`/`PeerResponse`/`Value`) and *no*
 * `QueryError` was seen. A `QueryError` is emitted per peer when a dial or
 * message fails, including inside a lookup that otherwise completes — so
 * treating any error as fatal is the fail-safe direction: a given sweep flags a
 * vanished provider only when it got a clean answer, never on a partial or
 * errored one. Anything unrecognised, empty, or truncated-with-no-response is
 * likewise inconclusive. Detail is carried in `FindProvsResult.detail`, and an
 * inconclusive answer never writes a verdict (see `ProviderVerificationService`).
 *
 * ## Transport completion vs truncation, and why a streak is still needed
 *
 * There *is* one reliable transport-level signal, and this client uses it: a
 * chunked response that is cut off before its terminating chunk makes undici
 * reject the body read (`TypeError: terminated`; a stalled one gives
 * `TimeoutError`), whereas a clean end resolves. That difference is exactly what
 * the terminating chunk exists to express, and the read is wrapped below so an
 * aborted body becomes a `FindProvsTransportError` (→ `unknown`) instead of a
 * bare `TypeError` that the service would re-throw.
 *
 * That signal does not close the hole the review described, though. It only
 * catches a body cut off *mid-transfer*. A server that ends the response cleanly
 * but early — Kubo's query channel closing after the first event, a proxy
 * flushing a partial stream with a valid terminator — produces a byte stream
 * identical to a completed search. At the HTTP layer there is nothing to detect,
 * and there is no application-level sentinel to fall back on (above). So a
 * `conclusive` answer here means only "a well-formed, cleanly-ended stream named
 * no providers", not "the search provably finished".
 *
 * Because that residual ambiguity cannot be resolved at this layer, a single
 * conclusive negative is deliberately *not* enough to flag a deal: the
 * verification service requires `consecutiveConclusiveNegatives` in a row before
 * it will act (see `decideAssignment`). Do not "fix" this by trying to detect
 * completion here — it is not detectable, and a future reviewer should not have
 * to re-derive that.
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
    const advertising = providers.peers.includes(peerId);

    // A result event is required before an absence is believed, AND any error
    // event in the stream makes the whole response inconclusive — an error is not
    // overridden by an earlier success. Three shapes land here and none may be
    // read as "the peer is gone": a body we did not understand at all (empty,
    // truncated before any response, an HTML error page served as 200, unknown
    // framing); an error-only payload (kad-dht reports a fatal lookup failure as
    // a bare `QueryError`, so an aborted search and a search that found nobody
    // can both come back with zero providers); and a success followed by a query
    // error, where the error marks the search as unfinished.
    //
    // Note the deliberate deviation from "errors never matter": kad-dht emits
    // `QueryError` *per peer* when a dial fails, including inside a lookup that
    // otherwise completes. Treating any such event as fatal means a search that
    // tolerated one unreachable peer will not yield a conclusive absence, so a
    // vanished provider is only flagged when the sweep saw a clean result. That
    // is the fail-safe direction (never a false at-risk) and it is what makes the
    // rule above satisfiable at all. See the module header.
    if (!providers.sawResult || providers.sawError) {
      const why = providers.sawError
        ? "the findprovs stream contained a query error"
        : "the response was not a recognisable, completed findprovs stream";
      return {
        advertising,
        providerCount: providers.peers.length,
        conclusive: false,
        detail:
          `${why} for ${cid} ` +
          `(${providers.peers.length} providers parsed); inconclusive`,
      };
    }

    if (providers.hitLimit && !advertising) {
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
   * objects, each of which may be a bare provider (`{"ID":"12D3…","Type":4}`) or
   * a wrapper with a `Responses` array; both shapes are handled so this does not
   * depend on one Kubo version's exact framing.
   *
   * Two flags decide whether the stream is a *completed* search, because Kubo
   * emits no terminal sentinel — the stream simply ends at EOF when the lookup
   * finishes (kad-dht never publishes `FinalPeer`), so a closed stream is
   * indistinguishable from a truncated one except by the events in it:
   *
   *   - `sawResult` — a result event was seen (`Provider`/`PeerResponse`, or the
   *     `Value` of a non-provider routing lookup). This is the evidence that a
   *     query actually ran and reported.
   *   - `sawError` — an error event was seen (`QueryError`). In kad-dht this is
   *     emitted *per peer* when a dial or message fails mid-query, and always
   *     after a `DialingPeer` for it, so it is a step-level signal, not proof the
   *     whole search failed.
   *
   * `isPeerAdvertising` combines them (see there). `sawResult` alone is not
   * enough, because an errors-only payload is not a trustworthy "no providers".
   */
  async #findProvs(cid: string): Promise<{
    peers: string[];
    sawResult: boolean;
    sawError: boolean;
    hitLimit: boolean;
  }> {
    // Kubo's HTTP RPC carries *arguments and options in the URL query*, not the
    // request body ([Kubo RPC bindings](https://github.com/ipfs/kubo/blob/master/docs/implement-api-bindings.md)).
    // `routing/findprovs` takes the CID as the `arg` positional and the limit as
    // `num-providers` — note the hyphen; `numProviders` is a Go-struct name from
    // the library API, not the RPC option name, and Kubo ignores it. Sending
    // these in a form body (or under the wrong option name) makes Kubo reject
    // the call for a missing `arg`, which the service turns into `unknown` and
    // so it would never record a verification or at-risk verdict.
    const url = new URL(`${this.options.apiUrl.replace(/\/+$/, "")}/routing/findprovs`);
    url.searchParams.set("arg", cid);
    url.searchParams.set("num-providers", String(this.options.numProviders));

    this.options.logger.debug("findprovs request", { url: url.toString(), cid });

    // The request itself can fail before any body exists: a connection refused,
    // or a socket torn down at (or just after) the response. undici surfaces that
    // as a bare `TypeError: fetch failed`, and the abort signal as a
    // `TimeoutError`. Both are transport failures — "we did not get an answer" —
    // so they are mapped here too. Letting either escape unwrapped is the same
    // bug as the body-read case below: the service re-throws anything that is not
    // a `FindProvsTransportError`, aborting the whole sweep for one dead socket.
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "POST",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new FindProvsTransportError(
        `could not reach Kubo routing/findprovs: ` +
          `${safeErrorMessage(err, this.options.registry)}`
      );
    }

    if (!response.ok) {
      throw new FindProvsTransportError(
        `Kubo routing/findprovs returned HTTP ${response.status}`,
        response.status
      );
    }

    // Reading the body can itself fail *after* a 200: a truncated response makes
    // undici reject the read with `TypeError: terminated` (its socket closed
    // before the terminating chunk), and a stalled one rejects with a
    // `TimeoutError` from the abort signal. Both mean "we did not get a whole
    // answer", so they are mapped to the transport error rather than escaping as
    // a bare `TypeError` — which `ProviderVerificationService` would re-throw,
    // aborting the whole sweep instead of recording one `unknown` and moving on.
    //
    // This is also the one *reliable* transport signal available: a clean chunked
    // end is distinguishable from an aborted one (that is exactly what the
    // terminating chunk is for). It is not sufficient on its own, though — a
    // stream that is ended cleanly but early is byte-identical to a completed
    // search, which is why the caller also requires a sustained pattern (see
    // `decideAssignment`).
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new FindProvsTransportError(
        `could not read the findprovs response body: ` +
          `${safeErrorMessage(err, this.options.registry)}`
      );
    }

    const peers = new Set<string>();
    let sawResult = false;
    let sawError = false;
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
      const kinds = classify(parsed, peers);
      sawResult = kinds.result || sawResult;
      sawError = kinds.error || sawError;
    }

    return {
      peers: [...peers],
      sawResult,
      sawError,
      hitLimit: this.options.numProviders > 0 && peers.size >= this.options.numProviders,
    };
  }
}

/**
 * Collect provider ids from one decoded line and classify what kind of
 * findprovs event it was.
 *
 * Ids are read from `ID`/`Peer`/`id`, recursing into `Responses` (the wrapper
 * shape). Collection is deliberately *permissive*: any id in the line is kept,
 * whatever the event type. That is the fail-safe direction, because an id we
 * keep can only ever make `advertising` true, which suppresses an at-risk flag —
 * whereas dropping one could help produce a wrongful flag. The cost is that a
 * `PeerResponse`/`SendingQuery` id (the *queried* peer, not a provider) also
 * lands in the set, so `providerCount` is "ids seen" rather than a strict
 * provider count; it is only ever reported in the human-readable detail.
 *
 * `result`/`error` are the load-bearing part and *are* decided by event type,
 * because that is what distinguishes a completed search from an errored or
 * truncated one. Event types are the `routing.QueryEventType` values Kubo emits
 * (go-libp2p `core/routing`): `SendingQuery`=0, `PeerResponse`=1, `FinalPeer`=2,
 * `QueryError`=3, `Provider`=4, `Value`=5, `AddingPeer`=6, `DialingPeer`=7.
 * kad-dht actually publishes only 0, 1, 3, 4, 5 and 7 — `FinalPeer` and
 * `AddingPeer` are defined but never emitted, which is exactly why a completed
 * search cannot be detected by a terminator.
 *
 * `Provider`/`PeerResponse`/`Value` are result events; `QueryError` is the error
 * event. A bare record with an id and no event Type is the simple provider shape
 * older tooling emits and counts as a result. A line that is neither a result
 * event nor an error event — unknown framing, or a type this build does not
 * understand — contributes neither flag, so it cannot on its own make the stream
 * look like a completed search. The caller requires a result event, and tolerates
 * no error event, before it will trust an absence.
 */
function classify(value: unknown, out: Set<string>): { result: boolean; error: boolean } {
  if (Array.isArray(value)) {
    let result = false;
    let error = false;
    for (const item of value) {
      const kinds = classify(item, out);
      result = kinds.result || result;
      error = kinds.error || error;
    }
    return { result, error };
  }
  if (value === null || typeof value !== "object") return { result: false, error: false };

  const record = value as Record<string, unknown>;
  const type = record.Type;
  const typed = typeof type === "number";

  const id = record.ID ?? record.Peer ?? record.id;
  const hasId = typeof id === "string" && id.length > 0;
  if (hasId) out.add(id as string);

  let result = type === 4 || type === 1 || type === 5 || (!typed && hasId);
  let error = type === 3;

  if (record.Responses !== undefined) {
    const nested = classify(record.Responses, out);
    result = nested.result || result;
    error = nested.error || error;
  }
  return { result, error };
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
