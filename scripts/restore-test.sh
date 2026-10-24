#!/usr/bin/env bash
#
# Gjenoppretter en databasebackup til en midlertidig database og kontrollerer
# at kjernedataene er lesbare. Sletter testdatabasen etterpå.
#
#   BACKUP_FILE=backups/db-20261024-030000.sql.gz ./scripts/restore-test.sh
#
# Uten BACKUP_FILE brukes den nyeste backups/db-*.sql.gz.

set -euo pipefail

BACKUP_FILE="${BACKUP_FILE:-$(ls -1t backups/db-*.sql.gz 2>/dev/null | head -n 1 || true)}"
if [ -z "${BACKUP_FILE:-}" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Fant ingen backup. Sett BACKUP_FILE=sti/til/db-....sql.gz" >&2
  exit 1
fi

DB_USER="${POSTGRES_USER:-admin}"
TEST_DB="${TEST_DB:-fsm_restore_test}"

echo "→ Oppretter midlertidig database $TEST_DB ..."
docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$TEST_DB" >/dev/null
docker compose exec -T postgres createdb -U "$DB_USER" "$TEST_DB" >/dev/null

echo "→ Gjenoppretter $BACKUP_FILE ..."
gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres \
  psql -U "$DB_USER" -d "$TEST_DB" >/dev/null

echo "→ Kontrollerer kjernedata ..."
USERS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "User";')"
CUSTOMERS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "Customer";')"
MIGRATIONS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;')"

echo "  Brukere:     $USERS"
echo "  Kunder:      $CUSTOMERS"
echo "  Migrasjoner: $MIGRATIONS"

if [ "${USERS:-0}" -lt 1 ]; then
  echo "✖ Fant ingen brukere i backupen – avbryter." >&2
  docker compose exec -T postgres dropdb -U "$DB_USER" "$TEST_DB" >/dev/null || true
  exit 1
fi

docker compose exec -T postgres dropdb -U "$DB_USER" "$TEST_DB" >/dev/null
echo "✓ Restore-test fullført."
