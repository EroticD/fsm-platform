# Azure-assets

Minimale filer for å kjøre FSM-plattformen på én Azure VM med Docker Compose,
Caddy og en ekstern Azure Database for PostgreSQL Flexible Server. Full
steg-for-steg-veiledning ligger i [`docs/AZURE.md`](../../docs/AZURE.md).

## Filer

| Fil | Bruk |
| --- | --- |
| [`docker-compose.azure.yml`](./docker-compose.azure.yml) | App + Caddy. Ingen lokal PostgreSQL. Ekstern DB, opplastingsvolum, read-only rotfilsystem og readiness-healthcheck. |
| [`Caddyfile`](./Caddyfile) | TLS, sikkerhetsheadere, body-grenser og proxy til `app:3000`. Variant av `deploy/proxy/Caddyfile`. |
| [`azure.env.example`](./azure.env.example) | Mal for `/etc/fsm/azure.env` (ikke-hemmelig konfigurasjon og plassholdere). |
| [`fsm-fetch-secrets.sh`](./fsm-fetch-secrets.sh) | Henter apphemmeligheter fra Key Vault med managed identity og skriver `/etc/fsm/fsm.env` (0600). |
| [`fsm-compose.service`](./fsm-compose.service) | systemd-enhet som henter hemmeligheter og starter Compose ved boot. |
| [`cloud-init.yaml`](./cloud-init.yaml) | Valgfri vertsoppsett: Docker, Azure CLI, age, psql, swap og kataloger. |

## Forutsetninger

- Azure-abonnement med rettigheter til å opprette resource group, VNet, VM,
  PostgreSQL Flexible Server, Key Vault og Storage Account.
- Et domene du kan peke til VM-ens statiske offentlige IP. Caddy henter
  Let's Encrypt-sertifikat, så port 80 og 443 må være åpne.
- Ubuntu 24.04 LTS VM med minst 4 GB RAM. 8 GB anbefales for PDF/OCR og
  kundeimport. Se størrelsesdiskusjonen i `docs/AZURE.md`.
- Docker Engine + Compose-plugin (cloud-init installerer det).
- Publisert image i GHCR, pinnet til tag eller digest. Er pakken privat, trenger
  VM-en en read-only GitHub-token med `read:packages`.

## Rask start på VM-en

> Første gang må nettverk, database, roller, migrasjoner og Key Vault være satt
> opp. Følg [`docs/AZURE.md`](../../docs/AZURE.md) steg 1–7. Denne
> snarveien forutsetter at `DATABASE_URL`/`DATABASE_MIGRATION_URL` allerede
> ligger i Key Vault, og at migrasjonene er kjørt.

```bash
# 1. Klon repoet til den faste stien systemd-enheten forventer.
sudo git clone <repo-url> /opt/fsm-platform
sudo chown -R "$USER":"$USER" /opt/fsm-platform
cd /opt/fsm-platform

# 2. Legg systemd-enheten og hemmelighetshenteren på plass.
sudo install -m 755 deploy/azure/fsm-fetch-secrets.sh /usr/local/bin/
sudo install -m 644 deploy/azure/fsm-compose.service /etc/systemd/system/
sudo systemctl daemon-reload

# 3. Lag ikke-hemmelig konfigurasjon (0600 fordi filen kan inneholde URL-er).
sudo install -m 600 -o root -g root \
  deploy/azure/azure.env.example /etc/fsm/azure.env
sudoedit /etc/fsm/azure.env

# 4. Legg hemmelighetene i Key Vault (se docs/AZURE.md), og gi VM-ens
#    managed identity rollen «Key Vault Secrets User».

# 5. Start. Enheten henter hemmeligheter og kjører compose up -d.
sudo systemctl enable --now fsm-compose.service
sudo systemctl status fsm-compose.service
sudo journalctl -u fsm-compose.service -n 100 --no-pager
```

Etter første oppstart:

```bash
sudo docker compose \
  --env-file /etc/fsm/azure.env \
  --env-file /etc/fsm/fsm.env \
  -f deploy/azure/docker-compose.azure.yml ps

curl -fsS https://<domene>/api/health
curl -fsS https://<domene>/api/ready
```

## Key Vault-hemmeligheter

`fsm-fetch-secrets.sh` forventer disse navnene:

| Key Vault-navn | Miljøvariabel | Påkrevd |
| --- | --- | --- |
| `database-runtime-url` | `DATABASE_URL` | Ja |
| `database-migration-url` | `DATABASE_MIGRATION_URL` | Ja |
| `nextauth-secret` | `NEXTAUTH_SECRET` | Ja |
| `metrics-secret` | `METRICS_SECRET` | Nei |
| `ready-secret` | `READY_SECRET` | Nei |
| `cron-secret` | `CRON_SECRET` | Nei |
| `smtp-password` | `SMTP_PASS` | Nei |
| `sms-webhook-secret` | `SMS_WEBHOOK_SECRET` | Nei |
| `sms-linkmobility-api-key` | `SMS_LINKMOBILITY_API_KEY` | Nei |
| `sms-linkmobility-secret` | `SMS_LINKMOBILITY_SECRET` | Nei |
| `sms-pswincom-password` | `SMS_PSWINCOM_PASSWORD` | Nei |
| `sms-pswincom-secret` | `SMS_PSWINCOM_SECRET` | Nei |
| `sms-twilio-auth-token` | `SMS_TWILIO_AUTH_TOKEN` | Nei |
| `seed-admin-password` | `SEED_ADMIN_PASSWORD` | Nei |
| `sso-<leverandør>-client-secret` | `SSO_<LEVERANDØR>_CLIENT_SECRET` | Nei |
| `ghcr-token` | (kun `docker login`) | Nei |

DB-URL-ene må inneholde `sslmode=verify-full` (eller `require`). Passord i
URL-en må URL-kodes med mindre de er heksadesimale.

## Manuell kjøring og validering

Uten systemd, for feilsøking:

```bash
sudo /usr/local/bin/fsm-fetch-secrets.sh
sudo docker compose \
  --env-file /etc/fsm/azure.env \
  --env-file /etc/fsm/fsm.env \
  -f deploy/azure/docker-compose.azure.yml config --quiet
sudo docker compose \
  --env-file /etc/fsm/azure.env \
  --env-file /etc/fsm/fsm.env \
  -f deploy/azure/docker-compose.azure.yml up -d --remove-orphans
```

Valider Caddyfile og Compose lokalt uten Azure:

```bash
docker run --rm -e FSM_DOMAIN=fsm.example.no \
  -v "$PWD/deploy/azure/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker compose --env-file deploy/azure/azure.env.example \
  -f deploy/azure/docker-compose.azure.yml config --quiet
```

## Viktige begrensninger

- **Én app-replika.** PDF/OCR, SMS, påminnelser og serviceavtaler kjører som
  in-process workers. Skalering krever egen worker-prosess og Redis (eller
  tilsvarende), se `docs/AZURE.md`.
- **Opplastinger ligger på VM-ens managed disk.** `UPLOAD_DIR` er et lokalt
  volum i `/app/uploads`. Blob Storage brukes til offsite backup, ikke som
  primærlagring. Appen har ingen S3-driver i denne versjonen.
- **Backup skriptes separat.** `scripts/backup.sh` forutsetter en lokal
  `postgres`-tjeneste i Compose og passer ikke direkte mot Flexible Server. Bruk
  Azure PITR og en egen `pg_dump`-jobb til Blob; se `docs/AZURE.md`.
- **Hemmeligheter skal aldri i git.** `/etc/fsm/azure.env` og
  `/etc/fsm/fsm.env` er 0600. Sjekk med `git check-ignore`.
