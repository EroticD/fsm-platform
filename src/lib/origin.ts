import { hasValidBearer } from "@/lib/secrets";

/**
 * Same-origin-sjekk for tilstandsendrende rutehandlere.
 *
 * Nettleseren sender `Origin` på POST/PATCH/DELETE. Vi godtar bare appens egne
 * originer (request-URL, APP_URL eller NEXTAUTH_URL). Uten Origin godtas bare
 * same-origin/none fra nettleseren, eller et gyldig Bearer-token for
 * server-til-server (cron). En vilkårlig Authorization-header er ikke nok.
 */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (site === "same-origin" || site === "none") return true;

    return hasValidBearer(request, [
      process.env.CRON_SECRET,
      process.env.READY_SECRET,
    ]);
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
