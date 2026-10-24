/**
 * Integrasjonstester kjører bare mot en eksplisitt testdatabase (eller i CI,
 * der databasen er ephemeral). Uten dette ville en lokal `npm run
 * test:integration` kunne skrive i utviklingsdatabasen.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
