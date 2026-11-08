#!/usr/bin/env bash
# Point-in-time restore til et NYTT datakatalog. Skriver aldri over en
# eksisterende produksjonsdatabase.
#
#   restore-pitr.sh --base /backup/base-20261109T010000Z \
#     --target-time 2026-11-09T09:59:00Z \
#     --data-dir /var/lib/postgresql/restore/pgdata \
#     [--port 55432]
#
# Kjøres i et midlertidig Postgres-miljø med:
#   - base-backupen montert
#   - WAL-arkivet montert på WAL_ARCHIVE_DIR
#   - et tomt, skrivbart datakatalog
#
# Skriptet promoterer først når recovery faktisk er ferdig, og avslutter
# nonzero hvis verifiseringen feiler. Det er ingen «best effort»-suksess her.
set -euo pipefail

BASE=""
TARGET_TIME=""
DATA_DIR=""
PORT="${PGPORT:-55432}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal-archive}"
TIMEOUT_SECONDS="${RESTORE_TIMEOUT_SECONDS:-900}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?}"; shift 2 ;;
    --target-time) TARGET_TIME="${2:?}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:?}"; shift 2 ;;
    --port) PORT="${2:?}"; shift 2 ;;
    *) echo "Ukjent argument: $1" >&2; exit 64 ;;
  esac
done

[ -n "$BASE" ] || { echo "--base mangler" >&2; exit 64; }
[ -n "$TARGET_TIME" ] || { echo "--target-time mangler" >&2; exit 64; }
[ -n "$DATA_DIR" ] || { echo "--data-dir mangler" >&2; exit 64; }

# Docker starter ofte som root. Datakatalogen må eies av postgres før vi
# bytter bruker; deretter kjøres hele resten uten root-rettigheter.
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p "$DATA_DIR"
  chown 999:999 "$DATA_DIR"
  exec gosu postgres "$0" "$@"
fi

[ -d "$BASE" ] || { echo "Base-backupen finnes ikke: $BASE" >&2; exit 66; }
[ -f "$BASE/PG_VERSION" ] || { echo "Mangler PG_VERSION i $BASE" >&2; exit 66; }
[ -f "$BASE/backup_label" ] || { echo "Mangler backup_label i $BASE" >&2; exit 66; }
[ -d "$WAL_ARCHIVE_DIR" ] || { echo "WAL-arkivet finnes ikke: $WAL_ARCHIVE_DIR" >&2; exit 66; }

if [ -n "$(ls -A "$DATA_DIR" 2>/dev/null || true)" ]; then
  echo "Datakatalogen er ikke tom: $DATA_DIR" >&2
  echo "Restore skal alltid gå til et nytt katalog." >&2
  exit 67
fi

cleanup_on_error() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "PITR feilet (exit $code). Datakatalogen er beholdt for feilsøking: $DATA_DIR" >&2
    pg_ctl -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup_on_error EXIT

echo "Verifiserer base-backup"
if command -v pg_verifybackup >/dev/null 2>&1; then
  pg_verifybackup \
    --ignore=_SUCCESS \
    --ignore=BACKUP-MANIFEST.json \
    "$BASE"
else
  echo "pg_verifybackup mangler; krever _SUCCESS-markør" >&2
  [ -f "$BASE/_SUCCESS" ] || { echo "Backupen er ikke verifisert" >&2; exit 68; }
fi

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
echo "Kopierer base-backup til $DATA_DIR"
cp -a "$BASE/." "$DATA_DIR/"
# Markørene ligger i backupmappen, men hører ikke hjemme i PGDATA.
rm -f "$DATA_DIR/_SUCCESS" "$DATA_DIR/BACKUP-MANIFEST.json" "$DATA_DIR/postmaster.pid"
touch "$DATA_DIR/recovery.signal"

# restore_command leses av Postgres fra postgresql.auto.conf. Enkeltfnutt i
# stien er ikke støttet; valider at stien er enkel.
case "$WAL_ARCHIVE_DIR" in
  *"'"*) echo "WAL_ARCHIVE_DIR kan ikke inneholde apostrof" >&2; exit 65 ;;
esac
{
  echo ""
  echo "# PITR-gjenoppretting skrevet av restore-pitr.sh"
  echo "restore_command = 'cp \"$WAL_ARCHIVE_DIR/%f\" \"%p\"'"
  echo "recovery_target_time = '$TARGET_TIME'"
  echo "recovery_target_action = 'promote'"
  echo "recovery_target_inclusive = on"
} >> "$DATA_DIR/postgresql.auto.conf"

echo "Starter Postgres i recovery mot $TARGET_TIME"
pg_ctl -D "$DATA_DIR" -o "-p $PORT -k $DATA_DIR" -w -t 300 start

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
while :; do
  if ! pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
    echo "Postgres stoppet under recovery. Se loggen i $DATA_DIR/log." >&2
    exit 69
  fi
  IN_RECOVERY="$(psql -h "$DATA_DIR" -p "$PORT" -d postgres -Atqc 'SELECT pg_is_in_recovery()' 2>/dev/null || echo t)"
  if [ "$IN_RECOVERY" = "f" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Tidsavbrudd: recovery ble ikke ferdig innen ${TIMEOUT_SECONDS}s" >&2
    exit 70
  fi
  sleep 2
done

echo "Recovery er ferdig og databasen er promotert."
psql -h "$DATA_DIR" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT pg_is_in_recovery() AS in_recovery, now() AS restored_at;
SQL

# _prisma_migrations finnes i alle installerte databaser. En manglende tabell
# betyr at vi har restaurert feil katalog eller feil tidspunkt.
psql -h "$DATA_DIR" -p "$PORT" -d "${PGDATABASE:-fsm_db}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS applied_migrations
FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL;
SQL

echo "PITR fullført. Kontroller forretningsdata og bytt trafikk manuelt."
trap - EXIT
