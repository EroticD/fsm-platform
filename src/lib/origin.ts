import { hasValidBearer } from "@/lib/secrets";

/**
 * Bygger settet med originer appen godtar for tilstandsendrende rutehandlere.
 *
 * `request.url` kan i utviklingsmodus være normalisert til `localhost` selv om
 * nettleseren bruker `127.0.0.1`. Vi tar derfor også med Host-headeren (både
 * http og https) i tillegg til APP_URL og NEXTAUTH_URL.
 */
function allowedOrigins(request: Request): Set<string> {
  const allowed = new Set<string>();

  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // Ugyldig request-URL gir ingen ekstra origin.
  }

  const host = request.headers.get("host");
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }

  for (const value of [process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!value) continue;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Ignorer ugyldig konfigurasjon; de øvrige originene gjelder fortsatt.
    }
  }

  return allowed;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin-sjekk for tilstandsendrende rutehandlere.
 *
 * Nettleseren sender `Origin` på POST/PATCH/DELETE. Vi godtar bare appens egne
 * originer (request-URL, Host, APP_URL eller NEXTAUTH_URL). Uten Origin godtas
 * `Sec-Fetch-Site: same-origin/none`, en Referer fra en av appens originer,
 * eller et gyldig Bearer-token for server-til-server (cron). En vilkårlig
 * Authorization-header er ikke nok.
 */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (site === "same-origin" || site === "none") return true;

    // Enkelte klientbiblioteker (blant annet FullCalendar i utviklingsmodus)
    // sender PATCH uten Origin og uten Sec-Fetch-Site, men med Referer fra
    // samme app.
    const referer = request.headers.get("referer");
    const refererOrigin = referer ? originOf(referer) : null;
    if (refererOrigin && allowedOrigins(request).has(refererOrigin)) {
      return true;
    }

    return hasValidBearer(request, [
      process.env.CRON_SECRET,
      process.env.READY_SECRET,
    ]);
  }

  const originValue = originOf(origin);
  return originValue !== null && allowedOrigins(request).has(originValue);
}
