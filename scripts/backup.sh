#!/usr/bin/env bash
#
# Sikkerhetskopierer PostgreSQL og opplastingsvolumet.
# Kjøres fra repo-roten:
#
#   ./scripts/backup.sh
#
# Miljøvariabler:
#   BACKUP_DIR            hvor filene havner (standard ./backups)
#   POSTGRES_USER         databasebruker (standard admin)
#   POSTGRES_DB           databasenavn (standard fsm_db)
#   UPLOADS_VOLUME        volumnavnet, hvis det ikke kan finnes automatisk
#   BACKUP_AGE_RECIPIENT  age-mottaker (age1...). Krypterer direkte i strøm,
#                         slik at ukrypterte filer aldri ligger på disk.
#   BACKUP_REMOTE         rclone-mål, f.eks. remote:fsm-backups
#   RETENTION_DAYS        hvor lenge lokale filer beholdes (standard 30)
#
# Docker Compose leser COMPOSE_FILE, så produksjon kan brukes med:
#   COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh

set -euo pipefail

# Backupene kan inneholde persondata. Bare eieren skal kunne lese dem.
umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-fsm_db}"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"

if [ -n "$AGE_RECIPIENT" ] && ! command -v age >/dev/null 2>&1; then
  echo "age er ikke installert, men BACKUP_AGE_RECIPIENT er satt." >&2
  exit 1
fi

# Fjern en halvskrevet fil hvis en pipeline feiler. Ukrypterte filer skrives
# aldri til disk når kryptering er slått på.
CURRENT_OUTPUT=""
cleanup_partial() {
  if [ -n "$CURRENT_OUTPUT" ] && [ -f "$CURRENT_OUTPUT" ]; then
    rm -f "$CURRENT_OUTPUT"
  fi
}
trap cleanup_partial ERR

encrypt_or_plain() {
  # Leser fra stdin og skriver til filen i $1. Krypterer når mottaker er satt.
  local output="$1"
  if [ -n "$AGE_RECIPIENT" ]; then
    age --recipient "$AGE_RECIPIENT" --output "$output"
  else
    cat >"$output"
  fi
}

DB_SUFFIX=".sql.gz"
[ -n "$AGE_RECIPIENT" ] && DB_SUFFIX=".sql.gz.age"
DB_FILE="$BACKUP_DIR/db-$STAMP$DB_SUFFIX"

echo "→ Dumper database $DB_NAME ..."
CURRENT_OUTPUT="$DB_FILE"
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip -c | encrypt_or_plain "$DB_FILE"
[ -s "$DB_FILE" ] || { echo "Databasebackupen ble tom." >&2; exit 1; }
CURRENT_OUTPUT=""

echo "→ Finner opplastingsvolumet ..."
if [ -z "${UPLOADS_VOLUME:-}" ]; then
  UPLOADS_VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_fsm_uploads$' | head -n 1 || true)"
fi

if [ -z "${UPLOADS_VOLUME:-}" ]; then
  echo "Fant ikke opplastingsvolumet. Sett UPLOADS_VOLUME=<navn> og prøv igjen." >&2
  exit 1
fi

UPLOADS_SUFFIX=".tar.gz"
[ -n "$AGE_RECIPIENT" ] && UPLOADS_SUFFIX=".tar.gz.age"
UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP$UPLOADS_SUFFIX"

echo "→ Pakker $UPLOADS_VOLUME ..."
CURRENT_OUTPUT="$UPLOADS_FILE"
# Tar skriver til stdout, slik at også opplastingsarkivet kan krypteres uten
# en midlertidig ukryptert fil.
docker run --rm \
  -v "$UPLOADS_VOLUME:/data:ro" \
  "${POSTGRES_IMAGE:-postgres:15}" \
  tar czf - -C /data . \
  | encrypt_or_plain "$UPLOADS_FILE"
[ -s "$UPLOADS_FILE" ] || { echo "Opplastingsarkivet ble tomt." >&2; exit 1; }
CURRENT_OUTPUT=""

if [ -n "$AGE_RECIPIENT" ]; then
  echo "→ Krypterte backupene med age."
fi

# Valgfri kopi til ekstern lagring (rclone). Eksempel:
#   BACKUP_REMOTE=remote:fsm-backups
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "rclone er ikke installert, men BACKUP_REMOTE er satt." >&2
    exit 1
  fi
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include "*-$STAMP.*"
  echo "→ Kopierte backupene til $BACKUP_REMOTE."
fi

# Behold 30 dager. Juster med RETENTION_DAYS om nødvendig. Sletting skjer bare
# etter at dump og arkiv er skrevet og eventuelt kopiert eksternt.
RETENTION_DAYS="${RETENTION_DAYS:-30}"
find "$BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS" -delete

echo "✓ Ferdig:"
echo "  $DB_FILE"
echo "  $UPLOADS_FILE"
