import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { buildCsp, createNonce } from "@/lib/csp";
import { requestIdFrom } from "@/lib/logger";

// Stier som kundeportalbrukere (CUSTOMER) har lov til å bruke.
// Alt annet sendes tilbake til kundeportalen.
const CUSTOMER_ALLOWED_PREFIXES = [
  "/kundeportal",
  "/api/kundeportal", // CSV-eksport av egne oppdrag (tilgang sjekkes i ruten)
  "/api/branding", // merkevare (firmanavn, logo, farge) i header
  "/api/rapporter", // selve PDF-filen (tilgang sjekkes per oppdrag i ruten)
  "/uploads", // bilder og vedlegg som vises i rapportene
  "/api/auth", // innlogging / utlogging
  "/glemt-passord",
  "/tilbakestill-passord",
  "/aktiver-konto",
];

// Rapportviseren per oppdrag: /rapporter/<oppdragsId>. Innholdet krever at
// kunden eier oppdraget, noe siden selv sjekker. Den interne rapportlisten
// (/rapporter uten id) er derimot kun for kontoret og er ikke tillatt her.
const REPORT_VIEWER = /^\/rapporter\/[^/]+/;

function isAllowedForCustomer(pathname: string) {
  if (REPORT_VIEWER.test(pathname)) return true;
  return CUSTOMER_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  // Nonce per forespørsel. Next.js leser CSP-headeren og setter nonce på sine
  // egne script-tagger, slik at inline-script fra appen selv fortsatt virker.
  const nonce = createNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  const requestId = requestIdFrom(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", csp);

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Kundeportalbrukere skal kun se egen kundedata og teknikertilgjengelighet.
  if (token?.role === "CUSTOMER") {
    const { pathname } = request.nextUrl;
    if (!isAllowedForCustomer(pathname)) {
      const redirect = NextResponse.redirect(new URL("/kundeportal", request.url));
      redirect.headers.set("Content-Security-Policy", csp);
      redirect.headers.set("x-request-id", requestId);
      return redirect;
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Kjør på alle sider – også HTML-ruter som tilfeldigvis slutter på .js
    // eller .png. En tidligere utvidelsesbasert utelatelse gjorde at slike
    // ruter fikk HTML uten CSP. Bare kjente statiske mapper og filer hoppes
    // over, slik at vanlige _next-chunks ikke går gjennom proxyen.
    "/((?!_next/static|_next/image|_next/webpack-hmr|favicon\\.ico|favicon\\.svg|favicon-\\d+x\\d+\\.png|apple-touch-icon\\.png|android-chrome-\\d+x\\d+\\.png|maskable-\\d+x\\d+\\.png|manifest\\.webmanifest|sw\\.js|offline\\.js|uploads/).*)",
  ],
};
