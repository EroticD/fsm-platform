#!/usr/bin/env bash
#
# Regresjonstest for scripts/restore-test.sh uten Docker, PostgreSQL eller age.
# Stubber docker/age og bruker en liten SQL-dump. Kjøres med:
#
#   bash scripts/tests/restore-test.test.sh
#
# Testen dekker:
#   - ukryptert .sql.gz
#   - age-kryptert .sql.gz.age (standard AGE_IDENTITY)
#   - verifisering av kryptert opplastingsarkiv
#   - avvisning av manglende nøkkel og ukjent format
#   - at midlertidig database ryddes via EXIT-trap

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/restore-test.sh"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/backups" "$TMP/home/.config/age" "$TMP/data"
export PATH="$TMP/bin:$PATH"
export HOME="$TMP/home"

cat >"$HOME/.config/age/keys.txt" <<'KEY'
test-key
KEY

# --- stubber ---------------------------------------------------------------
cat >"$TMP/bin/age" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "--decrypt" ] || { echo "stub age: bare --decrypt støttes" >&2; exit 2; }
shift
[ "${1:-}" = "--identity" ] || { echo "stub age: mangler --identity" >&2; exit 2; }
ident="$2"
input="$3"
[ -f "$ident" ] || { echo "stub age: ukjent identitet" >&2; exit 1; }
grep -qx 'test-key' "$ident" || { echo "stub age: feil nøkkel" >&2; exit 1; }
# Simulerer en kryptert konvolutt: første linje er header, resten er payload.
tail -n +2 "$input"
STUB

cat >"$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "compose" ] && shift
[ "${1:-}" = "exec" ] && shift
[ "${1:-}" = "-T" ] && shift
[ "${1:-}" = "postgres" ] && shift
cmd="${1:-}"
shift || true
case "$cmd" in
  dropdb|createdb) exit 0 ;;
  psql)
    case "$*" in
      *'SELECT count(*) FROM "User";'*) echo 4 ;;
      *'SELECT count(*) FROM "Customer";'*) echo 6 ;;
      *'_prisma_migrations'*) echo 8 ;;
      *) cat >/dev/null ;;
    esac
    ;;
  *) echo "stub docker: uventet kommando: $cmd $*" >&2; exit 1 ;;
esac
STUB

chmod +x "$TMP/bin/age" "$TMP/bin/docker"

# --- fixtures --------------------------------------------------------------
cat >"$TMP/plain.sql" <<'SQL'
CREATE TABLE "User" (id int);
CREATE TABLE "Customer" (id int);
CREATE TABLE "_prisma_migrations" (id int);
SQL

gzip -c "$TMP/plain.sql" >"$TMP/backups/db-20260101-000000.sql.gz"
{ printf 'FAKE-AGE-V1\n'; gzip -c "$TMP/plain.sql"; } \
  >"$TMP/backups/db-20260102-000000.sql.gz.age"

printf 'vedlegg\n' >"$TMP/data/attachment.txt"
tar czf "$TMP/uploads.tar.gz" -C "$TMP/data" .
{ printf 'FAKE-AGE-V1\n'; cat "$TMP/uploads.tar.gz"; } \
  >"$TMP/backups/uploads-20260102-000000.tar.gz.age"

failures=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✖ $*" >&2; failures=$((failures + 1)); }
assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -Fq "$needle"; then pass "$label"; else
    fail "$label (mangler: $needle)"; printf '%s\n' "$haystack" >&2
  fi
}

# --- tester ----------------------------------------------------------------
echo "→ Ukryptert .sql.gz"
out="$(BACKUP_FILE="$TMP/backups/db-20260101-000000.sql.gz" \
  UPLOADS_FILE="$TMP/uploads.tar.gz" TEST_DB=fsm_restore_test \
  bash "$SCRIPT" 2>&1)"
assert_contains "$out" "Brukere:     4" "leser brukere"
assert_contains "$out" "Opplastinger: 1 filer" "verifiserer opplastinger"
assert_contains "$out" "Restore-test fullført" "fullfører"

echo "→ age-kryptert .sql.gz.age"
out="$(BACKUP_FILE="$TMP/backups/db-20260102-000000.sql.gz.age" \
  UPLOADS_FILE="$TMP/backups/uploads-20260102-000000.tar.gz.age" \
  TEST_DB=fsm_restore_test bash "$SCRIPT" 2>&1)"
assert_contains "$out" "Kunder:      6" "dekrypterer database"
assert_contains "$out" "Opplastinger: 1 filer" "dekrypterer opplastinger"
assert_contains "$out" "Restore-test fullført" "fullfører kryptert"

echo "→ Manglende age-identitet"
set +e
out="$(BACKUP_FILE="$TMP/backups/db-20260102-000000.sql.gz.age" \
  UPLOADS_FILE="$TMP/uploads.tar.gz" AGE_IDENTITY="$TMP/missing-key.txt" \
  TEST_DB=fsm_restore_test bash "$SCRIPT" 2>&1)"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "feiler uten nøkkel"; else fail "feilet ikke uten nøkkel"; fi
assert_contains "$out" "AGE_IDENTITY" "forklarer manglende nøkkel"

echo "→ Ukjent format"
set +e
cp "$TMP/plain.sql" "$TMP/backup.txt"
out="$(BACKUP_FILE="$TMP/backup.txt" TEST_DB=fsm_restore_test bash "$SCRIPT" 2>&1)"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "avviser ukjent format"; else fail "avviste ikke ukjent format"; fi
assert_contains "$out" "Ukjent backupformat" "forklarer ukjent format"

echo "→ TEST_DB lik produksjonsdatabasen"
set +e
out="$(BACKUP_FILE="$TMP/backups/db-20260101-000000.sql.gz" \
  POSTGRES_DB=fsm_db TEST_DB=fsm_db bash "$SCRIPT" 2>&1)"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "nekter å overskrive produksjonsdatabasen"; else
  fail "overskrev produksjonsdatabasen"
fi

if [ "$failures" -ne 0 ]; then
  echo "✖ $failures test(er) feilet." >&2
  exit 1
fi
echo "✓ Alle restore-test-tester er grønne."
