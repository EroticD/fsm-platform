# HA-profil (flere app-replikaer)

`docker-compose.ha.yml` er en søsken til `docker-compose.prod.yml` for
installasjoner som trenger mer enn én app-prosess. Den krever ekstern eller
delt S3/MinIO og Redis.

## Start

```bash
# .env: DATABASE_RUNTIME_URL, NEXTAUTH_SECRET, S3_*, REDIS_URL, FSM_DOMAIN ...
docker compose -f docker-compose.ha.yml up -d --scale app=3

docker compose -f docker-compose.ha.yml ps
curl -fsS "https://$FSM_DOMAIN/api/health"
curl -fsS -H "Authorization: Bearer $READY_SECRET" "https://$FSM_DOMAIN/api/ready"
```

## Krav

- **S3/MinIO**: bucket med versjonering, kryptering og blokkert offentlig
  tilgang. `STORAGE_DRIVER=s3` er standard i profilen.
- **Redis**: `redis://redis:6379/0` i profilen, eller ekstern med TLS.
  `QUEUE_DRIVER`, `CACHE_DRIVER` og `RATE_LIMIT_DRIVER` er `redis`.
- **Postgres**: `max_connections` må være større enn
  `APP_REPLICAS × DATABASE_POOL_MAX + margin`.
- **Caddy**: `FSM_DOMAIN` må peke på verten, og port 80/443 må være åpne.
  `ACME_EMAIL` er valgfri.

## Test lokalt med MinIO

```bash
export MINIO_ROOT_USER=fsm
export MINIO_ROOT_PASSWORD='<minst 8 tegn>'
export S3_BUCKET=fsm-uploads
export S3_ENDPOINT=http://minio:9000
export S3_ACCESS_KEY_ID="$MINIO_ROOT_USER"
export S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD"
export S3_FORCE_PATH_STYLE=true
docker compose -f docker-compose.ha.yml --profile minio up -d
# Opprett bucket (én gang):
docker compose -f docker-compose.ha.yml exec minio \
  mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
docker compose -f docker-compose.ha.yml exec minio \
  mc mb --ignore-existing local/fsm-uploads
```

## Backup og PITR

```bash
docker compose -f docker-compose.ha.yml --profile backup \
  run --rm postgres-basebackup
```

Se `deploy/postgres/pitr/README.md` for WAL-arkiv, restore og
kvartalsøvelse. WAL-arkivet og base-backupene ligger i named volumes og må
kopieres offsite; en volume på samme VM er ikke DR.

## Begrensninger

- Compose har ingen automatisk failover for Postgres. For ekte HA på
  databasen brukes en managed tjeneste med replika/failover (Azure Flexible
  Server, Patroni, Cloud SQL e.l.). Denne profilen dekker app-laget, delt
  lagring, kø/cache og PITR-verktøy.
- In-process workere kjører i hver replika. Det er trygt fordi jobbene er
  idempotente og låses i databasen, men en egen worker-tjeneste er bedre ved
  svært høy PDF-/OCR-last.
- Lasttest og reell S3/Redis-verifisering krever et testmiljø med
  legitimasjon. Se `docs/SCALING.md`.
