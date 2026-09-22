/**
 * Typed client for the Phase 3 oracle backend.
 *
 * This is the browser side of the production settle flow. It speaks the seven
 * endpoints in `backend/src/http/server.ts` and nothing else — no business logic
 * is duplicated here. Pin verification, the challenge window, the state machine
 * and the decision to settle all live server-side; this module's job is to carry
 * requests and surface the backend's own error text rather than inventing
 * client-side equivalents.
 *
 * See `PHASE4_NOTES.md`.
 *
 * ## Errors are answers
 *
 * The backend distinguishes "you were too late" (409) from "fix your request"
 * (400) from "we could not decide" (503), and its dispute refusals carry both a
 * human-readable `error` and a machine-readable `code`. Flattening those into a
 * single `Error` at the transport boundary would throw away the distinction the
 * UI needs to display — a depositor who missed the window should read "the
 * challenge window has already closed", not "409". So every non-2xx response
 * becomes a `BackendError` that preserves the status, the code and the message,
 * and callers are expected to render `error.message`.
 */

/**
 * Where the backend lives, when the caller does not supply one.
 *
 * A relative path, so it resolves against the page's origin and hits Vite's
 * `/backend` proxy (see `vite.config.ts`). That matters when the page is opened
 * through a forwarded host: a literal `127.0.0.1:4000` would resolve to the
 * *viewer's* machine, not the one running the backend.
 *
 * Deliberately a plain constant rather than a read of `import.meta.env` at
 * module scope. `import.meta` is ESM-only syntax, and this module is imported by
 * the Node-run Phase 4 walkthrough under a CommonJS compile — so the Vite
 * environment lookup lives in `endpoint.ts`, which only browser code imports.
 * See `BACKEND_ENDPOINT` there for the overridable display value.
 */
export const DEFAULT_BACKEND_BASE_URL = "/backend";

/** The deal lifecycle as the backend reports it. Superset of on-chain state. */
export type BackendDealStatus =
  | "pending_verification"
  | "in_challenge_window"
  | "disputed"
  | "settled"
  | "refunded"
  | "settlement_failed";

/** A deal as `GET /deals/:id` and the mutation responses serialize it. */
export interface BackendDeal {
  id: number;
  dealId: string;
  dealPda: string;
  depositor: string;
  provider: string;
  oracle: string;
  cid: string;
  amountLamports: string;
  status: BackendDealStatus;
  challengeWindowSeconds: number;
  challengeWindowEndsAt: string | null;
  pinVerifiedAt: string | null;
  pinVerificationDetail: string | null;
  settleTxSignature: string | null;
  settleAttemptedAt: string | null;
  settleError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDispute {
  id: number;
  raisedBy: string;
  reason: string;
  raisedAt: string;
  resolved: boolean;
}

export interface BackendDealState {
  deal: BackendDeal;
  disputes: BackendDispute[];
  /** Derived server-side so the client does not re-implement the state machine. */
  canDispute: boolean;
  challengeWindowOpen: boolean;
}

export interface AuthChallenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface AuthSession {
  token: string;
  tokenType: "Bearer";
  wallet: string;
  expiresAt: string;
}

export interface SettleRequestResult {
  /** `challenge_window_opened` on success; otherwise names the terminal state. */
  outcome: string;
  deal: BackendDeal;
  verification?: {
    ok: boolean;
    reason: string;
    detail: string;
  };
}

export interface DisputeResult {
  dispute: BackendDispute;
  deal: BackendDeal;
}

/**
 * A non-2xx backend response, preserving what the backend said.
 *
 * `status` and `code` are kept separate from `message` so a caller can branch on
 * them without parsing prose. `message` is the backend's own text, which is
 * written for a human — e.g. "only the depositor may dispute this deal" or "the
 * challenge window has already closed; settlement is no longer disputable".
 */
export class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The backend's machine-readable refusal code, when it supplied one. */
    readonly code?: string
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** The mutable wallet surface this client signs challenges through. */
export interface MessageSigner {
  publicKey: { toBase58(): string };
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * A session token plus what it is for.
 *
 * The token is a bearer credential, so it is held in memory by the caller (see
 * `useBackendSession`) and never written to `localStorage`: persisting it would
 * survive a page reload that should re-prompt the wallet, and would be readable
 * by any script on the origin.
 */
export interface SessionState {
  token: string;
  wallet: string;
  expiresAt: string;
}

export interface BackendApiOptions {
  baseUrl?: string;
  /** Injectable for the walkthrough script, which runs outside a browser. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests/scripts that need to move past token expiry. */
  now?: () => number;
}

/** Core transport: one JSON request, with the backend's errors preserved. */
export class BackendApi {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(opts: BackendApiOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now());
  }

  /** `GET /health` — liveness plus the oracle public key. Public. */
  async health(): Promise<{
    ok: boolean;
    oracle: string;
    oracleSource: string;
  }> {
    return this.#request("GET", "/health");
  }

  /**
   * Step 1 of sign-in. Unauthenticated: it grants nothing, it only mints a
   * one-time message.
   */
  async requestChallenge(wallet: string): Promise<AuthChallenge> {
    return this.#request("POST", "/auth/challenge", { wallet });
  }

  /**
   * Step 2 of sign-in. The signature is the credential; there is nothing to
   * authenticate first.
   */
  async verifySignature(params: {
    wallet: string;
    nonce: string;
    signature: string;
  }): Promise<AuthSession> {
    return this.#request("POST", "/auth/verify", params);
  }

  /** Register a deal after it is initialized on-chain. Depositor only. */
  async registerDeal(
    token: string,
    params: {
      dealId: string;
      depositor: string;
      provider: string;
      oracle?: string;
      cid: string;
      amountLamports: string;
      dealPda?: string;
    }
  ): Promise<{ deal: BackendDeal }> {
    return this.#request("POST", "/deals", params, token);
  }

  /**
   * Ask the backend to verify the deal and open a challenge window.
   *
   * Provider only. A 202 means "accepted for later processing" — nothing has
   * settled, and settlement happens only when the window closes, from the job.
   */
  async requestSettle(token: string, dealId: string): Promise<SettleRequestResult> {
    return this.#request("POST", `/deals/${encodeURIComponent(dealId)}/settle`, {}, token);
  }

  /** Raise a dispute while the window is open. Depositor only. */
  async dispute(
    token: string,
    dealId: string,
    reason: string
  ): Promise<DisputeResult> {
    return this.#request(
      "POST",
      `/deals/${encodeURIComponent(dealId)}/dispute`,
      { reason },
      token
    );
  }

  /** Polled by the UI; public, so it works before a wallet connects. */
  async getDealState(identifier: string): Promise<BackendDealState> {
    return this.#request("GET", `/deals/${encodeURIComponent(identifier)}`);
  }

  /**
   * Drive the challenge-window job once. Operator/testing affordance.
   *
   * The UI does not call this in normal use — the backend runs the job on its
   * own timer. It is exposed here because the Phase 4 walkthrough needs to
   * close a short window deterministically instead of sleeping.
   */
  async runChallengeWindowJob(token: string): Promise<unknown> {
    return this.#request("POST", "/jobs/challenge-window", {}, token);
  }

  /** True when a stored session is still usable, with a small safety margin. */
  sessionValid(session: SessionState | null): boolean {
    if (!session) return false;
    return new Date(session.expiresAt).getTime() - 5_000 > this.now();
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    token?: string
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A transport failure is not a backend answer. Name it as such rather than
      // letting "Failed to fetch" reach the UI unexplained.
      throw new BackendError(
        0,
        `could not reach the backend at ${this.baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    let payload: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        // A non-JSON body from a proxy (an HTML error page, say) is a real
        // failure mode for a relative endpoint; say so instead of throwing a
        // parse error with no context.
        throw new BackendError(
          response.status,
          `backend returned a non-JSON response (HTTP ${response.status})`
        );
      }
    }

    if (!response.ok) {
      const record = (payload ?? {}) as Record<string, unknown>;
      const message =
        typeof record.error === "string"
          ? record.error
          : `backend request failed (HTTP ${response.status})`;
      const code = typeof record.code === "string" ? record.code : undefined;
      throw new BackendError(response.status, message, code);
    }

    return payload as T;
  }
}

/** Formatted, human-readable text for each backend status the UI must show. */
export function describeStatus(status: BackendDealStatus): string {
  switch (status) {
    case "pending_verification":
      return "Pending verification";
    case "in_challenge_window":
      return "In challenge window";
    case "disputed":
      return "Disputed";
    case "settled":
      return "Settled";
    case "refunded":
      return "Refunded";
    case "settlement_failed":
      return "Settlement failed";
  }
}

/**
 * Milliseconds remaining in a challenge window, or `null` if none is open.
 *
 * Returns `0` rather than a negative number once the deadline passes: the UI
 * should show "0s / closing", and a negative countdown reads as a bug.
 */
export function windowRemainingMs(
  state: BackendDealState,
  now: number = Date.now()
): number | null {
  if (state.deal.status !== "in_challenge_window") return null;
  if (!state.deal.challengeWindowEndsAt) return null;
  const endsAt = new Date(state.deal.challengeWindowEndsAt).getTime();
  return Math.max(0, endsAt - now);
}

/** `1h 02m 03s` — coarse, and deliberately not a ticking stopwatch format. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
