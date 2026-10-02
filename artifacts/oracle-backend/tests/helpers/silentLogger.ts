/**
 * A logger that captures output instead of printing it.
 *
 * Most tests use this to keep the run quiet, but it has a second job: the
 * "oracle key is never logged" test asserts over `lines`, so this capture is
 * how that test *observes* what the service wrote.
 *
 * Deliberately, the capture does **not** apply redaction (see `render`). A
 * production logger redacts; this one records what a naive `console.log` would
 * have written, so a leak in the service is detectable rather than hidden by
 * the logger that was supposed to prevent it.
 */

import type { Logger } from "../../src/logger";

export class SilentTestLogger implements Logger {
  readonly lines: string[] = [];

  debug(message: string, fields?: Record<string, unknown>): void {
    this.capture("debug", message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.capture("info", message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.capture("warn", message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.capture("error", message, fields);
  }

  /** Everything captured, as one blob, for "does it contain X" assertions. */
  get text(): string {
    return this.lines.join("\n");
  }

  private capture(
    level: string,
    message: string,
    fields?: Record<string, unknown>
  ): void {
    const parts = [`${level} ${message}`];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        parts.push(`${key}=${render(value)}`);
      }
    }
    this.lines.push(parts.join(" "));
  }
}

/**
 * Render a field the way a *naive* logger would: no redaction, so a leak shows
 * up in `lines` and the assertions can catch it.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserialisable]";
  }
}
