#!/usr/bin/env bash
#
# Tester scripts/backup-freshness.sh uten Docker, Postgres eller rclone.
# Dekker fersk backup, foreldet backup, korrupt sjekksum, manglende fil og
# Prometheus-utdata.
#
#   bash scripts/tests/backup-freshness.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup-freshness.sh"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

failures=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✖ $*" >&2; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

make_backup() {
  local dir="$1" stamp="$2" age="${3:-}"
  mkdir -p "$dir"
  printf 'database\n' >"$dir/db-$stamp.sql.gz"
  printf 'opplastinger\n' >"$dir/uploads-$stamp.tar.gz"
  (
    cd "$dir"
    sha256sum "db-$stamp.sql.gz" "uploads-$stamp.tar.gz" \
      >"checksums-$stamp.sha256"
  )
  cat >"$dir/backup-status.json" <<JSON
{"completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "stamp": "$stamp"}
JSON
  if [ -n "$age" ]; then
    find "$dir" -type f -exec touch -d "$age" {} +
  fi
}

echo "→ Fersk backup"
make_backup "$TMP/fresh" 20261102-030000
set +e
out="$(BACKUP_DIR="$TMP/fresh" bash "$SCRIPT" --max-age-hours 26 --prometheus 2>&1)"
rc=$?
set -e
[ "$rc" -eq 0 ] && pass "returnerer 0" || fail "returnerte $rc"
check "melder fersk" 'printf "%s" "$out" | grep -q "^fsm_backup_fresh 1$"'
check "melder gyldig sjekksum" 'printf "%s" "$out" | grep -q "^fsm_backup_checksum_ok 1$"'
check "melder alder" 'printf "%s" "$out" | grep -q "^fsm_backup_age_seconds "'

echo "→ Foreldet backup"
make_backup "$TMP/stale" 20261001-030000 "3 days ago"
set +e
out="$(BACKUP_DIR="$TMP/stale" bash "$SCRIPT" --max-age-hours 1 --prometheus 2>&1)"
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler på gammel backup" || fail "godtok gammel backup"
check "melder ikke fersk" 'printf "%s" "$out" | grep -q "^fsm_backup_fresh 0$"'

echo "→ Korrupt sjekksum"
make_backup "$TMP/corrupt" 20261102-040000
printf 'endret\n' >>"$TMP/corrupt/db-20261102-040000.sql.gz"
set +e
out="$(BACKUP_DIR="$TMP/corrupt" bash "$SCRIPT" --prometheus 2>&1)"
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler på korrupt fil" || fail "godtok korrupt fil"
check "melder feil sjekksum" 'printf "%s" "$out" | grep -q "^fsm_backup_checksum_ok 0$"'

echo "→ Manglende backup"
mkdir -p "$TMP/empty"
set +e
out="$(BACKUP_DIR="$TMP/empty" bash "$SCRIPT" --prometheus 2>&1)"
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler uten backup" || fail "godtok tom mappe"
check "melder manglende backup" 'printf "%s" "$out" | grep -q "^fsm_backup_present 0$"'

echo "→ Krev ekstern kopi"
make_backup "$TMP/remote" 20261102-050000
set +e
out="$(BACKUP_DIR="$TMP/remote" REQUIRE_REMOTE_BACKUP=true bash "$SCRIPT" 2>&1)"
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler når ekstern kopi kreves" || fail "godtok manglende ekstern kopi"
check "forklarer manglende BACKUP_REMOTE" 'printf "%s" "$out" | grep -q "BACKUP_REMOTE"'

echo "→ Prometheus textfile"
make_backup "$TMP/textfile" 20261102-060000
BACKUP_DIR="$TMP/textfile" bash "$SCRIPT" \
  --prometheus-output "$TMP/textfile/fsm-backup.prom" >/dev/null
check "skriver textfile" '[ -s "$TMP/textfile/fsm-backup.prom" ]'
check "textfile har fersk-måling" \
  'grep -q "^fsm_backup_fresh 1$" "$TMP/textfile/fsm-backup.prom"'

if [ "$failures" -ne 0 ]; then
  echo "✖ $failures test(er) feilet." >&2
  exit 1
fi
echo "✓ Alle freshness-tester er grønne."
