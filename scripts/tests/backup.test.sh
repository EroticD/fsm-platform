#!/usr/bin/env bash
#
# Regresjonstest for scripts/backup.sh uten Docker og age. Stubber docker/age
# og kontrollerer at:
#   - ukryptert backup gir db-*.sql.gz og uploads-*.tar.gz
#   - BACKUP_AGE_RECIPIENT gir bare .age-filer (ingen ukryptert fil på disk)
#   - en feilende pg_dump ikke etterlater en halvskrevet fil
#
#   bash scripts/tests/backup.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup.sh"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/uploads"
export PATH="$TMP/bin:$PATH"
printf 'hei\n' >"$TMP/uploads/fil.txt"

cat >"$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  compose)
    # docker compose exec -T postgres pg_dump ...
    if [ "\${FAIL_DB:-false}" = "true" ]; then exit 1; fi
    printf 'SELECT 1;\\n'
    ;;
  volume)
    [ "\${2:-}" = "ls" ] && echo "prosjekt_fsm_uploads"
    ;;
  run)
    tar czf - -C "$TMP/uploads" .
    ;;
  *) echo "stub docker: uventet: \$*" >&2; exit 1 ;;
esac
STUB

cat >"$TMP/bin/age" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "--recipient" ] || exit 2
[ "${2:-}" = "age1test" ] || exit 2
[ "${3:-}" = "--output" ] || exit 2
# Simulerer kryptert konvolutt: header + payload.
{ printf 'FAKE-AGE-V1\n'; cat; } >"$4"
STUB

cat >"$TMP/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
src="${2:-}"
# Feiler hvis kilden inneholder noe annet enn .age-filer. Da beviser testen at
# ekstern kopi bare skjer etter vellykket kryptering.
for f in "$src"/*; do
  [ -e "$f" ] || continue
  case "$f" in
    *.age) ;;
    *) echo "rclone: ukryptert fil i kilden: $f" >&2; exit 3 ;;
  esac
done
printf '%s\n' "$*" >>"${RCLONE_LOG:-/dev/null}"
STUB

chmod +x "$TMP/bin/docker" "$TMP/bin/age" "$TMP/bin/rclone"

failures=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✖ $*" >&2; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

echo "→ Ukryptert backup"
BACKUP_DIR="$TMP/plain" bash "$SCRIPT" >/dev/null
check "databasebackup finnes" 'ls "$TMP"/plain/db-*.sql.gz >/dev/null 2>&1'
check "opplastingsarkiv finnes" 'ls "$TMP"/plain/uploads-*.tar.gz >/dev/null 2>&1'
check "databasebackup er gyldig gzip" \
  'gunzip -t "$TMP"/plain/db-*.sql.gz >/dev/null 2>&1'
check "opplastingsarkiv er gyldig tar.gz" \
  'tar tzf "$TMP"/plain/uploads-*.tar.gz >/dev/null 2>&1'
check "ingen .age-filer uten mottaker" \
  '! ls "$TMP"/plain/*.age >/dev/null 2>&1'

echo "→ Kryptert backup"
BACKUP_DIR="$TMP/enc" BACKUP_AGE_RECIPIENT=age1test bash "$SCRIPT" >/dev/null
check "kryptert databasebackup finnes" 'ls "$TMP"/enc/db-*.sql.gz.age >/dev/null 2>&1'
check "kryptert opplastingsarkiv finnes" 'ls "$TMP"/enc/uploads-*.tar.gz.age >/dev/null 2>&1'
check "ingen ukryptert database på disk" \
  '! ls "$TMP"/enc/db-*.sql.gz >/dev/null 2>&1'
check "ingen ukryptert arkiv på disk" \
  '! ls "$TMP"/enc/uploads-*.tar.gz >/dev/null 2>&1'
check "payload er gyldig gzip etter header" \
  'tail -n +2 "$TMP"/enc/db-*.sql.gz.age | gunzip -t >/dev/null 2>&1'
check "backupene er ikke verdenslesbare" \
  '[ "$(stat -c %a "$TMP"/enc/db-*.sql.gz.age)" = "600" ]'

echo "→ Produksjon krever kryptering"
set +e
BACKUP_DIR="$TMP/prod-no-age" NODE_ENV=production bash "$SCRIPT" >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "NODE_ENV=production uten mottaker feiler"; else fail "returnerte 0 uten mottaker"; fi
check "avbryter før backupmappen opprettes" '! [ -e "$TMP/prod-no-age" ]'

echo "→ REQUIRE_BACKUP_ENCRYPTION krever kryptering"
set +e
BACKUP_DIR="$TMP/require-no-age" REQUIRE_BACKUP_ENCRYPTION=true bash "$SCRIPT" >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "REQUIRE_BACKUP_ENCRYPTION=true uten mottaker feiler"; else fail "returnerte 0 uten mottaker"; fi
check "avbryter før backupmappen opprettes" '! [ -e "$TMP/require-no-age" ]'

echo "→ Ekstern kopi bare etter kryptering"
RCLONE_LOG="$TMP/rclone.log" BACKUP_DIR="$TMP/remote" \
  BACKUP_AGE_RECIPIENT=age1test BACKUP_REMOTE=remote:test \
  bash "$SCRIPT" >/dev/null
check "rclone fikk backupmålet" 'grep -q "remote:test" "$TMP/rclone.log"'
check "bare .age-filer ligger i kilden" \
  '! find "$TMP/remote" -maxdepth 1 -type f ! -name "*.age" -print -quit | grep -q .'

echo "→ Feilende pg_dump"
set +e
BACKUP_DIR="$TMP/fail" FAIL_DB=true bash "$SCRIPT" >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "returnerer feil"; else fail "returnerte 0"; fi
check "etterlater ingen halvskrevet fil" \
  '! ls "$TMP"/fail/db-* >/dev/null 2>&1'

if [ "$failures" -ne 0 ]; then
  echo "✖ $failures test(er) feilet." >&2
  exit 1
fi
echo "✓ Alle backup-tester er grønne."
