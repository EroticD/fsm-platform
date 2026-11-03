#!/usr/bin/env bash
#
# Kontrollerer at siste backup er fersk, komplett og har gyldig sjekksum.
# Kan kjøres manuelt, fra systemd-timer eller som probe. Skriver Prometheus-
# målinger med --prometheus, eller til en textfile med --prometheus-output.
#
#   ./scripts/backup-freshness.sh
#   ./scripts/backup-freshness.sh --max-age-hours 26 --require-remote
#   ./scripts/backup-freshness.sh --prometheus-output /var/lib/node_exporter/textfile/fsm-backup.prom
#
# Miljøvariabler:
#   BACKUP_DIR             hvor backupene ligger (standard ./backups)
#   BACKUP_MAX_AGE_HOURS   maks alder (standard 26 timer, altså daglig + slark)
#   BACKUP_STATUS_FILE     statusfil fra backup.sh (standard <BACKUP_DIR>/backup-status.json)
#   BACKUP_REMOTE          rclone-mål. Verifiseres når satt.
#   REQUIRE_REMOTE_BACKUP  sett true for å kreve at BACKUP_REMOTE er satt.
#
# Exit 0 betyr at alle harde kontroller er OK. En manglende/foreldet backup,
# feil sjekksum eller manglende ekstern kopi gir exit 1 og kan brukes direkte
# som OnFailure-varsel i systemd.

set -euo pipefail

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

BACKUP_DIR="${BACKUP_DIR:-backups}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
STATUS_FILE="${BACKUP_STATUS_FILE:-$BACKUP_DIR/backup-status.json}"
REQUIRE_REMOTE="${REQUIRE_REMOTE_BACKUP:-false}"
PROMETHEUS="false"
PROMETHEUS_OUTPUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP_DIR="${2:?mangler verdi}"; shift 2 ;;
    --max-age-hours) MAX_AGE_HOURS="${2:?mangler verdi}"; shift 2 ;;
    --status-file) STATUS_FILE="${2:?mangler verdi}"; shift 2 ;;
    --require-remote) REQUIRE_REMOTE="true"; shift ;;
    --prometheus) PROMETHEUS="true"; shift ;;
    --prometheus-output) PROMETHEUS_OUTPUT="${2:?mangler verdi}"; shift 2 ;;
    *) echo "Ukjent argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

printf '%s' "$MAX_AGE_HOURS" | grep -Eq '^[1-9][0-9]*$' || {
  echo "✖ BACKUP_MAX_AGE_HOURS må være et positivt heltall." >&2
  exit 2
}

newest() {
  local pattern="$1"
  # shellcheck disable=SC2086 # Bevisst glob-ekspansjon.
  ls -1t $pattern 2>/dev/null | head -n 1 || true
}

stamp_of() {
  local file="$1"
  local base
  base="$(basename "$file")"
  base="${base#db-}"
  base="${base#uploads-}"
  printf '%s\n' "${base%%.*}"
}

failures=0
warnings=0
age_seconds=0
fresh=0
checksum_ok=0
remote_ok=0
present=0

echo "→ Kontrollerer backup i $BACKUP_DIR ..."

DB_FILE="$(newest "$BACKUP_DIR"/db-*.sql.gz "$BACKUP_DIR"/db-*.sql.gz.age "$BACKUP_DIR"/db-*.sql "$BACKUP_DIR"/db-*.sql.age)"
UPLOADS_FILE="$(newest "$BACKUP_DIR"/uploads-*.tar.gz "$BACKUP_DIR"/uploads-*.tar.gz.age)"

if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
  echo "✖ Fant ingen databasebackup i $BACKUP_DIR." >&2
else
  present=1
  if [ -z "$UPLOADS_FILE" ] || [ ! -f "$UPLOADS_FILE" ]; then
    echo "✖ Fant ingen opplastingsbackup i $BACKUP_DIR." >&2
    present=0
  fi

  DB_STAMP="$(stamp_of "$DB_FILE")"
  if [ -n "${UPLOADS_FILE:-}" ] && [ -f "$UPLOADS_FILE" ]; then
    UPLOADS_STAMP="$(stamp_of "$UPLOADS_FILE")"
    if [ "$DB_STAMP" != "$UPLOADS_STAMP" ]; then
      echo "✖ Siste database- og opplastingsbackup er fra ulike kjøringer ($DB_STAMP vs $UPLOADS_STAMP)." >&2
      present=0
    fi
  fi

  NEWEST_MTIME="$(stat -c %Y "$DB_FILE")"
  if [ -f "${UPLOADS_FILE:-}" ]; then
    UPLOADS_MTIME="$(stat -c %Y "$UPLOADS_FILE")"
    if [ "$UPLOADS_MTIME" -lt "$NEWEST_MTIME" ]; then
      NEWEST_MTIME="$UPLOADS_MTIME"
    fi
  fi
  NOW="$(date +%s)"
  age_seconds=$((NOW - NEWEST_MTIME))
  [ "$age_seconds" -ge 0 ] || age_seconds=0
  MAX_AGE_SECONDS=$((MAX_AGE_HOURS * 3600))
  if [ "$age_seconds" -le "$MAX_AGE_SECONDS" ]; then
    fresh=1
    echo "  Alder: ${age_seconds}s (grense ${MAX_AGE_SECONDS}s)"
  else
    echo "✖ Siste backup er ${age_seconds}s gammel, over grensen på ${MAX_AGE_SECONDS}s." >&2
  fi

  CHECKSUMS_FILE="$BACKUP_DIR/checksums-$DB_STAMP.sha256"
  if [ ! -f "$CHECKSUMS_FILE" ]; then
    echo "✖ Mangler sjekksumfil $CHECKSUMS_FILE." >&2
  elif (cd "$BACKUP_DIR" && sha256sum --check --strict "$(basename "$CHECKSUMS_FILE")" >/dev/null 2>&1); then
    checksum_ok=1
    echo "  Sjekksum: OK"
  else
    echo "✖ Sjekksummen stemmer ikke for $DB_STAMP." >&2
  fi

  if [ -f "$STATUS_FILE" ]; then
    if grep -Fq "\"stamp\": \"$DB_STAMP\"" "$STATUS_FILE"; then
      STATUS_MTIME="$(stat -c %Y "$STATUS_FILE")"
      if [ $((NOW - STATUS_MTIME)) -gt "$MAX_AGE_SECONDS" ]; then
        echo "✖ Statusfilen $STATUS_FILE er eldre enn backupgrensen." >&2
      fi
    else
      echo "⚠ Statusfilen $STATUS_FILE peker ikke på nyeste backup ($DB_STAMP)." >&2
      warnings=$((warnings + 1))
    fi
  else
    echo "⚠ Fant ingen statusfil $STATUS_FILE (eldre backup eller manglende delt mappe)." >&2
    warnings=$((warnings + 1))
  fi

  if [ "$REQUIRE_REMOTE" = "true" ] && [ -z "${BACKUP_REMOTE:-}" ]; then
    echo "✖ REQUIRE_REMOTE_BACKUP=true, men BACKUP_REMOTE er ikke satt." >&2
  elif [ -n "${BACKUP_REMOTE:-}" ]; then
    command -v rclone >/dev/null 2>&1 || {
      echo "✖ rclone er ikke installert, men BACKUP_REMOTE er satt." >&2
      remote_ok=0
    }
    if command -v rclone >/dev/null 2>&1; then
      if rclone check "$BACKUP_DIR" "$BACKUP_REMOTE" \
        --include "db-$DB_STAMP.*" \
        --include "uploads-$DB_STAMP.*" \
        --include "checksums-$DB_STAMP.sha256" \
        --one-way >/dev/null; then
        remote_ok=1
        echo "  Ekstern kopi: OK"
      else
        echo "✖ Den eksterne kopien mangler eller avviker fra lokal backup." >&2
      fi
    fi
  else
    # Ingen ekstern kopi er konfigurert. Det er en advarsel, ikke en hard feil,
    # med mindre operatøren krever den.
    echo "⚠ BACKUP_REMOTE er ikke satt; bare lokal kopi er kontrollert." >&2
    warnings=$((warnings + 1))
  fi
fi

if [ "$present" -ne 1 ] || [ "$fresh" -ne 1 ] || [ "$checksum_ok" -ne 1 ]; then
  failures=$((failures + 1))
fi
if [ "$REQUIRE_REMOTE" = "true" ] && [ "$remote_ok" -ne 1 ]; then
  failures=$((failures + 1))
fi

if [ "$PROMETHEUS" = "true" ] || [ -n "$PROMETHEUS_OUTPUT" ]; then
  PROM_TEXT="$(cat <<PROM
# HELP fsm_backup_present Siste backup finnes.
# TYPE fsm_backup_present gauge
fsm_backup_present $present
# HELP fsm_backup_age_seconds Alder på siste backup.
# TYPE fsm_backup_age_seconds gauge
fsm_backup_age_seconds $age_seconds
# HELP fsm_backup_fresh Siste backup er innenfor aldersgrensen.
# TYPE fsm_backup_fresh gauge
fsm_backup_fresh $fresh
# HELP fsm_backup_checksum_ok Siste backup har gyldig sjekksum.
# TYPE fsm_backup_checksum_ok gauge
fsm_backup_checksum_ok $checksum_ok
# HELP fsm_backup_remote_ok Siste backup er verifisert eksternt.
# TYPE fsm_backup_remote_ok gauge
fsm_backup_remote_ok $remote_ok

PROM
)"
  if [ "$PROMETHEUS" = "true" ]; then
    printf '%s\n' "$PROM_TEXT"
  fi
  if [ -n "$PROMETHEUS_OUTPUT" ]; then
    mkdir -p "$(dirname "$PROMETHEUS_OUTPUT")"
    printf '%s\n' "$PROM_TEXT" >"$PROMETHEUS_OUTPUT.tmp.$$"
    mv "$PROMETHEUS_OUTPUT.tmp.$$" "$PROMETHEUS_OUTPUT"
    echo "  Skrev Prometheus-målinger til $PROMETHEUS_OUTPUT"
  fi
fi

if [ "$failures" -ne 0 ]; then
  echo "✖ Backupkontrollen feilet." >&2
  exit 1
fi
if [ "$warnings" -ne 0 ]; then
  echo "⚠ Backupkontrollen er OK, men med $warnings advarsel(er)."
else
  echo "✓ Backupkontrollen er OK."
fi
