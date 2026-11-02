#!/usr/bin/env bash
#
# Oppretter eller oppdaterer separate PostgreSQL-roller for FSM-plattformen:
#
#   fsm_migrator  DDL: eier skjemaet og kjører prisma migrate deploy
#   fsm_app       DML: SELECT/INSERT/UPDATE/DELETE, ingen CREATE/ALTER/DROP
#
# Kjøres fra repo-roten mot Postgres-containeren, etter at migrasjonene er
# kjørt. Skriptet er idempotent og kan kjøres på nytt.
#
#   MIGRATION_PASSWORD='...' RUNTIME_PASSWORD='...' \
#     ./scripts/provision-db-roles.sh
#
# Eksisterende installasjon (eierne er fortsatt admin/postgres):
#
#   REASSIGN_OWNER=admin MIGRATION_PASSWORD='...' RUNTIME_PASSWORD='...' \
#     ./scripts/provision-db-roles.sh
#
# Miljøvariabler:
#   DB_NAME              database (standard POSTGRES_DB eller fsm_db)
#   POSTGRES_SUPERUSER   superbruker som kjører skriptet (standard POSTGRES_USER
#                         eller admin)
#   MIGRATION_ROLE       standard fsm_migrator
#   RUNTIME_ROLE         standard fsm_app
#   MIGRATION_PASSWORD   påkrevd
#   RUNTIME_PASSWORD     påkrevd
#   REASSIGN_OWNER       valgfri gammel eier som skal overføres til migrator
#   PROVISION_SQL        overstyr SQL-filen (for test)
#
# Passordene sendes til psql via miljøvariabler, ikke kommandolinjen, slik at
# de ikke vises i prosesslisten.

set -euo pipefail

usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

die() {
  echo "✖ $*" >&2
  exit 1
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL_FILE="${PROVISION_SQL:-$ROOT/deploy/postgres/provision-roles.sql}"

DB_NAME="${DB_NAME:-${POSTGRES_DB:-fsm_db}}"
SUPERUSER="${POSTGRES_SUPERUSER:-${POSTGRES_USER:-admin}}"
MIGRATION_ROLE="${MIGRATION_ROLE:-fsm_migrator}"
RUNTIME_ROLE="${RUNTIME_ROLE:-fsm_app}"
MIGRATION_PASSWORD="${MIGRATION_PASSWORD:-}"
RUNTIME_PASSWORD="${RUNTIME_PASSWORD:-}"
REASSIGN_OWNER="${REASSIGN_OWNER:-}"

# Roller og database navngis i SQL med %I/:"...", men vi avviser rart input
# tidlig med en tydelig feil. Passord kan inneholde hva som helst; de sendes
# som psql-variabler og escapes med %L.
for value in "$DB_NAME" "$SUPERUSER" "$MIGRATION_ROLE" "$RUNTIME_ROLE"; do
  printf '%s' "$value" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || die \
    "Ugyldig rolle-/databasenavn «$value». Bruk bokstaver, tall og _."
done
if [ -n "$REASSIGN_OWNER" ]; then
  printf '%s' "$REASSIGN_OWNER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || die \
    "REASSIGN_OWNER må være et enkelt rolle navn."
fi
[ "$MIGRATION_ROLE" != "$RUNTIME_ROLE" ] || die \
  "MIGRATION_ROLE og RUNTIME_ROLE må være forskjellige."
[ -n "$MIGRATION_PASSWORD" ] || die "MIGRATION_PASSWORD mangler."
[ -n "$RUNTIME_PASSWORD" ] || die "RUNTIME_PASSWORD mangler."
[ -f "$SQL_FILE" ] || die "Fant ikke SQL-filen $SQL_FILE."

echo "→ Provisionerer $MIGRATION_ROLE (DDL) og $RUNTIME_ROLE (DML) i $DB_NAME ..."
if [ -n "$REASSIGN_OWNER" ]; then
  echo "  Overfører eksisterende objekter fra $REASSIGN_OWNER til $MIGRATION_ROLE."
fi

export FSM_MIGRATION_PASSWORD="$MIGRATION_PASSWORD"
export FSM_RUNTIME_PASSWORD="$RUNTIME_PASSWORD"

docker compose exec -T \
  -e FSM_MIGRATION_PASSWORD \
  -e FSM_RUNTIME_PASSWORD \
  postgres psql \
  -v ON_ERROR_STOP=1 \
  -U "$SUPERUSER" \
  -d "$DB_NAME" \
  -v database_name="$DB_NAME" \
  -v migration_role="$MIGRATION_ROLE" \
  -v runtime_role="$RUNTIME_ROLE" \
  -v reassign_owner="$REASSIGN_OWNER" \
  <"$SQL_FILE"

echo "✓ Rollene er provisionert."
echo
echo "Sett i .env (URL-kod passord med spesialtegn):"
echo "  DATABASE_RUNTIME_URL=postgresql://$RUNTIME_ROLE:<passord>@postgres:5432/$DB_NAME?schema=public"
echo "  DATABASE_MIGRATION_URL=postgresql://$MIGRATION_ROLE:<passord>@postgres:5432/$DB_NAME?schema=public"
echo
echo "Kjør deretter:"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo "  curl -fsS -H \"Authorization: Bearer \$READY_SECRET\" \\"
echo "    http://127.0.0.1:3000/api/ready | grep -q '\"canDdl\":false'"
