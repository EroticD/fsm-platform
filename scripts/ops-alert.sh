#!/usr/bin/env bash
#
# Sender driftsvarsel til ALERT_WEBHOOK_URL. Brukes av systemd sine
# OnFailure=fsm-alert@%n.service-enheter og kan testes manuelt:
#
#   ALERT_WEBHOOK_URL=https://... ./scripts/ops-alert.sh --test
#   ALERT_WEBHOOK_URL=https://... ./scripts/ops-alert.sh critical "backup" "Feilet"
#
# Miljøvariabler:
#   ALERT_WEBHOOK_URL       påkrevd (med mindre ALERT_DRY_RUN=true)
#   ALERT_WEBHOOK_FORMAT    generic (standard), alertmanager eller slack
#   ALERT_DRY_RUN           true skriver bare payload til stdout
#   CURL_BIN                alternativ curl-binær (brukes av tester)
#
# Payloaden inneholder vert, tid, alvorlighetsgrad og melding – aldri
# hemmeligheter eller persondata. Skriptet feiler hvis webhooken ikke er
# konfigurert, slik at en glemt varslingskanal ikke blir stille.

set -euo pipefail

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
}

json_escape() {
  printf '%s' "$1" \
    | tr '\n' ' ' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--test" ]; then
  shift
  SEVERITY="info"
  SUBJECT="TEST: FSM varslingskanal"
  MESSAGE="Dette er en testvarsling fra FSM-plattformen. Hvis du ser den, virker kanalen."
else
  SEVERITY="${1:-warning}"
  SUBJECT="${2:-FSM-varsel}"
  MESSAGE="${3:-Ingen melding oppgitt.}"
fi

case "$SEVERITY" in
  info|warning|critical|test) ;;
  *) echo "✖ Ukjent alvorlighetsgrad: $SEVERITY" >&2; exit 2 ;;
esac

HOST="$(hostname 2>/dev/null || echo ukjent)"
TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FORMAT="${ALERT_WEBHOOK_FORMAT:-generic}"

case "$FORMAT" in
  generic)
    PAYLOAD="{\"title\":\"$(json_escape "$SUBJECT")\",\"message\":\"$(json_escape "$MESSAGE")\",\"severity\":\"$SEVERITY\",\"host\":\"$(json_escape "$HOST")\",\"time\":\"$TIME\",\"source\":\"fsm-platform\"}"
    ;;
  alertmanager)
    PAYLOAD="{\"version\":\"4\",\"status\":\"firing\",\"alerts\":[{\"status\":\"firing\",\"labels\":{\"alertname\":\"$(json_escape "$SUBJECT")\",\"severity\":\"$SEVERITY\",\"instance\":\"$(json_escape "$HOST")\"},\"annotations\":{\"summary\":\"$(json_escape "$MESSAGE")\"},\"startsAt\":\"$TIME\"}]}"
    ;;
  slack)
    PAYLOAD="{\"text\":\"*$(json_escape "$SUBJECT")* [$SEVERITY] $(json_escape "$MESSAGE") ($(json_escape "$HOST"))\"}"
    ;;
  *)
    echo "✖ Ukjent ALERT_WEBHOOK_FORMAT: $FORMAT" >&2
    exit 2
    ;;
esac

if [ "${ALERT_DRY_RUN:-false}" = "true" ]; then
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

URL="${ALERT_WEBHOOK_URL:-}"
if [ -z "$URL" ]; then
  echo "✖ ALERT_WEBHOOK_URL er ikke satt. Sett den, eller bruk ALERT_DRY_RUN=true." >&2
  exit 2
fi

CURL="${CURL_BIN:-curl}"
command -v "$CURL" >/dev/null 2>&1 || {
  echo "✖ Fant ikke curl. Installer curl eller sett CURL_BIN." >&2
  exit 2
}

"$CURL" -fsS --max-time 10 \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD" \
  "$URL" >/dev/null

echo "✓ Varsel sendt ($SEVERITY): $SUBJECT"
