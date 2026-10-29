# Drift og feilsøking

## Produksjonssett: image-pinning

Produksjon bruker `docker-compose.prod.yml`. Der er `APP_IMAGE` **påkrevd**:

```dotenv
APP_IMAGE=ghcr.io/eroticd/fsm-platform:v0.7.6
POSTGRES_IMAGE=postgres:15.13
```

- Pinn `APP_IMAGE` til en publisert release-tag, aldri `latest`. Da vet du
  nøyaktig hvilken kode som kjører, og en rollback er bare å bytte tag.
- Vil du være helt sikker på at taggen ikke flyttes, pinn til digest:

  ```bash
  docker pull ghcr.io/eroticd/fsm-platform:v0.7.6
  docker inspect --format='{{index .RepoDigests 0}}' \
    ghcr.io/eroticd/fsm-platform:v0.7.6
  # APP_IMAGE=ghcr.io/eroticd/fsm-platform@sha256:<digest>
  ```

- Compose standard er en konkret 15.x-minor (`postgres:15.13`), ikke den
  rullende `15`-taggen. Vil du låse helt, pinn også til digest:

  ```bash
  docker pull postgres:15.13
  docker inspect --format='{{index .RepoDigests 0}}' postgres:15.13
  # POSTGRES_IMAGE=postgres:15.13@sha256:<digest>
  ```

  Et majorbytte (15 → 16) krever dump/restore eller `pg_upgrade` – det er ikke
  nok å bytte image.
- Etter endring i `.env`: `docker compose -f docker-compose.prod.yml config
  --images` for å se hvilke image-referanser som faktisk brukes, deretter
  `pull` og `up -d`.
- Release-workflowen bruker handlinger pinnet til commit-SHA, og bygger/skanner
  imaget før det pushes. For maksimal forsyningskjede-sikkerhet bør også
  base-image-digestene (`node:22-bookworm-slim`, `debian:bookworm-slim`)
  oppdateres bevisst og pinnes i release-grenen. Det er ikke gjort automatisk
  her, fordi et digest-bytte må følges av et fullt bygg og ny skanning.

## Miljøfiler og hemmeligheter

Alle `.env*`-filer er ignorert av git, bortsett fra malene `.env.example` og
`.env.e2e.example`. Det gjelder også `.env.production` og `.env.e2e.local`.
Filen med reelle hemmeligheter skal bare kunne leses av eieren:

```bash
chmod 600 .env
```

Docker bygger ikke med `.env`/`.env.*` fordi `.dockerignore` ekskluderer dem, og
`next.config.ts` holder `.env*` utenfor `outputFileTracingExcludes` i
standalone-bygget. Sjekk gjerne at en ny `.env`-variant faktisk er ignorert:

```bash
git check-ignore -v .env.production
```

## Standardverdier

Utgangspunktet er de sikre standardvalgene i
[`SECURITY.md`](../SECURITY.md#standardvalg). Det som påvirker den daglige
driften:

| Område | Standard | Slik overstyrer du |
| --- | --- | --- |
| Offline | 8 timers sidecache og 7 dagers lokale rapportkladder | `NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS` (valgfri, bygges inn i klienten) |
| Database | Én rolle for både app og migrasjoner | `DATABASE_RUNTIME_URL` og `DATABASE_MIGRATION_URL`, se «Databaseroller» |
| Backup | Produksjon nekter å ta backup uten `BACKUP_AGE_RECIPIENT` | `REQUIRE_BACKUP_ENCRYPTION=true` krever kryptering også lokalt |
| Opplasting | 4 samtidige kroppslesinger per instans og 50 MB per PDF | `UPLOAD_BODY_CONCURRENCY` og `UPLOAD_MAX_DOCUMENT_MB`; proxyen må fortsatt sette egne grenser |
| 2FA | Valgfritt, men anbefalt for `ADMIN` og `OFFICE` | Brukeren slår det på under Innstillinger → Sikkerhet; administrator kan nullstille |

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

Appen kjører `prisma migrate deploy` ved oppstart. Oppstartsskriptet bruker
`DATABASE_MIGRATION_URL` når den er satt, ellers `DATABASE_URL`. For å kjøre
migrasjonene som et eget steg:

```bash
SKIP_MIGRATIONS=true docker compose -f docker-compose.prod.yml up -d app
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh app -c \
  'DATABASE_URL="${DATABASE_MIGRATION_URL:-$DATABASE_URL}" \
   node ./node_modules/prisma/build/index.js migrate deploy'
```

Bruk alltid `prisma migrate deploy` i produksjon — aldri `prisma db push`.
Verifiser skjemaet med:

```bash
npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code
```

### Databaseroller (minste privilegium)

Som standard bruker både appen og migrasjonene `POSTGRES_USER` (ofte
superbrukeren `admin`). Det er enkelt, men gir appen rett til å endre skjema og
til å lese/skrive alt. I produksjon kan dere dele opp:

- `fsm_migrator` — DDL-rolle som eier tabellene og kjører migrasjonene.
- `fsm_app` — DML-rolle som appen bruker: `SELECT`, `INSERT`, `UPDATE`,
  `DELETE`, men ikke `CREATE`/`ALTER`/`DROP`.

Kjør som Postgres-superbruker i appdatabasen (bytt passord og database):

```sql
CREATE ROLE fsm_migrator LOGIN PASSWORD 'bytt-meg' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE fsm_app      LOGIN PASSWORD 'bytt-meg' NOSUPERUSER NOCREATEDB NOCREATEROLE;

ALTER DATABASE fsm_db OWNER TO fsm_migrator;
ALTER SCHEMA public OWNER TO fsm_migrator;
GRANT CONNECT ON DATABASE fsm_db TO fsm_app;
GRANT USAGE ON SCHEMA public TO fsm_app;

-- Eksisterende installasjon: la migrasjonsrollen overta objektene admin eier.
-- Kjør denne i appdatabasen, og kontroller eierskapet etterpå.
REASSIGN OWNED BY admin TO fsm_migrator;

-- Les/skriv for appen, også på tabeller og sekvenser som lages senere.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fsm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fsm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fsm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fsm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fsm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fsm_app;
```

`pg_trgm` og `unaccent` er trusted extensions i PostgreSQL 15, så
migrasjonsrollen kan opprette dem når den eier databasen. Hvis en eksisterende
installasjon har egne eiere på enkelte tabeller, må de overføres til
`fsm_migrator` (ellers feiler `ALTER TABLE` i migrasjonene).

Sett så i `.env` (URL-kod passord med spesialtegn):

```dotenv
DATABASE_RUNTIME_URL=postgresql://fsm_app:bytt-meg@postgres:5432/fsm_db?schema=public
DATABASE_MIGRATION_URL=postgresql://fsm_migrator:bytt-meg@postgres:5432/fsm_db?schema=public
```

`docker-compose.prod.yml` sender begge videre til appcontaineren. Er de ikke
satt, faller den tilbake til dagens enkeltbruker-URL med `POSTGRES_USER`, så
eksisterende oppsett trenger ingen endring. `DATABASE_URL` (runtime) brukes av
appen, seed og backfill; `DATABASE_MIGRATION_URL` brukes bare av
`prisma migrate deploy` og databaseventingen i oppstartsskriptet.

`scripts/backup.sh` dumper med `POSTGRES_USER` (standard `admin`). Med separate
roller må backupbrukeren fortsatt ha lesetilgang til alle tabeller – enten gi
`admin` det, eller eksporter `POSTGRES_USER=fsm_migrator` for backupjobben.

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
NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh
```

Skriptet gir:

- `backups/db-<tid>.sql.gz` (eller `.sql.gz.age`)
- `backups/uploads-<tid>.tar.gz` (eller `.tar.gz.age`)

Med `BACKUP_AGE_RECIPIENT=age1...` krypteres begge i en strøm, slik at
ukrypterte filer aldri ligger på disk. Filene får `0600`. `BACKUP_REMOTE`
kopierer til ekstern lagring med rclone **etter** at filene er kryptert (eller
bevisst ukryptert i lokal utvikling). `RETENTION_DAYS` (standard 30) styrer
hvor lenge lokale filer beholdes; ekstern lagring bør ha egen, lengre
oppbevaring.

I produksjon er kryptering påkrevd: med `NODE_ENV=production` (eller
`REQUIRE_BACKUP_ENCRYPTION=true`) avbryter skriptet før det dumper noe hvis
`BACKUP_AGE_RECIPIENT` mangler. Lokal utvikling kan fortsatt kjøre ukryptert.
Bruk derfor:

```bash
NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh
```

Skriptene leser ikke `.env` selv. Avviker `POSTGRES_USER` eller `POSTGRES_DB`
fra standardverdiene (`admin`/`fsm_db`), må de eksporteres til skriptet – også
i cron. `COMPOSE_FILE` leses av Docker Compose. Sett også `NODE_ENV=production`
eller `REQUIRE_BACKUP_ENCRYPTION=true` i cron, slik at en glemt
`BACKUP_AGE_RECIPIENT` stopper jobben i stedet for å lage ukrypterte filer.

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
17 3 * * * cd /opt/fsm-platform && NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml \
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
- Alle Actions er pinnet til commit-SHA, og release-jobben krever en verifisert
  tag som peker på samme commit som CI kjørte. Se `SECURITY.md`.

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
