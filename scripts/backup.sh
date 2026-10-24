#!/usr/bin/env bash
#
# Sikkerhetskopierer PostgreSQL og opplastingsvolumet.
# Kjøres fra repo-roten, der docker-compose.yml ligger:
#
#   ./scripts/backup.sh
#
# Miljøvariabler:
#   BACKUP_DIR       hvor filene havner (standard ./backups)
#   POSTGRES_USER    databasebruker (standard admin)
#   POSTGRES_DB      databasenavn (standard fsm_db)
#   UPLOADS_VOLUME   volumnavnet, hvis det ikke kan finnes automatisk

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-fsm_db}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"

echo "→ Dumper database $DB_NAME ..."
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "→ Finner opplastingsvolumet ..."
if [ -z "${UPLOADS_VOLUME:-}" ]; then
  UPLOADS_VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_fsm_uploads$' | head -n 1 || true)"
fi

if [ -z "${UPLOADS_VOLUME:-}" ]; then
  echo "Fant ikke opplastingsvolumet. Sett UPLOADS_VOLUME=<navn> og prøv igjen." >&2
  exit 1
fi

echo "→ Pakker $UPLOADS_VOLUME ..."
docker run --rm \
  -v "$UPLOADS_VOLUME:/data:ro" \
  -v "$BACKUP_DIR_ABS:/backup" \
  postgres:15 \
  tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

# Valgfri kryptering med age. Anbefalt i produksjon:
#   BACKUP_AGE_RECIPIENT=age1...
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "age er ikke installert, men BACKUP_AGE_RECIPIENT er satt." >&2
    exit 1
  fi
  for file in "$BACKUP_DIR/db-$STAMP.sql.gz" "$BACKUP_DIR/uploads-$STAMP.tar.gz"; do
    age -r "$BACKUP_AGE_RECIPIENT" -o "$file.age" "$file"
    rm -f "$file"
  done
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

# Behold 30 dager. Juster med RETENTION_DAYS om nødvendig.
RETENTION_DAYS="${RETENTION_DAYS:-30}"
find "$BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS" -delete

echo "✓ Ferdig:"
echo "  $BACKUP_DIR/db-$STAMP.sql.gz"
echo "  $BACKUP_DIR/uploads-$STAMP.tar.gz"
