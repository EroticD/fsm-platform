import { logger, requestIdFrom, type LogContext } from "./logger";

/** Maks lengde på `error.message` i loggen, så én stor feil ikke drukner linjen. */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Leser `x-request-id` fra inneværende forespørsel.
 *
 * `next/headers` importeres dynamisk fordi modulen kaster utenfor en
 * request-kontekst (skript, cron-jobber, enhetstester). Da returnerer vi
 * `undefined` i stedet for å velte loggingen.
 */
async function requestIdFromRequest(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    const existing = requestHeaders.get("x-request-id")?.trim();
    // Uten header finnes det ingen id å korrelere mot; vi dikter ikke opp en.
    if (!existing) return undefined;
    return requestIdFrom(new Headers({ "x-request-id": existing }));
  } catch {
    return undefined;
  }
}

/**
 * Reduserer en ukjent feil til `{ name, message }`.
 *
 * Stack traces og hele feilobjekter kan inneholde persondata og hemmeligheter
 * (connection strings, tokens), så de havner aldri i loggen.
 */
function summarizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }
  return {
    name: "UnknownError",
    message: String(error).slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

/**
 * Strukturert feillogg for serverhandlinger og tjenestelag.
 *
 * Skriver samme JSON-linje som `logger.error`, men tar med `requestId` fra
 * `headers()` når kallet skjer i en request-kontekst, og normaliserer feilen
 * til `{ name, message }`. Utenfor en request (skript, bakgrunnsjobber,
 * tester) logges det uten `requestId` – funksjonen kaster aldri.
 */
export async function logServerError(
  message: string,
  error: unknown,
  context?: LogContext,
): Promise<void> {
  const requestId = await requestIdFromRequest();

  logger.error(message, {
    ...context,
    // requestId fra forespørselen vinner over en eventuell verdi i context.
    ...(requestId ? { requestId } : {}),
    error: summarizeError(error),
  });
}
