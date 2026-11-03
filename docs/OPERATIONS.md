# Drift og feilsøking

## Produksjonssett: image-pinning

Produksjon bruker `docker-compose.prod.yml`. Der er `APP_IMAGE` **påkrevd**:

```dotenv
APP_IMAGE=ghcr.io/eroticd/fsm-platform:v0.8.5
POSTGRES_IMAGE=postgres:15.13
```

- Pinn `APP_IMAGE` til en publisert release-tag, aldri `latest`. Da vet du
  nøyaktig hvilken kode som kjører, og en rollback er bare å bytte tag.
- Vil du være helt sikker på at taggen ikke flyttes, pinn til digest:

  ```bash
  docker pull ghcr.io/eroticd/fsm-platform:v0.8.5
  docker inspect --format='{{index .RepoDigests 0}}' \
    ghcr.io/eroticd/fsm-platform:v0.8.5
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
| Database | Runtime-rollen må være DML-only i produksjon; ellers 503 fra `/api/ready` | `DATABASE_RUNTIME_URL`/`DATABASE_MIGRATION_URL`; bevisst unntak med `ALLOW_DB_DDL_ROLE=true` |
| Proxy | `TRUST_PROXY=false` (IP-limits inaktive); produksjon krever eksplisitt hoppantall når den er true | `TRUST_PROXY=true` + `TRUST_PROXY_HOPS`, se «Proxy og klient-IP» |
| Backup | Daglig kryptert backup med sjekksum og statusfil; produksjon nekter å ta backup uten `BACKUP_AGE_RECIPIENT` | `BACKUP_REMOTE`, `REQUIRE_BACKUP_ENCRYPTION=true`, se «Backup og restore» |
| Overvåking | `/api/metrics` er av uten `METRICS_SECRET` | `METRICS_SECRET`, se «Overvåking og varsling» |
| Opplasting | 4 samtidige kroppslesinger per instans, 50 MB per PDF, 2 GiB per bruker/24 t og 10 GiB per kunde | `UPLOAD_BODY_CONCURRENCY`, `UPLOAD_MAX_DOCUMENT_MB`, `UPLOAD_QUOTA_USER_MB` og `UPLOAD_QUOTA_CUSTOMER_MB`; proxyen må fortsatt sette egne grenser |
| 2FA | Valgfritt som standard, men anbefalt for `ADMIN` og `OFFICE` | Sett `REQUIRE_2FA_ROLES=ADMIN,OFFICE` for påkrevd oppsett ved innlogging. Break-glass: se «To-trinns verifisering» |
| API-nøkler | Scopes, skrivebeskyttelse, 90 dagers standardlevetid og 365 dagers maks | `API_KEY_DEFAULT_LIFETIME_DAYS` og `API_KEY_MAX_LIFETIME_DAYS` |

## SMS, webhooker og påminnelser

SMS-leverandøren velges med `SMS_PROVIDER` (`console`, `linkmobility`,
`pswincom` eller `twilio`). `console` er tørrkjøring og sender aldri ut av
prosessen. Avsendernavnet kommer fra `SMS_SENDER_ID`.

| Variabel | Bruk |
| --- | --- |
| `SMS_PROVIDER` | Aktiv leverandør. Ukjent verdi faller tilbake til `console`. |
| `SMS_SENDER_ID` | Avsender som vises hos mottakeren. |
| `SMS_WEBHOOK_SECRET` | Felles HMAC-hemmelighet for `console`, `linkmobility` og `pswincom`. |
| `SMS_LINKMOBILITY_SECRET` | Overstyrer `SMS_WEBHOOK_SECRET` for Link Mobility. |
| `SMS_PSWINCOM_SECRET` | Overstyrer `SMS_WEBHOOK_SECRET` for PSWinCom. |
| `SMS_TWILIO_AUTH_TOKEN` | Twilio-signatur og API-token. |
| `SMS_TWILIO_ACCOUNT_SID` | Twilio-konto for utgående sending. |
| `SMS_LINKMOBILITY_URL` / `SMS_LINKMOBILITY_API_KEY` | Utgående Link Mobility-endepunkt og nøkkel. |
| `SMS_PSWINCOM_URL`, `SMS_PSWINCOM_USER`, `SMS_PSWINCOM_PASSWORD` | Utgående PSWinCom-oppsett. |
| `SMS_ALLOWLIST` | Kommaseparerte numre som er tillatt i test/staging. Tom betyr alle med samtykke. |
| `SMS_TIMEOUT_MS` | Tidsavbrudd mot leverandøren (standard 10 000 ms). |

**Webhook-URL:** `https://<vert>/api/webhooks/sms/<leverandør>`. Bruk samme URL
for innkommende meldinger og leveringsstatus. Ruten krever gyldig signatur;
`console` godtas uten hemmelighet bare når `NODE_ENV` ikke er `production`.
Link Mobility og PSWinCom signerer `timestamp.body` med HMAC-SHA256 i
`x-lm-signature`/`x-pswincom-signature` (eller `x-sms-signature`), og
tidsstempelet må være innenfor fem minutter. Twilio bruker
`x-twilio-signature` (SHA-1 over URL og sorterte parametre). Rate limit er 120
forespørsler per minutt per leverandør og IP; overskridelse gir `429` med
`Retry-After`.

**Idempotens:** Innkommende meldinger lagres med unik `(provider, providerId)`,
så leverandørens retries gir én `SmsMessage` og én `Message`. Leveringsstatus er
også idempotent: en sen `delivered` overskriver ikke en nyere feil, og ukjent
meldings-ID besvares med `200` slik at leverandøren slutter å prøve. STOP/START
oppdaterer `ChannelPreference` umiddelbart og blokkerer senere utsending.

**Retry og kø:** Utgående SMS ligger i `SmsMessage` og prøves tre ganger med
eksponentiell pause (30 s, 60 s, 120 s) før `DEAD_LETTER`. En krasjet worker
frigjør `SENDING`-rader etter 30 minutter. Påminnelser ligger i
`ReminderDispatch`: sveip hvert femte minutt, tre forsøk med 5/10/20 minutters
pause, og `PROCESSING`-rader eldre enn 15 minutter settes tilbake i køen.
Stille timer flytter utsendingen til slutten av vinduet; blir tidspunktet etter
besøkets start, hoppes påminnelsen over med årsak. Avlyste, flyttede eller
fullførte besøk gir `SKIPPED` før noe sendes. Workeren styres med
`REMINDER_WORKER=false` og kjører uavhengig av `PDF_JOB_WORKER`.

**Overvåking:** `FsmSmsDeadLetters` i `deploy/monitoring/` fanger
`SmsMessage` med `status = DEAD_LETTER` eller `FAILED`. Påminnelser logges uten
telefonnummer eller meldingstekst, og hver utsendelse får en revisjonsrad med
regel, visit, kanal og offset – ikke innhold. Historikken i innstillingene viser
de siste 50 radene per avdeling.

**Retensjon:** `SmsMessage` og `Message` beholdes sammen med kunden/oppdraget og
følger den vanlige bevarings- og revisjonspolicyen. `ReminderDispatch` slettes
kaskadert når regelen, avdelingen eller visiten slettes; ingen automatisk
purring finnes fordi radene er revisjonsspor for utsending. Logg aldri
meldingstekst, telefonnummer eller e-postadresse i feillogger.

**Manuell kontroll:**

```bash
# Signert testleveranse (console i utvikling)
curl -sS -X POST http://127.0.0.1:3000/api/webhooks/sms/console \
  -H 'content-type: application/json' -d '{"id":"test-1","from":"4790000000","to":"4700000000","body":"Hei"}'

# Se dead letters og siste påminnelser
psql "$DATABASE_URL" -c "select id,status,\"lastError\" from \"SmsMessage\" where status in ('DEAD_LETTER','FAILED') order by \"createdAt\" desc limit 20;"
psql "$DATABASE_URL" -c "select status,\"skipReason\",count(*) from \"ReminderDispatch\" group by 1,2;"
```

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
- `GET /api/ready` — **readiness**. Uautentiserte kall får en kort status og
  billige database- og rollekontroller (rate-limitert per IP), slik at også
  Compose-healthchecken blir unhealthy når runtime-rollen kan DDL. Med
  `READY_SECRET` eller `CRON_SECRET` sjekkes også skrivbart
  opplastingsvolum og jobbkøen, og detaljene returneres. Returnerer 503 når
  noe mangler, eller når `databaseRole.canDdl` er `true` i produksjon uten
  `ALLOW_DB_DDL_ROLE=true`.
- `GET /api/metrics` — **driftsmålinger**, beskyttet med `METRICS_SECRET`.
  Se «Overvåking og varsling».

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

## Proxy og klient-IP

Appen skal bare nås via proxyen på `127.0.0.1:3000`. Eksempler for Caddy og
nginx ligger i [`deploy/proxy/`](../deploy/proxy/README.md). De overskriver
`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For` og
`X-Real-IP`, setter body-grense til 55 MB og tidsavbrudd til 300 s.

```dotenv
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
```

- `TRUST_PROXY_HOPS` er antallet proxyer, ikke antallet
  `X-Forwarded-For`-oppføringer. Appen tar den N-te verdien fra høyre.
- Med flere hopp må bare kantsonen overskrive `X-Forwarded-For`; indre
  proxyer appender. Ellers faller appen tilbake til «ukjent IP».
- Produksjon nekter å starte når `TRUST_PROXY=true` mangler eksplisitt
  `TRUST_PROXY_HOPS`, når hopp er satt uten at proxy er betrodd, eller når
  `TRUST_PROXY` har en annen verdi enn `true`/`false`.
- Uten `TRUST_PROXY` ignoreres `X-Forwarded-For` helt, og IP-baserte
  rate limits er inaktive. Det er trygt mot spoofing, men gir svakere vern.

Test at en klientstyrt header ikke kan endre nøkkelen:

```bash
# Rate-limit-nøkkelen skal være proxyens oppgitte klientadresse, ikke 6.6.6.6.
curl -sS -H 'X-Forwarded-For: 6.6.6.6' https://fsm.example.com/api/health
```

Enhetstestene i `src/lib/client-ip.test.ts` dekker spoofing, flere hopp og
ugyldig konfigurasjon.

## Overvåking og varsling

`/api/metrics` krever `METRICS_SECRET` og svarer 503 uten den. JSON er
standard; Prometheus kan scrape `?format=prometheus` eller sende
`Accept: text/plain`.

```bash
curl -fsS -H "Authorization: Bearer $METRICS_SECRET" \
  http://127.0.0.1:3000/api/metrics | jq .queue,.backup,.disk
```

Målingene dekker:

- readiness (`fsm_ready`, database og opplastingsvolum)
- diskbruk på opplastingsvolumet
- restart-signal (`fsm_process_uptime_seconds`)
- backupalder og ferskhet fra `BACKUP_STATUS_FILE`
- feilede `DocumentJob`
- SMS dead letters
- varsler som har gitt opp e-postutsending

Ferdige Prometheus- og Alertmanager-eksempler ligger i
[`deploy/monitoring/`](../deploy/monitoring/README.md). Reglene dekker alle
signalene over. `scripts/backup-freshness.sh --prometheus-output` kan i tillegg
skrive backupmålinger til node_exporter, slik at de overlever at appen er nede.

Testvarsel:

```bash
ALERT_WEBHOOK_URL=https://... ./scripts/ops-alert.sh --test
```

Bekreft at meldingen faktisk kommer fram i kanalen. Systemd-enhetene i
`deploy/systemd/` bruker samme skript via `OnFailure=fsm-alert@%n.service`.

| Alarm | Terskel | Første steg |
| --- | --- | --- |
| `FsmScrapeDown` | scrape feiler i 2 min | container, proxy, `METRICS_SECRET` |
| `FsmNotReady` | `fsm_ready=0` i 5 min | `/api/ready`, database, volum |
| `FsmAppRestarting` | uptime < 5 min i 5 min | `RestartCount`, OOM, logger |
| `FsmDiskLow` | > 80 % i 15 min | `df -h`, opplastingsvolum, backupfiler |
| `FsmBackupStale` | ikke fersk i 30 min | `fsm-backup-check`, `journalctl -u fsm-backup` |
| `FsmBackupAgeHigh` | > 26 timer | backup-timer, age-nøkkel, rclone |
| `FsmDocumentJobsFailed` | > 0 i 15 min | `DocumentJob.lastError`, `/tmp` |
| `FsmSmsDeadLetters` | > 0 i 15 min | `SmsMessage.lastError`, leverandør |
| `FsmNotificationEmailFailures` | > 0 i 30 min | SMTP, `Notification.emailError` |

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

Produksjon skal ha to roller:

- `fsm_migrator` — DDL-rolle som eier tabellene og kjører migrasjonene.
- `fsm_app` — DML-rolle som appen bruker: `SELECT`, `INSERT`, `UPDATE`,
  `DELETE`, men ikke `CREATE`/`ALTER`/`DROP`.

Provisioner dem med skriptet, som er idempotent og kan kjøres på nytt etter nye
migrasjoner. Passordene sendes via miljøvariabler, ikke kommandolinjen:

```bash
export MIGRATION_PASSWORD="$(openssl rand -base64 32)"
export RUNTIME_PASSWORD="$(openssl rand -base64 32)"

COMPOSE_FILE=docker-compose.prod.yml ./scripts/provision-db-roles.sh
```

Skriptet oppretter/oppdaterer rollene, flytter eierskapet til
`fsm_migrator`, gir `fsm_app` DML på eksisterende og framtidige tabeller og
sekvenser, fjerner `CREATE` på `public`, og beskytter revisjonssporet:

- `fsm_app` får ikke `UPDATE`/`DELETE`/`TRUNCATE` på `AuditLog`.
- `fsm_app` får ingen rettigheter på `_prisma_migrations`.

Sett deretter i `.env` (URL-kod passord med spesialtegn):

```dotenv
DATABASE_RUNTIME_URL=postgresql://fsm_app:bytt-meg@postgres:5432/fsm_db?schema=public
DATABASE_MIGRATION_URL=postgresql://fsm_migrator:bytt-meg@postgres:5432/fsm_db?schema=public
```

`docker-compose.prod.yml` sender begge videre til appcontaineren.
`DATABASE_URL` (runtime) brukes av appen, seed og backfill;
`DATABASE_MIGRATION_URL` brukes bare av `prisma migrate deploy` og
databaseventingen i oppstartsskriptet.

#### Fail-closed readiness

Produksjon er fail-closed: `/api/ready` spør PostgreSQL om `current_user`,
`rolsuper`, `rolcreatedb`, `rolcreaterole` og
`has_schema_privilege(..., 'CREATE')`, også for uautentiserte
healthcheck-kall. Hvis runtime-rollen kan endre skjema, blir svaret 503 –
autentiserte kall får `databaseRole.canDdl: true` – og Compose markerer
containeren som unhealthy. Proxyen bør ikke sende trafikk til instansen.

Eksisterende installasjoner som bevisst fortsatt bruker `admin` kan velge bort
sjekken midlertidig:

```dotenv
ALLOW_DB_DDL_ROLE=true
```

Det er et bevisst unntak, ikke en anbefaling. Fjern det etter at
`provision-db-roles.sh` er kjørt. Lokal `docker-compose.yml` setter
`ALLOW_DB_DDL_ROLE=true` fordi utviklingsdatabasen bruker `admin`.

#### Oppgradering av eksisterende installasjon

1. Ta backup og kjør `restore-test.sh`.
2. Kjør migrasjonene som før, med dagens superbruker.
3. Provisioner rollene, og overfør objektene som den gamle eieren har:

   ```bash
   REASSIGN_OWNER=admin \
     MIGRATION_PASSWORD=... RUNTIME_PASSWORD=... \
     COMPOSE_FILE=docker-compose.prod.yml ./scripts/provision-db-roles.sh
   ```

   `REASSIGN_OWNER` er bevisst opt-in fordi `REASSIGN OWNED` flytter alle
   objekter i databasen. Har enkeltstabeller andre eiere, må de også overføres
   til `fsm_migrator`, ellers feiler `ALTER TABLE` i senere migrasjoner.

4. Sett `DATABASE_RUNTIME_URL`/`DATABASE_MIGRATION_URL`, fjern
   `ALLOW_DB_DDL_ROLE`, og rull ut.
5. Verifiser:

   ```bash
   curl -fsS -H "Authorization: Bearer $READY_SECRET" \
     http://127.0.0.1:3000/api/ready | jq .databaseRole
   # forventet: canDdl: false, superuser: false

   docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U fsm_app -d fsm_db -c 'CREATE TABLE skal_feile (id int);'
   # forventet: ERROR: permission denied for schema public
   ```

`pg_trgm` og `unaccent` er trusted extensions i PostgreSQL 15, så
migrasjonsrollen kan opprette dem når den eier databasen.

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
- `backups/checksums-<tid>.sha256` — SHA-256 for begge filene
- `backups/backup-status.json` — tidspunkt, filnavn og størrelse for
  freshness-proben og `/api/metrics`

Med `BACKUP_AGE_RECIPIENT=age1...` krypteres begge i en strøm, slik at
ukrypterte filer aldri ligger på disk. Filene får `0600`. `BACKUP_REMOTE`
kopierer til ekstern lagring med rclone **etter** at filene er kryptert (eller
bevisst ukryptert i lokal utvikling). Kopien verifiseres med `rclone check`
med mindre `BACKUP_VERIFY_REMOTE=false` er satt bevisst. `RETENTION_DAYS`
(standard 30) styrer hvor lenge lokale filer beholdes; ekstern lagring bør ha
egen, lengre oppbevaring.

Sjekk ferskhet, alder og sjekksum uten å røre databasen:

```bash
./scripts/backup-freshness.sh
./scripts/backup-freshness.sh --max-age-hours 26 --require-remote
./scripts/backup-freshness.sh --prometheus-output /var/lib/node_exporter/textfile/fsm-backup.prom
```

Skriptet feiler når siste backup mangler, er eldre enn grensen, har feil
sjekksum, eller når `--require-remote` er satt uten verifisert ekstern kopi.
Det er denne kontrollen systemd-timeren bruker.

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
bash scripts/tests/backup-freshness.test.sh
bash scripts/tests/restore-test.test.sh
bash scripts/tests/ops-alert.test.sh
bash scripts/tests/provision-db-roles.test.sh
```

### Planlegging

Anbefalt oppsett er systemd-enhetene i [`deploy/systemd/`](../deploy/systemd/README.md):

- `fsm-backup.timer` — daglig kl. 03:17, `Persistent=true` (tar igjen en
  misset kjøring etter reboot).
- `fsm-backup-check.timer` — daglig kl. 06:10, kontrollerer ferskhet,
  sjekksum og eventuell ekstern kopi.
- `fsm-restore-test.timer` — ukentlig søndag kl. 04:30, gjenoppretter til en
  midlertidig database.
- Alle har `OnFailure=fsm-alert@%n.service`, som sender varsel via
  `ALERT_WEBHOOK_URL`.

```bash
sudo cp deploy/systemd/fsm-*.service deploy/systemd/fsm-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fsm-backup.timer fsm-backup-check.timer fsm-restore-test.timer
```

Cron er et fullverdig alternativ, men da må dere selv varsle når jobben
feiler. Eksempel:

```cron
17 3 * * * cd /opt/fsm-platform && NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml \
  BACKUP_AGE_RECIPIENT=age1... BACKUP_REMOTE=remote:fsm-backups \
  ./scripts/backup.sh >> /var/log/fsm-backup.log 2>&1 || \
  ALERT_WEBHOOK_URL=... ./scripts/ops-alert.sh critical "backup" "Daglig backup feilet"

10 6 * * * cd /opt/fsm-platform && ./scripts/backup-freshness.sh --require-remote \
  >> /var/log/fsm-backup-check.log 2>&1 || \
  ALERT_WEBHOOK_URL=... ./scripts/ops-alert.sh critical "backup" "Backup er ikke fersk"

30 4 * * 0 cd /opt/fsm-platform && COMPOSE_FILE=docker-compose.prod.yml \
  AGE_IDENTITY=/sikker/age/keys.txt ./scripts/restore-test.sh \
  >> /var/log/fsm-restore-test.log 2>&1 || \
  ALERT_WEBHOOK_URL=... ./scripts/ops-alert.sh critical "restore" "Restore-test feilet"
```

Roter `/var/log/fsm-*.log` med logrotate. Poenget er at backup, sjekksum,
ekstern kopi og restore-test er automatisert og varsler ved feil.

### RPO, RTO og nøkkelgjenoppretting

- **RPO (hvor mye data kan tapes):** med daglig backup og 30 dagers lokal
  historikk er RPO inntil 24 timer. `fsm-backup-check` varsler når siste
  backup er over 26 timer, slik at en misset natt ikke går ubemerket.
- **RTO (hvor lang tid gjenoppretting tar):** settes av faktisk
  restore-øvelse, ikke av skriptets teoretiske tid. Mål hvor lang tid
  `restore-test.sh` bruker på en kopi av produksjonsdatabasen, legg til tid
  for opplastingsvolumet og DNS/proxy, og skriv tallet her etter hver øvelse.
  Små installasjoner bør kunne være tilbake innen 1–2 timer; store
  opplastingsvolum og manglende lokal backup øker tiden.
- **Nøkkelgjenoppretting:** `BACKUP_AGE_RECIPIENT` er en offentlig nøkkel;
  `AGE_IDENTITY` er den private nøkkelen som trengs for restore. Oppbevar
  minst to kopier av identiteten på separate, krypterte medier utenfor
  serveren, og test dem med `restore-test.sh`. Mister dere identiteten, er
  eksisterende age-backuper ubrukelige – ingen i appen kan gjenopprette dem.
  Roter nøkkelpar bevisst: lag nytt par, ta ny backup, verifiser restore, og
  behold den gamle identiteten til alle gamle backuper er ute av retention.
  Dokumenter hvem som har kopi, og øv på gjenoppretting uten serveren.
- **Ekstern kopi:** `BACKUP_REMOTE` må peke til lagring med egen
  tilgangskontroll. `rclone check` bekrefter innholdet etter hver kjøring.
  Slett aldri lokal backup før den er verifisert eksternt og
  `RETENTION_DAYS` er passert.

## To-trinns verifisering og break-glass

- `REQUIRE_2FA_ROLES` styrer hvilke roller som må ha 2FA før innlogging. Tom
  verdi betyr valgfritt; anbefalt produksjonsverdi er `ADMIN,OFFICE`.
- En bruker uten oppsett får ingen sesjon. Etter riktig passord sendes hen til
  `/logg-inn/2fa/oppsett`, skanner QR-koden og bekrefter med engangskode.
  Gjenopprettingskodene vises i Innstillinger → Sikkerhet etterpå.
- Roller utenfor listen, og eksisterende økter opprettet før policyen ble slått
  på, påvirkes ikke før neste innlogging. En økt varer maks 12 timer.
- **Break-glass** når en privilegert bruker har mistet både appen og
  gjenopprettingskodene:

  ```bash
  cd /opt/fsm-platform
  DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" \
    node scripts/break-glass-2fa.mjs --email admin@example.com --confirm
  ```

  Skriptet nullstiller bare 2FA for én bruker, øker `sessionVersion` (alle økter
  blir ugyldige) og skriver en revisjonsrad med årsak. Det endrer ikke passord
  eller rettigheter. Brukeren må deretter logge inn og fullføre påkrevd oppsett.
  Beskytt shell- og database tilgangen; dette er en bevisst nødvei, ikke en
  vanlig administrativ handling.

## API-nøkler

- Opprettes under **Innstillinger → API-nøkler** av administrator.
- Hver nøkkel har scopes (lese/skrive per område) og kan merkes
  skrivebeskyttet. Kall utenfor scopene, eller skriving med en skrivebeskyttet
  nøkkel, gir `403`. Nøkkelen arver fortsatt brukerens rettigheter og
  avdelingsomfang.
- Nøkler får alltid utløpsdato: standard `API_KEY_DEFAULT_LIFETIME_DAYS` (90)
  og maks `API_KEY_MAX_LIFETIME_DAYS` (365).
- **Rotasjon** tilbakekaller den gamle nøkkelen og lager en ny med samme eier,
  navn, scopes og skrivebeskyttelse i samme transaksjon. Klarteksttokenet vises
  én gang; oppdater integrasjonen umiddelbart.
- Opprettelse, tilbakekalling og rotasjon logges i aktivitetsloggen. Sist brukt
  og utløp vises i listen. Utløpte og tilbakekalte nøkler gir `401`.

## Disk, opplastinger og opprydding

- Filer ligger i `UPLOAD_DIR` (standard `./uploads`, i Docker `/app/uploads`).
- `/uploads/...` krever innlogging og sjekker `Upload`-raden per fil.
- Per-fil-grenser: 15 MB for bilder og 50 MB for PDF (`UPLOAD_MAX_IMAGE_MB`,
  `UPLOAD_MAX_DOCUMENT_MB`). Hele forespørselen avvises tidlig med 413 basert på
  `Content-Length`, og grensene håndheves på nytt mens multipart-kroppen
  strømmes til en midlertidig fil. Filen flyttes først til opplastingsmappen når
  type, kvote og eierskap er kontrollert.
- **Kvoter:** `UPLOAD_QUOTA_USER_MB` (standard 2048, rullerende 24 timer per
  bruker) og `UPLOAD_QUOTA_CUSTOMER_MB` (standard 10240, samlet per kunde).
  Overskridelse gir `507 storage_quota_exceeded`, og brukeren får en tydelig
  feilmelding. Kvotene er en applikasjonssperre, ikke et garantert tak under
  samtidige opplastinger; volumbegrensning i drift er fortsatt nødvendig.
- Midlertidige filer ligger i `UPLOAD_DIR/.tmp` og slettes når opplastingen
  feiler. Cron-jobben `/api/cron/cleanup` fjerner i tillegg filer som er eldre
  enn 24 timer etter en krasj. Sjekk at jobben kjører hvis diskbruken vokser.
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

- Varsle når rotfilsystemet passerer 80 %. `deploy/monitoring/fsm-alerts.yml`
  varsler på `fsm_disk_used_ratio`, `/api/ready`, backupalder og
  restart-signal; suppler med en ekstern sjekk av Docker sin `RestartCount`
  (se `deploy/monitoring/README.md`).
- Trygg opprydding: `docker image prune -f` og `docker builder prune -f`.
  **Ikke** kjør `docker system prune --volumes` – det sletter
  `fsm_uploads`/`fsm_postgres_data`.
- Slett gamle backupfiler bare når de er kopiert eksternt og
  `RETENTION_DAYS` er passert. `backup.sh` gjør dette automatisk lokalt.
- Ved sletting av dokument/vedlegg/oppdrag frigjøres filen først når ingen
  andre rader refererer til den (`src/lib/upload-cleanup.ts`). Sjekk volumet
  etter store slettinger.

### Kundeoverføring (eksport/import)

- Midlertidige kundepakker og staging ligger i `UPLOAD_DIR/.transfer/<jobbId>/`.
  Mappen opprettes med `0700`, og `package.zip` skrives med `0600`.
- **Grenser:** maks 50 MiB per fil, 500 MiB per pakke (ukomprimert og
  komprimert), 20 000 ZIP-oppføringer og kompresjonsforhold 100:1. Hele pakken
  holdes i minnet i v1, så den praktiske minnegrensen er også 500 MiB.
  `next.config.ts` (`proxyClientMaxBodySize`) er hevet til 512 MiB for å slippe
  importkroppen gjennom proxyen.
- **Levetid:** eksportartefakter og importstaging utløper etter 24 timer.
  Jobbworkeren kaller `cleanupExpiredTransfers()` hver time; den sletter
  staging, markerer jobben `EXPIRED` og fjerner forlatte kataloger uten levende
  jobb. Hjelperen kan også kalles manuelt ved diskmangel.
- **Ingen offentlig URL:** ZIP-en serveres bare fra en autentisert
  adminrute med `no-store`. Den skal aldri legges i `public/`, `/uploads` eller
  en delt cache.
- **Ikke backup:** kundepakken er et overføringsverktøy for én eller flere
  kunder. Den erstatter ikke PostgreSQL-backup + uploadvolum, og den inneholder
  bevisst ikke passord, sesjoner, API-nøkler eller 2FA-hemmeligheter.
- **Overvåking:** følg diskbruk på `UPLOAD_DIR` og antall jobber med status
  `FAILED`. Utløpte jobber skal forsvinne fra staging innen en time etter
  `expiresAt`.
- **Etter krasj under import:** DB-transaksjonen ruller tilbake, men filer som
  allerede er skrevet til `UPLOAD_DIR` kan bli liggende uten `Upload`-rad fordi
  v1 ikke har en egen avstemmingsjobb for ferdige filer. Sammenlign filsystemet
  med `Upload.storedName` før du sletter noe manuelt; slett aldri filer som er
  referert av en rad.

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
