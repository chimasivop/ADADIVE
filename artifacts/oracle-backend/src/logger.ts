/**
 * A structured logger that is safe to hand secret material.
 *
 * `console.log` is where keys leak in practice: not through a deliberate
 * `console.log(secret)`, but through `console.error(err)` on an error whose
 * message happens to embed a key, or a log line that prints a whole config
 * object. This wrapper routes every value through the redaction registry before
 * it reaches stdout, so the safe path is also the default path.
 */

import { redact, safeErrorMessage, type SecretRegistry } from "./security/redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Render a field value without ever stringifying a secret. */
function renderValue(value: unknown, registry?: SecretRegistry): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Error) return safeErrorMessage(value, registry);
  if (typeof value === "string") return redact(value, registry);
  if (value instanceof Uint8Array) {
    // Never dump raw bytes: a key would be in here.
    return `Uint8Array(${value.length})`;
  }
  try {
    return redact(JSON.stringify(value), registry);
  } catch {
    return "[unserialisable]";
  }
}

export function createLogger(
  level: LogLevel = "info",
  registry?: SecretRegistry,
  sink: (line: string) => void = (line) => process.stdout.write(line + "\n")
): Logger {
  const threshold = LEVEL_ORDER[level];

  const emit = (
    lvl: LogLevel,
    message: string,
    fields?: Record<string, unknown>
  ) => {
    if (LEVEL_ORDER[lvl] < threshold) return;
    const safeMessage = redact(message, registry);
    const parts = [`[${new Date().toISOString()}] ${lvl.toUpperCase()} ${safeMessage}`];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        parts.push(`${key}=${renderValue(value, registry)}`);
      }
    }
    sink(parts.join(" "));
  };

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

/** A logger that discards everything, for tests that assert on output. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
