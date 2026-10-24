#!/bin/sh
# Oppstartsskript for FSM-plattformen.
#
#   1. Venter til databasen svarer.
#   2. Kjører ventende migrasjoner (prisma migrate deploy).
#   3. Kjører seed hvis SEED_DATABASE=true.
#   4. Starter applikasjonen.
#
# Alt kan slås av/på med miljøvariabler, slik at skriptet også fungerer når
# migrasjonene kjøres som et eget steg.
set -e

# Prisma-CLI-en kalles via sin egen fil, se kommentaren i Dockerfile.
prisma_cli() {
  node ./node_modules/prisma/build/index.js "$@"
}

if [ -n "${DATABASE_URL:-}" ] && [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "→ Venter på at databasen skal svare ..."
  forsok=0
  until echo "SELECT 1;" | prisma_cli db execute --stdin >/dev/null 2>&1; do
    forsok=$((forsok + 1))
    if [ "$forsok" -ge "${DB_WAIT_RETRIES:-60}" ]; then
      echo "✖ Databasen svarte ikke etter $forsok forsøk. Avslutter."
      exit 1
    fi
    sleep "${DB_WAIT_SECONDS:-2}"
  done
  echo "✔ Databasen svarer."

  echo "→ Kjører migrasjoner ..."
  prisma_cli migrate deploy
fi

# Registrerer metadata for filer som ble lastet opp før tilgangskontrollen per
# fil ble innført. Skriptet er idempotent og hopper over filer som allerede er
# registrert.
if [ "${BACKFILL_UPLOADS:-true}" = "true" ]; then
  echo "→ Registrerer eksisterende opplastinger ..."
  node scripts/backfill-uploads.mjs || echo "⚠ Backfill av opplastinger feilet – fortsetter likevel."
fi

if [ "${SEED_DATABASE:-false}" = "true" ]; then
  echo "→ Oppretter startdata ..."
  node scripts/seed.mjs || echo "⚠ Seed feilet – fortsetter likevel."
fi

echo "→ Starter applikasjonen: $*"
exec "$@"
