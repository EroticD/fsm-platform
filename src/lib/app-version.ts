import pkg from "../../package.json";

/**
 * Appversjonen som brukes i metadata og User-Agent.
 *
 * Leses fra `package.json` slik at den følger release-bumpen automatisk.
 * `APP_VERSION` kan overstyre i bygg der package.json ikke er tilgjengelig.
 */
export const APP_VERSION: string = process.env.APP_VERSION ?? pkg.version;
