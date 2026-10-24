import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // Ikke annonser at dette er Next.js.
  poweredByHeader: false,

  // Middleware (proxy.ts) begrenser forespørselens body til 10 MB som standard.
  // Store PDF-filer overstiger dette, og da blir multipart-bodyen avkuttet før
  // den når opplastingsruten. Øker grensen så store dokumenter kommer gjennom.
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024, // 100 MB
  },

  // I utviklingsmodus blokkerer Next.js forespørsler fra andre "origins" enn
  // localhost (for eksempel når man tester fra mobilen på LAN-IP-en
  // http://10.0.0.115:3000). Uten dette lastes ikke utviklingsressursene, og
  // React hydrerer aldri – da ser ikke siden interaktiv ut på mobilen.
  // Vi tillater derfor LAN-adressen og .local-navn. Hvert LAN-IP må legges
  // til her (kun vertsnavn, uten port).
  allowedDevOrigins: ["10.0.0.115", "**.local", "localhost", "127.0.0.1"],

  // Bygger en selvstendig server i .next/standalone med bare nødvendige filer.
  // Dockerfile bruker denne i stedet for `next start`.
  output: "standalone",

  // Prisma 7 og driver-adapteren lastes fra node_modules i standalone-bygget,
  // slik at Next ikke prøver å bundle WASM-motoren og node-postgres.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

  // Opplastede filer skrives og leses med en sti som først er kjent når
  // programmet kjører (se src/lib/uploads.ts). Da kan ikke Next.js avgjøre
  // statisk hva som trengs, og "sporer" hele prosjektet – inkludert
  // uploads-mappen med alle bildene. Den mappen har ingenting i den ferdige
  // serveren å gjøre: i Docker peker UPLOAD_DIR på et eget volum. Uten dette
  // ville hvert bygg pakket alle opplastede bilder inn i image-en.
  outputFileTracingExcludes: {
    "*": ["./uploads/**/*"],
  },

  // Enkle sikkerhetsheadere. En fullverdig CSP krever testing av alle sidene
  // (inline-stiler fra Tailwind/FullCalendar), så her settes bare de direktivene
  // som ikke kan bryte renderingen. TLS termineres i en reverse proxy foran appen.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // CSP settes per forespørsel i proxy.ts (nonce), ikke her.
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
