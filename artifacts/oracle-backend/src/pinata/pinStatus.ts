/**
 * Pin verification — the proof-of-storage check that gates settlement.
 *
 * This is the single discrete function the phase brief asks for:
 * `verifyPinStatus(cid) -> PinVerification`. It is deliberately not a method on
 * a request handler and not inlined into the settle route, because it is the
 * one piece of business logic in the service with a real external dependency
 * and a real decision to make, and it should be testable on its own.
 *
 * What it checks, and why two checks:
 *
 *   1. **The pin exists.** `GET /data/pinList?hash=<cid>` on the Pinata API
 *      answers "is this CID pinned by this account". This is the authoritative
 *      half: it is authenticated, it enumerates the account's own pins, and it
 *      distinguishes "pinned" from "only ever uploaded".
 *   2. **The content is retrievable.** A pin row can be stale — an account can
 *      list a pin whose content the pinning service can no longer serve. A HEAD
 *      against the gateway is the cheap, non-authenticated way to confirm bytes
 *      are actually being served. If no gateway is configured this check is
 *      skipped and the result *says so*, rather than silently reporting a
 *      stronger claim than was tested.
 *
 * The distinction the brief draws — "actually pinned and retrievable, not just
 * that an upload request was made" — is exactly the gap between *uploading* to
 * Pinata and *pinning*. An unpinned upload is garbage-collected, so a deal
 * settled against an unpinned file pays the provider for storage that will
 * evaporate.
 *
 * Failure is not an exception. A not-pinned CID is an ordinary, expected answer
 * to a legitimate question, so it comes back as `{ ok: false, reason: ... }`.
 * Only transport/credential problems throw, and the caller decides whether that
 * means "fail the deal" or "retry later" — which for the settle flow is the
 * difference between `settlement_failed` and staying in the window.
 */

import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { Logger } from "../logger";

export type PinVerificationReason =
  | "pinned_and_retrievable"
  | "pinned_not_checked_for_retrievability"
  | "not_pinned"
  | "pinned_but_not_retrievable";

export interface PinVerification {
  /** True only when settlement may proceed. */
  ok: boolean;
  reason: PinVerificationReason;
  /** Human-readable detail, stored on the deal for audit. Never contains a secret. */
  detail: string;
  /** The pin's size in bytes, when Pinata reported one. */
  sizeBytes?: number;
  /** When Pinata recorded the pin, when reported. */
  pinnedAt?: Date;
}

export interface PinataClientOptions {
  apiBase: string;
  /** JWT, already unwrapped by the caller from its `SecretString`. */
  jwt: string | null;
  /** Gateway host for the retrievability check; `null` skips that check. */
  gatewayUrl: string | null;
  timeoutMs: number;
  logger: Logger;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Secret registry used to scrub anything that reaches a thrown message. */
  registry?: SecretRegistry;
}

/** Raised when Pinata could not be asked the question at all. */
export class PinataTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PinataTransportError";
  }
}

/** A CID is base32/base58-ish; this rejects obvious junk before a round trip. */
const CID_PATTERN = /^[a-zA-Z0-9]{10,128}$/;

interface PinListRow {
  ipfs_pin_hash?: string;
  size?: number;
  date_pinned?: string;
  status?: string;
}

export class PinataClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PinataClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Ask Pinata whether `cid` is pinned, and optionally whether it is servable.
   *
   * Returns a `PinVerification` for every *answer*; throws only when no answer
   * could be obtained (network failure, auth failure, malformed response). The
   * caller must treat a throw as "unknown", not as "not pinned" — conflating
   * the two would fail a legitimate deal on a transient blip.
   */
  async verifyPinStatus(cid: string): Promise<PinVerification> {
    if (!CID_PATTERN.test(cid)) {
      // A syntactically impossible CID cannot be pinned. Answer rather than
      // throw: this is a data problem with the deal, not an outage.
      return {
        ok: false,
        reason: "not_pinned",
        detail: `"${cid}" is not a syntactically valid CID`,
      };
    }

    const pin = await this.#fetchPin(cid);
    if (!pin) {
      return {
        ok: false,
        reason: "not_pinned",
        detail: `Pinata reports no pin for ${cid} for this account`,
      };
    }

    if (this.options.gatewayUrl === null) {
      // Honest about the weaker check rather than implying retrievability was
      // proved. The detail is persisted on the deal, so the audit trail records
      // exactly what was tested.
      return {
        ok: true,
        reason: "pinned_not_checked_for_retrievability",
        detail:
          `Pinata reports ${cid} pinned` +
          (pin.size !== undefined ? ` (${pin.size} bytes)` : "") +
          "; no PINATA_GATEWAY configured, retrievability not tested",
        sizeBytes: pin.size,
        pinnedAt: parseDate(pin.date_pinned),
      };
    }

    const retrievable = await this.#checkGateway(cid);
    if (!retrievable.ok) {
      return {
        ok: false,
        reason: "pinned_but_not_retrievable",
        detail: `Pinata reports ${cid} pinned, but the gateway did not serve it: ${retrievable.detail}`,
        sizeBytes: pin.size,
        pinnedAt: parseDate(pin.date_pinned),
      };
    }

    return {
      ok: true,
      reason: "pinned_and_retrievable",
      detail:
        `Pinata reports ${cid} pinned` +
        (pin.size !== undefined ? ` (${pin.size} bytes)` : "") +
        " and the gateway served it",
      sizeBytes: pin.size,
      pinnedAt: parseDate(pin.date_pinned),
    };
  }

  /** The authenticated pin-list lookup. `null` means "no such pin". */
  async #fetchPin(cid: string): Promise<PinListRow | null> {
    const url = `${this.options.apiBase}/data/pinList?hash=${encodeURIComponent(cid)}&status=pinned`;
    const response = await this.#request(url, {
      method: "GET",
      headers: this.#authHeaders(),
    });

    if (!response.ok) {
      throw new PinataTransportError(
        `Pinata pinList returned HTTP ${response.status}`,
        response.status
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new PinataTransportError(
        `Pinata pinList returned non-JSON: ${safeErrorMessage(err, this.options.registry)}`
      );
    }

    const rows = (body as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) {
      throw new PinataTransportError(
        "Pinata pinList response has no `rows` array"
      );
    }

    // Pinata's search is a filter, not an exact-match guarantee in every API
    // version, so confirm the hash matches rather than trusting the count.
    const match = (rows as PinListRow[]).find(
      (row) => row.ipfs_pin_hash === cid
    );
    return match ?? null;
  }

  /** Unauthenticated HEAD against the gateway: are bytes being served? */
  async #checkGateway(cid: string): Promise<{ ok: boolean; detail: string }> {
    const base = this.options.gatewayUrl!.replace(/\/+$/, "");
    const url = `${base}/ipfs/${encodeURIComponent(cid)}`;
    try {
      const response = await this.#request(url, { method: "HEAD" });
      if (!response.ok) {
        return { ok: false, detail: `gateway returned HTTP ${response.status}` };
      }
      return { ok: true, detail: "gateway served the content" };
    } catch (err) {
      return {
        ok: false,
        detail: `gateway request failed: ${safeErrorMessage(err, this.options.registry)}`,
      };
    }
  }

  #authHeaders(): Record<string, string> {
    if (!this.options.jwt) {
      throw new PinataTransportError(
        "PINATA_JWT is not configured; cannot query pin status"
      );
    }
    return { Authorization: `Bearer ${this.options.jwt}` };
  }

  /**
   * `fetch` with a timeout.
   *
   * `AbortSignal.timeout` rather than a manual `setTimeout` + `AbortController`:
   * the manual version leaks a timer per request when the response wins the
   * race, and this runs on every settle request.
   */
  async #request(url: string, init: RequestInit): Promise<Response> {
    // The URL is logged, not the headers: the JWT lives in the headers.
    this.options.logger.debug("pinata request", { url, method: init.method });
    return this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
