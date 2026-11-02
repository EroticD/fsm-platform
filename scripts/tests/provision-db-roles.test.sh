#!/usr/bin/env bash
#
# Tester scripts/provision-db-roles.sh uten Docker/PostgreSQL. Stubber docker
# og kontrollerer at SQL-en inneholder DML-grants, DDL-vern og at passord ikke
# sendes på kommandolinjen.
#
#   bash scripts/tests/provision-db-roles.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/provision-db-roles.sh"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/bin"
cat >"$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >"$TMP/docker.args"
cat >"$TMP/sql.stdin"
STUB
chmod +x "$TMP/bin/docker"

failures=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✖ $*" >&2; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

echo "→ Provisionerer roller"
PATH="$TMP/bin:$PATH" \
  MIGRATION_PASSWORD="migrator-hemmelighet" \
  RUNTIME_PASSWORD="runtime-hemmelighet" \
  REASSIGN_OWNER=admin \
  bash "$SCRIPT" >/dev/null

check "psql ble kalt" 'grep -q " postgres psql" "$TMP/docker.args"'
check "passord er ikke på kommandolinjen" \
  '! grep -q "hemmelighet" "$TMP/docker.args"'
check "passord sendes som miljøvariabel" \
  'grep -q -- "-e FSM_MIGRATION_PASSWORD" "$TMP/docker.args"'
check "SQL gir DML til runtime" \
  'grep -q "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES" "$TMP/sql.stdin"'
check "SQL beskytter AuditLog" \
  'grep -q "REVOKE UPDATE, DELETE, TRUNCATE ON TABLE" "$TMP/sql.stdin"'
check "SQL beskytter migrasjonstabellen" \
  'grep -q "REVOKE ALL ON TABLE" "$TMP/sql.stdin"'
check "SQL fjerner CREATE fra public" \
  'grep -q "REVOKE CREATE ON SCHEMA public FROM PUBLIC" "$TMP/sql.stdin"'
check "REASSIGN_OWNER sendes videre" \
  'grep -q -- "-v reassign_owner=admin" "$TMP/docker.args"'

echo "→ Manglende passord"
set +e
PATH="$TMP/bin:$PATH" MIGRATION_PASSWORD="x" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler uten RUNTIME_PASSWORD" || fail "godtok manglende passord"

echo "→ Ugyldig rollenavn"
set +e
PATH="$TMP/bin:$PATH" MIGRATION_PASSWORD="x" RUNTIME_PASSWORD="y" \
  RUNTIME_ROLE='fsm_app; DROP TABLE "User"' bash "$SCRIPT" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "avviser SQL i rollenavn" || fail "godtok ugyldig rollenavn"

if [ "$failures" -ne 0 ]; then
  echo "✖ $failures test(er) feilet." >&2
  exit 1
fi
echo "✓ Alle provision-tester er grønne."
