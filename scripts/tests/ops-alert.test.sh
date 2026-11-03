#!/usr/bin/env bash
#
# Tester scripts/ops-alert.sh uten nettverk. Stubber curl og kontrollerer at
# payloaden er gyldig JSON-aktig og at manglende kanal feiler tydelig.
#
#   bash scripts/tests/ops-alert.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ops-alert.sh"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/bin"
cat >"$TMP/bin/curl" <<STUB
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >"$TMP/curl.log"
# Skriv payloaden (siste argument etter --data) til egen fil.
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --data) shift; printf '%s' "\${1:-}" >"$TMP/payload.json" ;;
  esac
  shift
done
STUB
chmod +x "$TMP/bin/curl"

failures=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✖ $*" >&2; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

echo "→ Testvarsel via webhook"
PATH="$TMP/bin:$PATH" ALERT_WEBHOOK_URL="https://example.invalid/hook" \
  bash "$SCRIPT" --test >/dev/null
check "curl ble kalt" '[ -s "$TMP/curl.log" ]'
check "payload har testtittel" 'grep -q "TEST: FSM varslingskanal" "$TMP/payload.json"'
if grep -Fq '"severity":"info"' "$TMP/payload.json"; then
  pass "payload har info-nivå"
else
  fail "payload har info-nivå"
fi
if grep -Fq '"host"' "$TMP/payload.json"; then
  pass "payload har vert"
else
  fail "payload har vert"
fi

echo "→ Slack-format"
PATH="$TMP/bin:$PATH" ALERT_WEBHOOK_URL="https://example.invalid/hook" \
  ALERT_WEBHOOK_FORMAT=slack bash "$SCRIPT" warning "disk" "80 % full" >/dev/null
if grep -Fq '"text"' "$TMP/payload.json"; then
  pass "slack-payload har text"
else
  fail "slack-payload har text"
fi

echo "→ Manglende kanal"
set +e
PATH="$TMP/bin:$PATH" bash "$SCRIPT" warning "x" "y" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] && pass "feiler uten ALERT_WEBHOOK_URL" || fail "godtok manglende kanal"

echo "→ Dry run"
set +e
out="$(ALERT_DRY_RUN=true bash "$SCRIPT" --test 2>&1)"
rc=$?
set -e
[ "$rc" -eq 0 ] && pass "dry run returnerer 0" || fail "dry run returnerte $rc"
check "dry run skriver payload" 'printf "%s" "$out" | grep -q "TEST: FSM varslingskanal"'

if [ "$failures" -ne 0 ]; then
  echo "✖ $failures test(er) feilet." >&2
  exit 1
fi
echo "✓ Alle varseltester er grønne."
