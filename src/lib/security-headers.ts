/**
 * Enkle sikkerhetsheadere for hele appen.
 *
 * Headere som krever per-forespørsel-nonce (CSP) settes i proxy.ts. Her ligger
 * bare de statiske verdiene, slik at de kan testes uten å starte Next.
 */

export type SecurityHeader = { key: string; value: string };

export function securityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      // Kamera brukes bare av appens eget opphav (QR-skanneren i feltappen),
      // og aldri av innebygd tredjepartsinnhold. Mikrofonen er ikke i bruk.
      // Geolocation deles eksplisitt fra feltsiden. Se docs/DECISIONS.md.
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=(self)",
    },
    {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    },
  ];
}
