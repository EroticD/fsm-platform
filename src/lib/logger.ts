type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return configured in LEVEL_ORDER ? (configured as LogLevel) : "info";
}

function write(level: LogLevel, message: string, context?: LogContext) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Strukturert logger for drift og feilsøking.
 *
 * Loggene er JSON-linjer med tid, nivå og vilkårlig kontekst (requestId,
 * userId, workOrderId osv.). Det gjør dem enkle å filtrere i Docker, Loki
 * eller en hvilken som helst loggplattform. `LOG_LEVEL` styrer detaljnivået.
 */
export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

/** Henter eller lager en request-id for korrelasjon av logger. */
export function requestIdFrom(headers: Headers): string {
  const existing = headers.get("x-request-id")?.trim();
  if (existing) return existing;
  return globalThis.crypto.randomUUID();
}
