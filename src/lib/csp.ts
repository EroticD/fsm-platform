/**
 * Content-Security-Policy med per-forespørsel-nonce.
 *
 * Next.js leser CSP-headeren fra forespørselen og setter samme nonce på sine
 * egne script-tagger. `strict-dynamic` gjør at script som er startet av et
 * godkjent script kan laste flere, uten å åpne for vilkårlige inline-script.
 */
export function buildCsp(nonce: string): string {
  // Reacts utviklingsmodus bruker eval() til feilsøking. Produksjon skal aldri
  // ha 'unsafe-eval'.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;

  return [
    "default-src 'self'",
    scriptSrc,
    // Tailwind og FullCalendar setter inline-stiler. Stiler er ikke script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Kryptografisk tilfeldig nonce, trygg i både Node og Edge. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
