/**
 * Oversetter et API- eller server-action-svar til visbar tekst.
 *
 * Nye feilsvar har `messageKey`; eldre svar har bare `error` med norsk tekst.
 * Vi foretrekker nøkkelen, faller tilbake til en eksplisitt `message`, og
 * bruker til slutt den lokale oversettelsen på kallstedet. En rå feilkode
 * (`forbidden`, `not_found`, …) skal aldri vises som tekst.
 */
export type ApiErrorPayload = {
  error?: unknown;
  messageKey?: unknown;
  message?: unknown;
};

type Translate = (key: string) => string;

function readMessageKey(payload: ApiErrorPayload | null | undefined): string | null {
  if (!payload) return null;
  if (payload.error && typeof payload.error === "object") {
    const nested = (payload.error as { messageKey?: unknown }).messageKey;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  if (typeof payload.messageKey === "string" && payload.messageKey.trim()) {
    return payload.messageKey.trim();
  }
  return null;
}

export function apiErrorMessage(
  payload: ApiErrorPayload | null | undefined,
  t: Translate,
  fallback: string,
): string {
  const messageKey = readMessageKey(payload);
  if (messageKey) {
    try {
      const translated = t(messageKey);
      if (translated) return translated;
    } catch {
      // Nøkkelen finnes ikke i denne språkfilen; bruk fallbacken under.
    }
  }

  const message =
    payload?.error && typeof payload.error === "object"
      ? (payload.error as { message?: unknown }).message
      : payload?.message;
  if (typeof message === "string" && message.trim()) return message.trim();

  // Eldre interne ruter returnerte rå norsk tekst i `error`. Behold den, men
  // aldri en kjent maskinkode.
  if (typeof payload?.error === "string" && payload.error.trim()) {
    const value = payload.error.trim();
    if (!/^[a-z][a-z0-9_-]*$/.test(value)) return value;
  }

  return fallback;
}
