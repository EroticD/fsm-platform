/**
 * Enkel same-origin-sjekk for tilstandsendrende rutehandlere.
 *
 * Nettleseren sender `Origin` på POST/PATCH/DELETE. Vi godtar bare appens egne
 * originer (request-URL, APP_URL eller NEXTAUTH_URL). Klienter uten Origin
 * (cron, server-til-server) må autentisere med Bearer-token.
 */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return Boolean(request.headers.get("authorization"));
  }

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    return false;
  }

  for (const value of [process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!value) continue;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Ignorer ugyldig konfigurasjon; de øvrige originene gjelder fortsatt.
    }
  }

  return allowed.has(origin);
}
