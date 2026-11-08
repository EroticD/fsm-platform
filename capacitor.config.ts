import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor-skallet rundt den eksisterende feltappen.
 *
 * Appen er server-rendret (Next.js, Prisma, økter og offline-API), og kan
 * derfor ikke eksporteres som statiske filer. Det native skallet starter på en
 * lokal oppsettside der brukeren skriver inn HTTPS-adressen til FSM-plattformen.
 * Adressen lagres i native lagring og brukes ved neste oppstart – den er ikke
 * bygget inn i appen.
 *
 * Når adressen er satt, lastes den driftede FSM-appen i WebView-en. PWA-ens
 * service worker, offline-kladder og PIN-lås følger med fordi appen har samme
 * opprinnelse som serveren.
 */
const config: CapacitorConfig = {
  appId: "no.fsm.felt",
  appName: "FSM felt",
  webDir: "capacitor-shell",
  loggingBehavior: "debug",
  backgroundColor: "#101310",
  server: {
    // Adressen settes ved kjøring av den native broen (ServerConfig), ikke her.
    // `*` gjør at innlogging, SSO-omdirigeringer og eksterne dokumentlenker
    // blir værende i WebView-en i stedet for å åpne systemleseren.
    allowNavigation: ["*"],
    cleartext: true,
    errorPath: "index.html",
  },
  android: {
    backgroundColor: "#101310",
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: "#101310",
    contentInset: "never",
  },
};

export default config;
