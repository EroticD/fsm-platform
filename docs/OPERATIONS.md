# Drift og feilsøking

## Produksjonssett: image-pinning

Produksjon bruker `docker-compose.prod.yml`. Der er `APP_IMAGE` **påkrevd**:

```dotenv
APP_IMAGE=ghcr.io/eroticd/fsm-platform:0.7.1
POSTGRES_IMAGE=postgres:15.13
```

- Pinn `APP_IMAGE` til en publisert release-tag, aldri `latest`. Da vet du
  nøyaktig hvilken kode som kjører, og en rollback er bare å bytte tag.
- Vil du være helt sikker på at taggen ikke flyttes, pinn til digest:

  ```bash
  docker pull ghcr.io/eroticd/fsm-platform:0.7.1
  docker inspect --format='{{index .RepoDigests 0}}' \
    ghcr.io/eroticd/fsm-platform:0.7.1
  # APP_IMAGE=ghcr.io/eroticd/fsm-platform@sha256:<digest>
  ```

- Pinn Postgres til en konkret 15.x-minor (`postgres:15.13`) eller digest.
  Sjekk nyeste 15.x på Docker Hub før du setter verdien; ikke la den rullende
  `15`-taggen oppdatere seg selv i produksjon. Et majorbytte (15 → 16) krever
  dump/restore eller `pg_upgrade` – det er ikke nok å bytte image.
- Etter endring i `.env`: `docker compose -f docker-compose.prod.yml config
  --images` for å se hvilke image-referanser som faktisk brukes, deretter
  `pull` og `up -d`.

## Minne og swap (1 GB Droplet)

Compose-grensene er dimensjonert for en 1 GB Droplet:

| Tjeneste | `mem_limit` | Merknad |
| --- | --- | --- |
| `app` | 700 MB | `NODE_OPTIONS=--max-old-space-size=384`, `/tmp` 160 MB og `.next/cache` 96 MB tmpfs |
| `postgres` | 300 MB | `shared_buffers=96MB`, `work_mem=4MB`, `max_connections=50` |

Sammen med OS og dockerd er dette mer enn 1 GB. **Ha minst 2 GB swap:**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Sjekk med `free -h`, `docker stats` og `dmesg -T | grep -i oom`. Blir appen
drept av OOM, øk `mem_limit` og `--max-old-space-size` litt – ikke fjern
grensene. Vedvarende høy last bør heller flyttes til en 2 GB-instans; det gir
bedre margin enn å presse 1 GB-maskinen.

`/tmp` er tmpfs for OCR og PDF. Store PDF-er kan fylle den; da feiler jobben
uten å fylle rotfilsystemet. Juster `tmpfs`-størrelsen bevisst hvis dere
behandler større filer.

## Helse og readiness

- `GET /api/health` — **liveness**. Billig: svarer 200 når Node-prosessen
  lever, uten database-, disk- eller køkall. Docker-healthchecken i imaget
  bruker denne, slik at en treg database ikke gir restart-løkke.
- `GET /api/ready` — **readiness**. Uautentiserte kall får en kort status og en
  billig databasekontroll (rate-limitert per IP). Med `READY_SECRET` eller
  `CRON_SECRET` sjekkes også skrivbart opplastingsvolum og jobbkøen, og
  detaljene returneres. Returnerer 503 når noe mangler.

`docker-compose.prod.yml` overstyrer image-healthchecken med readiness mot
`/api/ready` (Node `fetch`, siden imaget ikke har curl). Readiness gjør
containeren «unhealthy», men **restart-policyen restarter den ikke**. Et
databaseutfall gir dermed 503 fra proxyen i stedet for en restart-løkke.

Bruk `/api/ready` fra orchestratoren før trafikk sendes til instansen. Begge
svarer med `requestId`, slik at loggen kan korreleres med forespørselen.
Proxyen setter `x-request-id` på alle svar.

### Readiness-drill

Kjør denne etter hver større endring i compose/proxy:

```bash
docker compose -f docker-compose.prod.yml ps
docker inspect --format '{{.State.Health.Status}}' "$(docker compose \
  -f docker-compose.prod.yml ps -q app)"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null && echo liveness-ok
curl -fsS http://127.0.0.1:3000/api/ready   # 200 og {"status":"ready"}

# Simuler databaseutfall:
docker compose -f docker-compose.prod.yml stop postgres
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ready  # 503
docker compose -f docker-compose.prod.yml ps        # app: (unhealthy)
docker inspect --format '{{.RestartCount}}' "$(docker compose \
  -f docker-compose.prod.yml ps -q app)"             # uendret

docker compose -f docker-compose.prod.yml start postgres
# Vent til Postgres er healthy, og bekreft at appen blir healthy igjen.
```

Ved oppstart venter Composes `depends_on` på at Postgres er healthy. En
`--wait` som feiler på en midlertidig readiness-503 skal ikke tolkes som at
appen er død – sjekk `/api/health`, logger og Postgres før du restarter.

## Logger

Loggene er JSON-linjer:

```json
{"time":"2026-10-24T08:00:00.000Z","level":"info","message":"...","requestId":"...","userId":"..."}
```

`LOG_LEVEL` styrer nivået (`debug`, `info`, `warn`, `error`; standard `info`).
Bruk `logger.info/warn/error` fra `src/lib/logger.ts` i ny kode. Eldre
`console.*`-kall migreres gradvis.

Compose roterer Docker-loggen per tjeneste (`max-size: 10m`, `max-file: 3`),
altså maks ca. 30 MB per tjeneste. Har dere byttet til `journald`-driver, må
`/etc/systemd/journald.conf` begrenses (`SystemMaxUse=...`) i stedet. Sjekk
diskbruken med:

```bash
df -h /
docker system df
```

## Migrasjoner

Appen kjører `prisma migrate deploy` ved oppstart. For å kjøre migrasjonene som
et eget steg:

```bash
SKIP_MIGRATIONS=true docker compose -f docker-compose.prod.yml up -d app
docker compose -f docker-compose.prod.yml run --rm app \
  node ./node_modules/prisma/build/index.js migrate deploy
```

Bruk alltid `prisma migrate deploy` i produksjon — aldri `prisma db push`.
Verifiser skjemaet med:

```bash
npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code
```

### Trygg migrasjonsport i produksjon

Anbefalt i produksjon: sett `REQUIRE_BACKUP_BEFORE_MIGRATE=true` i `.env`. Da
nekter oppstartsskriptet å kjøre migrasjoner før du har tatt backup og starter
med `BACKUP_CONFIRMED=true`:

```bash
./scripts/backup.sh
./scripts/restore-test.sh   # verifiser database og opplastinger
BACKUP_CONFIRMED=true docker compose -f docker-compose.prod.yml up -d app
```

Standard er `false`, slik at lokal utvikling og eksisterende oppsett ikke
endres. `BACKUP_CONFIRMED` bekrefter bare at du har tatt backup; det sier ikke
at backupen er god. Kjør derfor restore-testen før du setter den. Neste
utrulling krever en ny backup. Prisma tar sin egen advisory lock, så flere
instanser ikke migrerer samtidig.

## Rollback

Ta alltid en fersk backup **før** du ruller tilbake, også når tjenesten ser
ødelagt ut – den kan inneholde data du ellers mister.

### 1. App-image

En ren app-rollback er tryggest og raskest når databaseskjemaet er kompatibelt:

```bash
# I .env: APP_IMAGE=<forrige kjente gode versjon/digest>
docker compose -f docker-compose.prod.yml config --images
docker compose -f docker-compose.prod.yml pull app
docker compose -f docker-compose.prod.yml up -d app
```

Migrasjoner kjøres på nytt ved oppstart, men `migrate deploy` hopper over
allerede kjørt historikk. Nye additive migrasjoner er vanligvis kompatible med
forrige appversjon; destructive endringer er ikke. Sjekk diffen mellom
versjonene. Er du i tvil, rull tilbake databasen også.

Etter rollback: sjekk `/api/health`, `/api/ready`, `docker compose ps` og
loggene, og gjør en røyktest (innlogging, kundeliste, opplasting, PDF).

### 2. Database

Gjenoppretting av database er **destruktivt** for alt som er skrevet etter
backupen. Stop appen først, slik at ingenting skriver mens du bytter.

```bash
COMPOSE="docker compose -f docker-compose.prod.yml"
$COMPOSE stop app
./scripts/backup.sh                       # sikre dagens tilstand først

$COMPOSE exec -T postgres createdb -U admin fsm_db_rollback
age -d -i ~/.config/age/keys.txt backups/db-20261024-030000.sql.gz.age \
  | gunzip \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U admin \
      -d fsm_db_rollback

# Kontroller at rader og migrasjoner er med:
$COMPOSE exec -T postgres psql -U admin -d fsm_db_rollback -c \
  'SELECT count(*) FROM "User";'

# Bytt database. Ingen app skal være tilkoblet nå.
$COMPOSE exec -T postgres psql -U admin -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='fsm_db';"
$COMPOSE exec -T postgres dropdb -U admin fsm_db
$COMPOSE exec -T postgres psql -U admin -d postgres -c \
  'ALTER DATABASE fsm_db_rollback RENAME TO fsm_db;'
```

Bruk `POSTGRES_USER`/`POSTGRES_DB` fra `.env` hvis de ikke er `admin`/`fsm_db`.
Start deretter appen med den **gamle** `APP_IMAGE`-taggen. Sjekk at
`_prisma_migrations` stemmer med koden før du setter tjenesten i drift.

### 3. Opplastinger

Opplastingsvolumet har egne filer som ikke ligger i databasedumpen. Ta backup
av begge, og gjenopprett begge ved rollback. Full gjenoppretting fra arkiv:

```bash
VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_fsm_uploads$' | head -n 1)"

# Tøm og pakk ut (arkivet kan være kryptert; da dekrypterer du i strøm):
docker run --rm -v "$VOLUME:/data" postgres:15 \
  sh -c 'find /data -mindepth 1 -delete'
age -d -i ~/.config/age/keys.txt backups/uploads-20261024-030000.tar.gz.age \
  | docker run --rm -i -v "$VOLUME:/data" postgres:15 tar xzf - -C /data
```

Etterpå: åpne et vedlegg i UI, og bekreft at filen finnes med riktig
tilgangskontroll. `UPLOAD_DIR` må peke på samme sted som i produksjon
(`/app/uploads` i containeren). Gjenopprett alltid database og opplastinger fra
**samme tidsstempel**, ellers kan `Upload`-rader peke på filer som mangler.

### 4. Rollback-øvelse

Kjør minst hvert kvartal på en kopi: velg en backup, kjør
`scripts/restore-test.sh`, gjenopprett opplastingsarkivet til et testvolum, og
start appen mot den gjenopprettede databasen. Noter tiden det tar – det er
deres reelle RTO.

## Backup og restore

Ta backup av database og opplastingsvolum:

```bash
COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh
```

Skriptet gir:

- `backups/db-<tid>.sql.gz` (eller `.sql.gz.age`)
- `backups/uploads-<tid>.tar.gz` (eller `.tar.gz.age`)

Med `BACKUP_AGE_RECIPIENT=age1...` krypteres begge i en strøm, slik at
ukrypterte filer aldri ligger på disk. Filene får `0600`. `BACKUP_REMOTE`
kopierer til ekstern lagring med rclone. `RETENTION_DAYS` (standard 30) styrer
hvor lenge lokale filer beholdes; ekstern lagring bør ha egen, lengre
oppbevaring.

Skriptene leser ikke `.env` selv. Avviker `POSTGRES_USER` eller `POSTGRES_DB`
fra standardverdiene (`admin`/`fsm_db`), må de eksporteres til skriptet – også
i cron. `COMPOSE_FILE` leses av Docker Compose.

Test at backupen kan gjenopprettes (oppretter og sletter en midlertidig
database, og verifiserer opplastingsarkivet):

```bash
# Ukryptert:
BACKUP_FILE=backups/db-20261024-030000.sql.gz ./scripts/restore-test.sh

# age-kryptert – nøkkelen leses fra AGE_IDENTITY (standard
# ~/.config/age/keys.txt):
AGE_IDENTITY=/sikker/age/keys.txt \
  BACKUP_FILE=backups/db-20261024-030000.sql.gz.age \
  ./scripts/restore-test.sh

# Produksjon:
COMPOSE_FILE=docker-compose.prod.yml ./scripts/restore-test.sh
```

`restore-test.sh` finner også nyeste `uploads-*.tar.gz[.age]` automatisk, eller
du kan peke med `UPLOADS_FILE`. Den dekrypterer i en strøm, sjekker
tar-arkivet og sletter testdatabasen selv ved feil. Den beviser at arkivet kan
leses – ikke at alle vedlegg er koblet riktig i databasen. Gjør derfor en
full restore-øvelse (se over) jevnlig.

Skriptene har egne tester som ikke krever Docker, Postgres eller age:

```bash
bash scripts/tests/backup.test.sh
bash scripts/tests/restore-test.test.sh
```

### Planlegging

Eksempel med cron (kjør som en egen driftsbruker med tilgang til `.env` og
age-nøkkelen):

```cron
17 3 * * * cd /opt/fsm-platform && COMPOSE_FILE=docker-compose.prod.yml \
  BACKUP_AGE_RECIPIENT=age1... BACKUP_REMOTE=remote:fsm-backups \
  ./scripts/backup.sh >> /var/log/fsm-backup.log 2>&1

0 5 1 * * cd /opt/fsm-platform && COMPOSE_FILE=docker-compose.prod.yml \
  AGE_IDENTITY=/sikker/age/keys.txt ./scripts/restore-test.sh \
  >> /var/log/fsm-restore-test.log 2>&1
```

Roter også `/var/log/fsm-*.log` med logrotate, og overvåk at cron-jobben faktisk
lager nye filer. Et systemd-timer-oppsett er like greit; poenget er at backup,
restore-test og ekstern kopi er automatisert og varsler ved feil.

## Disk, opplastinger og opprydding

- Filer ligger i `UPLOAD_DIR` (standard `./uploads`, i Docker `/app/uploads`).
- `/uploads/...` krever innlogging og sjekker `Upload`-raden per fil.
- Per-fil-grenser: 15 MB for bilder og 50 MB for PDF (`UPLOAD_MAX_IMAGE_MB`,
  `UPLOAD_MAX_DOCUMENT_MB`). Hele forespørselen avvises tidlig med 413 basert på
  `Content-Length`, og filstørrelsen sjekkes på nytt etter parsing.
- **Det finnes ingen per-bruker- eller per-kunde-kvote i appen.** Total
  diskbruk styres av opplastingsvolumet. På en liten maskin bør dere derfor
  senke `UPLOAD_MAX_DOCUMENT_MB` (for eksempel til 25) og følge med på
  volumbruken. Trenger dere harde kvoter, må det implementeres i
  opplastingsflyten eller håndheves av lagringsløsningen.
- Grov kapasitetsberegning: 1000 PDF-er à 20 MB = ca. 20 GB, og backup arkiverer
  det samme én gang til. Lokale backupfiler dobler altså diskbehovet. Hold
  minst 30 % ledig disk, og legg backupene utenfor datadisk hvis mulig.
- Sjekk disk og volum:

  ```bash
  df -h /
  docker system df -v
  docker run --rm -v "$(docker volume ls --format '{{.Name}}' \
    | grep -E '_fsm_uploads$' | head -n 1):/data:ro" postgres:15 du -sh /data
  ```

- Varsle når rotfilsystemet passerer 80 %. På sikt bør overvåkingen også sjekke
  at siste backup er fersk, at `/api/ready` er 200, og at `RestartCount` ikke
  øker.
- Trygg opprydding: `docker image prune -f` og `docker builder prune -f`.
  **Ikke** kjør `docker system prune --volumes` – det sletter
  `fsm_uploads`/`fsm_postgres_data`.
- Slett gamle backupfiler bare når de er kopiert eksternt og
  `RETENTION_DAYS` er passert. `backup.sh` gjør dette automatisk lokalt.
- Ved sletting av dokument/vedlegg/oppdrag frigjøres filen først når ingen
  andre rader refererer til den (`src/lib/upload-cleanup.ts`). Sjekk volumet
  etter store slettinger.

## Sanntid (SSE)

- `/api/events` er bare for aktive interne roller (ikke kundeportal/utlogget).
- Alle faner deler én PostgreSQL `LISTEN`-forbindelse per prosess. Hendelser
  spres i minnet, og hver tilkobling får hjerteslag hvert 25. sekund.
- Maks 3 samtidige strømmer per bruker og per IP. Klienten kobler seg på nytt
  med begrenset, eksponentiell backoff og gir opp etter fem forsøk, slik at en
  401/403 ikke gir en uendelig løkke.

## Skalering

- Rate limits og jobbkø ligger i databasen og deles mellom instanser.
- Serviceavtale-genereringen bruker en PostgreSQL advisory lock, så bare én
  instans genererer om gangen.
- PDF-rendering har en prosesslokal semaphore (maks 2). Ved flere instanser
  gjelder grensen per instans.
- For større installasjoner: bytt lokal disk mot S3-kompatibel lagring og
  vurder Redis/BullMQ for kø og rate limits (P4).

## CI og publisering

- CI kjører på `master`, `main`, `dev`, alle pull requests og versjonstagger
  (`v*`).
- Docker-imaget publiseres bare når CI-kjøringen for samme tag er grønn
  (`workflow_run`), eller ved manuell `workflow_dispatch`. Trivy skanner både
  CI-imaget og det publiserte manifestet.
- Actions er ikke låst til commit-SHA-er ennå; det bør gjøres når
  versjonsavhengighetene er avklart (se `SECURITY.md`).

## Feilsøking

| Symptom | Sjekk |
| --- | --- |
| 503 fra `/api/ready` | database, `UPLOAD_DIR`-tilgang, jobbkø |
| 502 fra proxyen | se sjekklisten under |
| Appen restarter i loop | `docker compose logs app`, migrasjonssperre (`REQUIRE_BACKUP_BEFORE_MIGRATE`), OOM (`dmesg`) |
| Innlogging logger ut alle | `sessionVersion` er økt (passord/rolle/2FA-endring) |
| PDF vises ikke | `APP_URL`/`NEXTAUTH_URL`, `Upload`-rad for filen |
| OCR henger | `DocumentJob`-status, `PDF_JOB_WORKER`, `TESSDATA_DIR`, full `/tmp` |
| Serviceavtaler lages ikke | `RECURRING_SCHEDULER`, advisory lock, `nextServiceDate` |
| Disk full | `df -h /`, `docker system df -v`, opplastingsvolum, backupfiler |

### 502-sjekkliste

1. **Proxy:** svarer den, og peker upstream til `127.0.0.1:3000`? Sjekk
   `nginx -t`/`caddy validate` og proxy-loggen.
2. **Container:** `docker compose -f docker-compose.prod.yml ps` – er `app`
   `running`/`healthy`? `RestartCount`?
3. **Logger:** `docker compose -f docker-compose.prod.yml logs --tail=200 app`.
   Se etter migrasjonsfeil, `NEXTAUTH_URL`/`APP_URL`, OOM eller `EADDRINUSE`.
4. **Lokal helse:** `curl -v http://127.0.0.1:3000/api/health` og `/api/ready`.
   200 lokalt men 502 utenfra ⇒ proxy/TLS/nettverk, ikke appen.
5. **Database:** `docker compose ... exec -T postgres pg_isready` og
   `psql -c 'SELECT 1'`. Readiness returnerer 503 når DB er nede.
6. **Migrasjoner:** stoppet appen på `REQUIRE_BACKUP_BEFORE_MIGRATE`? Ta
   backup, verifiser, start med `BACKUP_CONFIRMED=true`.
7. **Minne/disk:** `docker stats --no-stream`, `free -h`, `df -h /`, `dmesg -T
   | grep -i oom`.
8. **Restart:** først når årsaken er funnet,
   `docker compose -f docker-compose.prod.yml up -d app`. Ved DB-utfall: start
   Postgres først, deretter appen.
