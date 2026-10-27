/**
 * The reliability advisor's own tiny logger, the same shape as the
 * provider-agent's.
 *
 * No `pino` dependency: this is a single-purpose process whose output is read by
 * a human in a terminal. It is also a place secrets must never reach — the Meta
 * API key and any bearer token live in memory and are never logged.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${suffix}`;
    if (level === "error" || level === "warn") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

/** A logger that discards everything, for tests. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
