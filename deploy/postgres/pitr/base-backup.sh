#!/usr/bin/env bash
# Tar en verifisert base-backup for PITR. Skal kjøres mot en frisk primær.
#
#   docker compose -f docker-compose.ha.yml --profile backup \
#     run --rm postgres-basebackup
#
# Skriptet markerer bare backupen som vellykket når pg_basebackup og
# pg_verifybackup begge returnerte 0. En feilet jobb skal gi nonzero exit.
set -euo pipefail

: "${PGHOST:?PGHOST mangler}"
: "${PGUSER:?PGUSER mangler}"
: "${PGDATABASE:?PGDATABASE mangler}"
BACKUP_ROOT="${BACKUP_ROOT:-/backup}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/base-$STAMP"

mkdir -p "$BACKUP_ROOT"
if [ -e "$DEST" ]; then
  echo "Backupmålet finnes allerede: $DEST" >&2
  exit 65
fi

echo "Starter base-backup til $DEST"
pg_basebackup \
  --host="$PGHOST" \
  --port="${PGPORT:-5432}" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --pgdata="$DEST" \
  --wal-method=stream \
  --checkpoint=fast \
  --progress \
  --label="fsm-base-$STAMP"

# pg_verifybackup kontrollerer manifest og at hver fil stemmer. Uten denne
# sjekken er «backupen ferdig» bare et løfte.
pg_verifybackup "$DEST"

SYSTEM_ID="$(pg_controldata "$DEST" | awk -F: '/Database system identifier/ {gsub(/^ +/, "", $2); print $2}')"
REDO_WAL="$(pg_controldata "$DEST" | awk -F: '/REDO WAL file/ {gsub(/^ +/, "", $2); print $2}')"

cat > "$DEST/BACKUP-MANIFEST.json" <<JSON
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$PGHOST",
  "database": "$PGDATABASE",
  "systemIdentifier": "$SYSTEM_ID",
  "redoWalFile": "$REDO_WAL",
  "format": "plain",
  "walMethod": "stream",
  "verifiedWith": "pg_verifybackup"
}
JSON

touch "$DEST/_SUCCESS"
echo "Base-backup verifisert: $DEST"

# Roter bare komplette, verifiserte backuper. Behold alltid den nyeste.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'base-*' \
  ! -name "$(basename "$DEST")" \
  -mtime "+$RETENTION_DAYS" -print0 \
  | while IFS= read -r -d '' old; do
      if [ -f "$old/_SUCCESS" ]; then
        echo "Fjerner gammel base-backup: $old"
        rm -rf -- "$old"
      fi
    done
