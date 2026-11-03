import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor-skallet rundt den eksisterende feltappen.
 *
 * Appen er server-rendret (Next.js, Prisma, økter og offline-API), og kan
 * derfor ikke eksporteres som statiske filer. Det native skallet laster den
 * driftede HTTPS-adressen i en WebView. Sett `CAPACITOR_SERVER_URL` før
 * `npx cap sync`, for eksempel:
 *
 *   CAPACITOR_SERVER_URL=https://felt.example.no npm run native:sync
 *
 * Uten variabelen viser skallet bare en lokal hjelpeside. Plattformmappene
 * (`android/` og `ios/`) genereres lokalt og er ikke sjekket inn.
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "no.fsm.felt",
  appName: "FSM felt",
  webDir: "capacitor-shell",
  loggingBehavior: "debug",
  backgroundColor: "#101310",
  android: {
    backgroundColor: "#101310",
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: "#101310",
    contentInset: "never",
  },
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: false,
        },
      }
    : {}),
};

export default config;
