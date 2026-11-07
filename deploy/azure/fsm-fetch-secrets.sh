#!/usr/bin/env bash
#
# Henter apphemmeligheter fra Azure Key Vault og skriver en 0600-envfil for
# Docker Compose. Kjøres som root av fsm-compose.service før `compose up`.
#
# Forutsetninger:
#   - az CLI er installert
#   - VM-en har system-assigned managed identity (eller AZURE_CLIENT_ID for
#     user-assigned) med rollen «Key Vault Secrets User» på vaulten
#   - /etc/fsm/azure.env inneholder KEY_VAULT_URL (ikke-hemmelig konfig)
#
# Skriver:
#   /etc/fsm/fsm.env            apphemmeligheter (0600, root)
#   /root/.docker/config.json   valgfri GHCR-innlogging (0600, root)
#
# Skriver aldri hemmeligheter til stdout. Feiler lukket hvis en påkrevd
# hemmelighet mangler.

set -euo pipefail
umask 077

ENV_FILE="${ENV_FILE:-/etc/fsm/fsm.env}"
AZURE_ENV_FILE="${AZURE_ENV_FILE:-/etc/fsm/azure.env}"

die() {
  echo "✖ $*" >&2
  exit 1
}

command -v az >/dev/null 2>&1 || die "az CLI mangler. Installer azure-cli."
command -v docker >/dev/null 2>&1 || die "docker mangler."

# Les bare enkle, ikke-hemmelige nøkler fra azure.env. Filen kan inneholde
# URL-er med & og andre tegn, så den skal ikke sources som shell.
read_env_value() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 \
    | cut -d= -f2- | tr -d '\r' \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    || true
}

KEY_VAULT_URL="${KEY_VAULT_URL:-$(read_env_value KEY_VAULT_URL "$AZURE_ENV_FILE")}"
AZURE_CLIENT_ID="${AZURE_CLIENT_ID:-$(read_env_value AZURE_CLIENT_ID "$AZURE_ENV_FILE")}"
GHCR_USER="${GHCR_USER:-$(read_env_value GHCR_USER "$AZURE_ENV_FILE")}"

[ -n "$KEY_VAULT_URL" ] || die "KEY_VAULT_URL mangler i $AZURE_ENV_FILE."
VAULT_NAME="$(printf '%s' "$KEY_VAULT_URL" | sed -E 's#^https://([^.]+)\..*#\1#')"
[ -n "$VAULT_NAME" ] && [ "$VAULT_NAME" != "$KEY_VAULT_URL" ] \
  || die "KEY_VAULT_URL må se ut som https://<vault>.vault.azure.net."

echo "→ Logger inn med managed identity ..."
if [ -n "$AZURE_CLIENT_ID" ]; then
  az login --identity --username "$AZURE_CLIENT_ID" --only-show-errors >/dev/null
else
  az login --identity --only-show-errors >/dev/null
fi

install -d -m 0700 -o root -g root "$(dirname "$ENV_FILE")"

TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

{
  echo "# Generert av fsm-fetch-secrets.sh fra Azure Key Vault."
  echo "# Inneholder hemmeligheter. Skal være 0600 og eies av root."
} >"$TMP_FILE"

write_var() {
  local name="$1" value="$2"
  case "$value" in
    *$'\n'*|*$'\r'*) die "$name inneholder linjeskift." ;;
  esac
  # Dobbeltsitatte verdier tåler mellomrom og #. Escap tegn som Compose tolker.
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  printf '%s="%s"\n' "$name" "$value" >>"$TMP_FILE"
}

get_secret() {
  az keyvault secret show \
    --vault-name "$VAULT_NAME" \
    --name "$1" \
    --query value \
    --output tsv \
    --only-show-errors
}

required() {
  local secret="$1" env_name="$2" value
  if ! value="$(get_secret "$secret" 2>/dev/null)"; then
    die "Mangler påkrevd Key Vault-hemmelighet: $secret"
  fi
  [ -n "$value" ] || die "Key Vault-hemmeligheten $secret er tom."
  write_var "$env_name" "$value"
}

optional() {
  local secret="$1" env_name="$2" value
  value="$(get_secret "$secret" 2>/dev/null || true)"
  [ -n "$value" ] && write_var "$env_name" "$value"
  return 0
}

# Påkrevd for at appen skal starte.
required database-runtime-url DATABASE_URL
required database-migration-url DATABASE_MIGRATION_URL
required nextauth-secret NEXTAUTH_SECRET

# Anbefalt, men kan være tom i en minimal installasjon.
optional metrics-secret METRICS_SECRET
optional ready-secret READY_SECRET
optional cron-secret CRON_SECRET
optional smtp-password SMTP_PASS
optional sms-webhook-secret SMS_WEBHOOK_SECRET
optional sms-linkmobility-api-key SMS_LINKMOBILITY_API_KEY
optional sms-linkmobility-secret SMS_LINKMOBILITY_SECRET
optional sms-pswincom-password SMS_PSWINCOM_PASSWORD
optional sms-pswincom-secret SMS_PSWINCOM_SECRET
optional sms-twilio-auth-token SMS_TWILIO_AUTH_TOKEN
optional seed-admin-password SEED_ADMIN_PASSWORD

# SSO: legg til én secret per leverandør, f.eks. sso-entra-client-secret.
# Sluggen gjøres om til SSO_<SLUG>_CLIENT_SECRET.
for provider in entra keycloak authentik zitadel; do
  upper="$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')"
  optional "sso-${provider}-client-secret" "SSO_${upper}_CLIENT_SECRET"
done

install -m 600 -o root -g root "$TMP_FILE" "$ENV_FILE"
echo "✔ Skrev $ENV_FILE (0600)."

# Valgfri GHCR-innlogging. Tokenet skrives ikke til env-filen.
if ghcr_token="$(get_secret ghcr-token 2>/dev/null)" && [ -n "$ghcr_token" ]; then
  [ -n "$GHCR_USER" ] || die "ghcr-token finnes, men GHCR_USER mangler i $AZURE_ENV_FILE."
  printf '%s' "$ghcr_token" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  echo "✔ Logget inn mot ghcr.io som $GHCR_USER."
fi
