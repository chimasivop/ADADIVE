/**
 * The Meta Model API client.
 *
 * Endpoint, auth, base URL and model id are taken from the official Meta Model
 * API documentation (https://dev.meta.ai/docs), not guessed. Verified against
 * /docs/overview, /docs/quickstart and /docs/structured-output:
 *
 *   - base URL  https://api.meta.ai/v1
 *   - auth      `Authorization: Bearer <key>` (the docs call the env var
 *               MODEL_API_KEY; this app reads the same value from META_API_KEY)
 *   - endpoint  POST /v1/chat/completions  (OpenAI-compatible; the docs also
 *               offer POST /v1/responses, which uses `text.format` for
 *               structured output instead of `response_format`)
 *   - model     muse-spark-1.3  (the docs' default model in their examples)
 *   - structured output: `response_format: { type: "json_schema", json_schema:
 *               { name, schema } }` — decoding is constrained to the schema.
 *
 * Two implementations share one interface (`ModelClient`):
 *
 *   - `HttpMetaClient` — the real call. It never logs the key or the body.
 *   - `FixtureMetaClient` — MOCK mode. It replays a recorded API response
 *     through the *same* envelope-extraction path, so mock mode exercises the
 *     real parsing and validation, not a shortcut around it.
 *
 * A non-2xx response throws `MetaApiError` carrying the status and the error
 * `type`/`message` from the API's OpenAI-style envelope. The caller turns that
 * into an `unknown` assessment; it is never a crash.
 */

import type { ModelRequestPayload } from "./evidence";
import type { Logger } from "./logger";

export interface ModelClient {
  /** Returns the assistant message content (a JSON string under json_schema). */
  complete(payload: ModelRequestPayload): Promise<string>;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type: string | null = null
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * Pull `choices[0].message.content` out of an OpenAI-compatible response.
 *
 * Shared by the HTTP and fixture clients on purpose: a fixture is a *recorded
 * response*, so it must be read exactly like a live one. Returns `null` when the
 * envelope does not have the expected shape, so the caller can treat it as
 * unusable output rather than throwing on a `undefined` access.
 */
export function extractAssistantContent(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export interface HttpMetaClientDeps {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  logger: Logger;
  /** Injectable transport, for tests. Defaults to a bound global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class HttpMetaClient implements ModelClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: HttpMetaClientDeps) {
    // Bound explicitly: a bare `fetch` invoked as `this.fetchImpl(...)` would be
    // called with the instance as its receiver, which browsers reject with
    // "Illegal invocation". Node tolerates it, so binding is what keeps the
    // behaviour the same on both. Only applied when no transport was injected,
    // so test stubs are untouched.
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async complete(payload: ModelRequestPayload): Promise<string> {
    const url = `${this.deps.baseUrl}/chat/completions`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.deps.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (err) {
      // A transport failure (DNS, timeout, connection reset). No status.
      throw new MetaApiError(
        `could not reach the Meta Model API: ${err instanceof Error ? err.message : String(err)}`,
        0
      );
    }

    if (!res.ok) {
      let type: string | null = null;
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string; type?: string } };
        if (body?.error?.message) message = body.error.message;
        if (body?.error?.type) type = body.error.type;
      } catch {
        /* body was not the JSON envelope (e.g. a 404 with no body) */
      }
      throw new MetaApiError(message, res.status, type);
    }

    const body = (await res.json()) as unknown;
    const content = extractAssistantContent(body);
    if (content === null) {
      throw new MetaApiError(
        "the Meta Model API response had no assistant message content",
        res.status
      );
    }
    return content;
  }
}
