#!/usr/bin/env bash
# WAL-arkiv for PITR. Kalles av Postgres som:
#   archive_command = '/bin/bash /scripts/archive-wal.sh %p %f'
#
# Skriptet er bevisst strengt: det returnerer ikke 0 før filen faktisk ligger
# i arkivet. Postgres prøver på nytt ved feil, og en falsk suksess ville gjort
# at WAL-segmentet ble slettet fra pg_wal uten å finnes i arkivet.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Bruk: archive-wal.sh <kildefil> <wal-filnavn>" >&2
  exit 64
fi

SOURCE="$1"
NAME="$2"
ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal-archive}"

case "$NAME" in
  */*|*..*|"")
    echo "Ugyldig WAL-navn: $NAME" >&2
    exit 65
    ;;
esac

if [ ! -f "$SOURCE" ]; then
  echo "WAL-kilden finnes ikke: $SOURCE" >&2
  exit 66
fi

mkdir -p "$ARCHIVE_DIR"
if [ -f "$ARCHIVE_DIR/$NAME" ]; then
  # Allerede arkivert. Postgres krever 0 for å kunne gjenbruke segmentet.
  exit 0
fi

TEMP="$ARCHIVE_DIR/.tmp.$$.$NAME"
trap 'rm -f "$TEMP"' EXIT

cp -- "$SOURCE" "$TEMP"
chmod 600 "$TEMP"
# Rename er atomisk innenfor samme filsystem. En leser ser aldri en halv fil.
mv -- "$TEMP" "$ARCHIVE_DIR/$NAME"
trap - EXIT
sync -f "$ARCHIVE_DIR" 2>/dev/null || sync
echo "arkiverte WAL $NAME"
