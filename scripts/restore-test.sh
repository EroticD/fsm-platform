#!/usr/bin/env bash
#
# Gjenoppretter en databasebackup til en midlertidig database og kontrollerer
# at kjernedataene er lesbare. Sletter testdatabasen etterpå. Verifiserer også
# opplastingsarkivet (dekryptering + tar-listing) når det finnes.
#
#   BACKUP_FILE=backups/db-20261024-030000.sql.gz ./scripts/restore-test.sh
#   BACKUP_FILE=backups/db-20261024-030000.sql.gz.age \
#     AGE_IDENTITY=~/.config/age/keys.txt ./scripts/restore-test.sh
#
# Uten BACKUP_FILE brukes den nyeste backups/db-*.sql.gz[.age].
#
# Miljøvariabler:
#   BACKUP_FILE       eksplisitt databasebackup (.sql, .sql.gz, .sql.age,
#                     .sql.gz.age)
#   UPLOADS_FILE      eksplisitt opplastingsarkiv (.tar.gz eller .tar.gz.age).
#                     Uten denne brukes nyeste backups/uploads-*.tar.gz[.age].
#   AGE_IDENTITY      age-identitet/nøkkelfil. Standard ~/.config/age/keys.txt.
#                     Brukes bare når backupen er kryptert.
#   BACKUP_DIR        mappe for automatisk søk (standard ./backups)
#   POSTGRES_USER     databasebruker (standard admin)
#   TEST_DB           midlertidig database (standard fsm_restore_test)
#
# Docker Compose leser COMPOSE_FILE, så produksjon kan testes med:
#   COMPOSE_FILE=docker-compose.prod.yml ./scripts/restore-test.sh
#
# Backupen dekrypteres i en strøm og skrives aldri ukryptert til disk.

set -euo pipefail

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

die() {
  echo "✖ $*" >&2
  exit 1
}

BACKUP_DIR="${BACKUP_DIR:-backups}"
DB_USER="${POSTGRES_USER:-admin}"
TEST_DB="${TEST_DB:-fsm_restore_test}"
PROD_DB="${POSTGRES_DB:-fsm_db}"

if [ "$TEST_DB" = "$PROD_DB" ]; then
  die "TEST_DB kan ikke være samme som POSTGRES_DB ($PROD_DB)."
fi
if ! printf '%s' "$TEST_DB" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
  die "TEST_DB må være et enkelt SQL-identifikatornavn (a-z, 0-9, _)."
fi

newest() {
  # shellcheck disable=SC2086 # Bevisst glob-ekspansjon av flere mønstre.
  ls -1t $* 2>/dev/null | head -n 1 || true
}

BACKUP_FILE="${BACKUP_FILE:-$(newest "$BACKUP_DIR"/db-*.sql.gz "$BACKUP_DIR"/db-*.sql.gz.age "$BACKUP_DIR"/db-*.sql "$BACKUP_DIR"/db-*.sql.age)}"
[ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_FILE" ] || die \
  "Fant ingen databasebackup. Sett BACKUP_FILE=sti/til/db-....sql.gz[.age]."

# age-identiteten brukes bare for krypterte filer, og må være en eksisterende
# fil. Vi godtar ikke en tom verdi eller en identitet som mangler.
AGE_IDENTITY="${AGE_IDENTITY:-$HOME/.config/age/keys.txt}"

decrypt_stream() {
  local file="$1"
  case "$file" in
    *.age)
      command -v age >/dev/null 2>&1 || die \
        "Backupen er age-kryptert, men «age» er ikke installert."
      [ -f "$AGE_IDENTITY" ] || die \
        "Fant ikke age-identiteten «$AGE_IDENTITY». Sett AGE_IDENTITY."
      age --decrypt --identity "$AGE_IDENTITY" "$file"
      ;;
    *)
      cat "$file"
      ;;
  esac
}

# Pakker ut/lister i en strøm. Ukjent endelse avvises, slik at vi ikke prøver
# å kjøre vilkårlige filer gjennom psql.
database_stream() {
  local file="$1"
  case "$file" in
    *.sql.gz|*.sql.gz.age) decrypt_stream "$file" | gunzip -c ;;
    *.sql|*.sql.age) decrypt_stream "$file" ;;
    *) die "Ukjent backupformat: $file (forventer .sql[.gz][.age])." ;;
  esac
}

verify_uploads() {
  local file="$1"
  local count
  case "$file" in
    *.tar.gz|*.tar.gz.age) ;;
    *) die "Ukjent opplastingsformat: $file (forventer .tar.gz[.age])." ;;
  esac
  # "." og "./" er katalogoppføringer, ikke filer.
  count="$(decrypt_stream "$file" | tar tzf - \
    | awk '$0 != "." && $0 != "./"' | wc -l | tr -d ' ')"
  if [ "$count" -lt 1 ]; then
    echo "⚠ Opplastingsarkivet $file er tomt (kan være en fersk installasjon)."
  else
    echo "  Opplastinger: $count filer i arkivet"
  fi
}

UPLOADS_FILE="${UPLOADS_FILE:-$(newest "$BACKUP_DIR"/uploads-*.tar.gz "$BACKUP_DIR"/uploads-*.tar.gz.age)}"
if [ -z "${UPLOADS_FILE:-}" ]; then
  echo "⚠ Fant ingen opplastingsarkiv i $BACKUP_DIR – hopper over."
  echo "  Databasegjenopprettingen alene beviser ikke at vedleggene er komplette."
else
  [ -f "$UPLOADS_FILE" ] || die "Fant ikke UPLOADS_FILE=$UPLOADS_FILE."
  echo "→ Verifiserer opplastingsarkivet $UPLOADS_FILE ..."
  verify_uploads "$UPLOADS_FILE"
fi

DB_CREATED=false
cleanup() {
  if [ "$DB_CREATED" = "true" ]; then
    docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists \
      "$TEST_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "→ Oppretter midlertidig database $TEST_DB ..."
docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$TEST_DB" >/dev/null
docker compose exec -T postgres createdb -U "$DB_USER" "$TEST_DB" >/dev/null
DB_CREATED=true

echo "→ Gjenoppretter $BACKUP_FILE ..."
# ON_ERROR_STOP gjør at en avkuttet eller korrupt dump feiler i stedet for å
# etterlate en halv database som ser «vellykket» ut.
database_stream "$BACKUP_FILE" | docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$TEST_DB" >/dev/null

echo "→ Kontrollerer kjernedata ..."
USERS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "User";')"
CUSTOMERS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "Customer";')"
MIGRATIONS="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TEST_DB" -tAc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;')"

echo "  Brukere:     $USERS"
echo "  Kunder:      $CUSTOMERS"
echo "  Migrasjoner: $MIGRATIONS"

if [ "${USERS:-0}" -lt 1 ]; then
  die "Fant ingen brukere i backupen."
fi

echo "✓ Restore-test fullført (database og opplastinger)."
