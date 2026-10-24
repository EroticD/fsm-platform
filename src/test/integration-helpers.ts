import { randomUUID } from "node:crypto";

/**
 * Integrasjonstester muterer en ekte database. De kjøres bare når
 * TEST_DATABASE_URL er satt (dedikert testdatabase) eller i CI, der databasen
 * er ephemeral. Uten dette hoppes de over, slik at en lokal testkjøring aldri
 * rører utviklingsdatabasen.
 */
export const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_URL || process.env.CI,
);

export function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 10)}`;
}
