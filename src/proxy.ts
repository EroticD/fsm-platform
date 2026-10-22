import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Stier som kundeportalbrukere (CUSTOMER) har lov til å bruke.
// Alt annet sendes tilbake til kundeportalen.
const CUSTOMER_ALLOWED_PREFIXES = [
  "/kundeportal",
  "/api/kundeportal", // CSV-eksport av egne oppdrag (tilgang sjekkes i ruten)
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
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Kundeportalbrukere skal kun se egen kundedata og teknikertilgjengelighet.
  if (token?.role === "CUSTOMER") {
    const { pathname } = request.nextUrl;
    if (!isAllowedForCustomer(pathname)) {
      return NextResponse.redirect(new URL("/kundeportal", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Kjør på alt utenom Next interne filer og statiske ressurser.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
