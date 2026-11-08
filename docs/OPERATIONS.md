# Drift og feilsøking

> Azure-oppsett med VM, Docker Compose og PostgreSQL Flexible Server er
> beskrevet i [`AZURE.md`](AZURE.md).

## Moduler og presets

Installasjonsnivåmoduler (kalender, rapporter, utstyr, avtaler, portal,
dokumenter, SMS, kart, sporing, omtaler, API, SSO, offline med mer) styres i
**Innstillinger → Moduler** av administrator. Data beholdes når en modul slås
av; bare sider, handlinger, API-er og arbeidsjobber stenges.

Første oppstart uten modulrader bruker `MODULE_PRESET`:

- `full` (standard) – alle leverte moduler på. Eksisterende installasjoner som
  oppgraderer får denne automatisk når variabelen ikke er satt.
- `core` – bare kjerne (auth, brukere, avdelinger, kunder, oppdrag,
  arbeidsdager/tid, revisjon og innstillinger).

Se [`MODULES.md`](MODULES.md) for katalog, avhengighetsgraf, presets,
oppgraderingsløp og kjente begrensninger.

## Produksjonssett: image-pinning

Produksjon bruker `docker-compose.prod.yml`. Der er `APP_IMAGE` **påkrevd**:

```dotenv
APP_IMAGE=ghcr.io/eroticd/fsm-platform:v0.8.9
POSTGRES_IMAGE=postgres:15.13
```

- Pinn `APP_IMAGE` til en publisert release-tag, aldri `latest`. Da vet du
  nøyaktig hvilken kode som kjører, og en rollback er bare å bytte tag.
- Vil du være helt sikker på at taggen ikke flyttes, pinn til digest:

  ```bash
  docker pull ghcr.io/eroticd/fsm-platform:v0.8.9
  docker inspect --format='{{index .RepoDigests 0}}' \
    ghcr.io/eroticd/fsm-platform:v0.8.9
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

## Sikkerhetsheadere og kamera

Next setter disse headerne for alle ruter (se `src/lib/security-headers.ts` og
`next.config.ts`):

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(self)
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`camera=(self)` er nødvendig for QR-skanneren i feltappen. Uten den blokkerer
nettleseren `getUserMedia` før brukeren får spurt om tillatelse. Kameraet er
bare tilgjengelig for appens eget opphav; innebygd tredjepartsinnhold og
iframe-er får ikke tilgang. Mikrofonen er fortsatt av. Endres headeren, må
`src/lib/security-headers.test.ts` oppdateres, og kamera/HTTPS-oppførselen
testes på iPhone (Safari) og Android (Chrome).

Kameraskanning krever **HTTPS** i produksjon. `localhost` regnes som sikker
kontekst av nettleseren, men en LAN-adresse over `http://` gjør det ikke – da
vises en egen HTTPS-melding i skanneren. Sjekk headeren etter deploy:

```bash
curl -sI https://<vert>/skann | grep -i permissions-policy
# forventet: permissions-policy: camera=(self), microphone=(), geolocation=(self)
```

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
| Offline | 7 døgns side-, API- og filcache og 7 dagers lokale rapportkladder | `NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS` (valgfri, bygges inn i klienten) |
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

## Ruting og ETA

Ruteplanen (`/kalender/rute`) og den offentlige ETA-en i sporingen bruker samme
ruteleverandør. Uten konfigurasjon gjøres **ingen nettverkskall**: avstanden er
luftlinje × 1,35 (veifaktor) delt på `TRACKING_AVERAGE_SPEED_KMH` (standard 50).
Det gir forutsigbare tester og virker offline, men er bare et anslag.

Vil du bruke en OSRM-kompatibel ruteserver:

```dotenv
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=https://osrm.example.com
# ROUTING_TIMEOUT_MS=60000
# TRACKING_AVERAGE_SPEED_KMH=50
```

- `OSRM_BASE_URL` må være serverbar og uten innlogging i nettleseren. Nøkler og
  URL-er leses bare på serveren.
- Ruteleverandøren har `ROUTING_TIMEOUT_MS` (standard 60 000 ms, tillatt
  1 000–120 000). Ved feil, timeout eller ugyldig svar faller både ruteplanen og
  ETA-en tilbake til den lokale beregningen, og ruteplanen merker dette med
  **Beregning: Lokal estimering**.
- Ruteplanen kaller `/table` én gang per montør (maks 50 stopp). Sporings-ETA
  kaller `/route` for én strekning. Resultatene caches i ett minutt per
  avrundede koordinatnøkkel.
- ETA-en regnes fra siste `VisitLocationPing` til arbeidsstedets koordinater.
  Ping eldre enn **ti minutter** regnes som stale: da vises planlagt tid og
  «sist kjente posisjon», ikke en live ETA. Ingen koordinater, adresse eller navn
  returneres fra ETA-endepunktet.
- Den offentlige ETA-ruten er `GET /api/tracking/<token>/eta`. Den har
  `Cache-Control: no-store`, egen rate limit på 60 kall per minutt per gyldig
  token og samme token-scope som sporingen. Siden poller hvert 30. sekund.
- Posisjonsping slettes etter 24 timer. ETA-endepunktet skriver ikke nye
  posisjonsdata; bare sidevisningen oppdaterer `lastUsedAt` på lenken.
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
| `FsmSlaCleanupStale` | utdatert i 30 min | `SlaCleanupRun`, `SLA_CLEANUP_*`, scheduler |
| `FsmSlaCleanupFailed` | > 0 feilede siste 24 t | `SlaCleanupRun.error`, logger |

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

### Arbeidsdager: engangsbackfill

Eldre oppdrag kan ha én heldagsvisitt som strekker seg over flere dager. Den
nye modellen har én intern `Visit` per kalenderdag. Kjør derfor engangsjobben
mot en kopi/testdatabase først, ta backup, og deretter mot produksjon:

```bash
# Tørrkjøring: viser hvor mange visiter som deles, uten å skrive
npm run visits:backfill:daily

# Anvend når resultatet ser riktig ut
npm run visits:backfill:daily -- --apply
```

Skriptet er idempotent. Originalraden blir første dag og beholder status,
notater, tidsstempler (`enRouteAt`, `onSiteAt`, `doneAt`), `travelFromEndedAt`
og montører. Nye dager opprettes som `PLANNED` med samme montører og uten
kopierte tidsstempler, slik at fullført tid aldri dupliseres. Eksisterende
visiter beholder `travelFromEndedAt = null` til kjøringen lukkes manuelt med
«Avslutt kjøring» eller automatisk når montøren starter `EN_ROUTE` på neste
jobb. Skriptet rører ikke visiter som allerede dekker én dag, og skal ikke
kjøres automatisk av appen eller i CI mot produksjon.

Samme kjøring normaliserer også **eldre tidsstyrte enkeltdagsvisiter**
(`allDay: false`). En slik rad får `allDay: true` og start/slutt på hele
arbeidsdagen (Oslo-midnatt til neste midnatt). Status, notater, montører og
alle tidsstempler står urørt; ingen nye rader opprettes, så et tidsstempel kan
aldri dupliseres. Rader som ikke kan normaliseres uten å gjette, rapporteres
eksplisitt og endres ikke:

- tidsstyrt visitt over flere dager,
- flere tidsstyrte visiter på samme oppdrag og dag,
- dagen er allerede opptatt av en annen økt (heldagsøkt eller overlapp),
- tidsstempel som ligger utenfor visittdagen,
- ugyldig tidsrom, eller raden ble endret under `--apply`.

Tørrkjøringen viser antall normaliserte og en linje per rapportert rad med
årsak. Gå gjennom rapporten manuelt før `--apply`; tvetydige rader må ryddes i
appen eller med en bevisst manuell beslutning.

### SLA-klokker uten aktiv avtale

SLA-klokker skal bare finnes for oppdrag med en aktiv, datogyldig avtale og en
aktiv SLA-policy. Eldre data kan ha klokker uten slik dekning, eller klokker som
peker på en annen policy enn avtalen nå gir.

**Automatisk opprydding.** Scheduleren kjører oppryddingen ved oppstart og
deretter med `SLA_CLEANUP_INTERVAL_HOURS` (standard 6 timer). En ekstern cron
kan i tillegg kalle `/api/cron/recurring`; en advisory-lås og en due-sjekk gjør
at samtidige kall ikke dupliserer arbeid. Slås av med
`SLA_CLEANUP_ENABLED=false` når en ekstern prosess eier jobben.

- **Idempotent:** klokker som allerede er `CANCELLED` røres ikke, og klokker
  med gyldig aktiv avtale og samme policy beholdes uendret. Hver kjøring
  vurderer inntil 1000 klokker; en større engangsmengde tas over flere
  intervaller eller med CLI-en.
- **Transaksjon + revisjon:** hver kansellering skrives i samme transaksjon som
  revisjonsloggen.
- **Kjøringslogg:** hver kjøring får en rad i `SlaCleanupRun` med status,
  antall vurderte/beholdte/kansellerte og eventuell feil. Feil kaster aldri
  videre og stopper ikke de andre bakgrunnsjøbbene.
- **Metrics/varsel:** `/api/metrics` eksponerer `fsm_sla_cleanup_enabled`,
  `fsm_sla_cleanup_last_run_timestamp_seconds`,
  `fsm_sla_cleanup_last_cancelled`, `fsm_sla_cleanup_failed_runs` og
  `fsm_sla_cleanup_stale`. `deploy/monitoring/fsm-alerts.yml` varsler når
  jobben er utdatert eller har feilet.

Manuell kjøring er fortsatt tilgjengelig for feilsøking og engangsopprydding:

```bash
# Tørrkjøring: viser kandidatene uten å skrive
npm run sla:cleanup

# Anvend når listen ser riktig ut
npm run sla:cleanup -- --apply
```

Den manuelle kjøringen rører ikke `SlaCleanupRun`; den er bare et
diagnoseverktøy. `sweepSlaClocks` og oppdragsdetaljen ignorerer kansellerte
klokker, så de verken varsler eller vises i SLA-panelet. Ta backup og kjør mot
en kopi/testdatabase før `--apply` i produksjon.

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
at backupen er god. Kjør derfor restore-testen før du setter den.
`BACKUP_CONFIRMED` nullstilles ikke automatisk: fjern den eller sett den til
`false` etter vellykket oppstart, ellers er sperren åpen ved neste utrulling.
Prisma tar sin egen advisory lock, så flere instanser ikke migrerer samtidig.

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

> **Kortversjon:** `scripts/backup.sh` tar en logisk `pg_dump` av databasen og
> et tar-arkiv av `fsm_uploads`, krypterer begge med age i strøm, skriver
> SHA-256-sjekksum og en atomisk statusfil, og kopierer valgfritt til
> `BACKUP_REMOTE` med rclone. Produksjon nekter å ta backup uten
> `BACKUP_AGE_RECIPIENT`. Daglig backup, daglig ferskhetskontroll og ukentlig
> restore-test kjøres av systemd-enhetene i `deploy/systemd/` og varsler via
> `scripts/ops-alert.sh`.
>
> **Full runbook:** se [BACKUP-RESTORE.md](BACKUP-RESTORE.md) for RPO/RTO,
> nøkkelgjenoppretting, full disaster restore, Azure PITR/Azure Backup,
> enkeltfilgjenoppretting, feilsøking og sjekklister. Denne seksjonen er
> oppsummeringen og de raske kommandoene.

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
(standard 30 i backupjobben) styrer hvor lenge lokale filer beholdes; ekstern
lagring bør ha egen, lengre oppbevaring. Merk at appen bruker samme variabelnavn
med standard 365 for oppdragsretention – hold backupjobbens verdi og appens
`.env` adskilt.

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

## SSO (OIDC) og SCIM-provisjonering

SSO og SCIM er valgfritt og konfigureres utelukkende med miljøvariabler. Uten
dem virker passordinnlogging som før. Passordinnloggingen fjernes aldri når SSO
slås på – den er den dokumenterte break-glass-veien for administrator.

### OIDC-leverandører

List leverandørene i `SSO_PROVIDERS` med komma. Hver leverandør får en slug, og
alle innstillinger prefikses med `SSO_<SLUG>_` (store bokstaver, bindestrek blir
understrek). Eksempel med Entra ID og Keycloak:

```dotenv
SSO_PROVIDERS=entra,keycloak

SSO_ENTRA_DISPLAY_NAME=Microsoft Entra ID
SSO_ENTRA_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
SSO_ENTRA_CLIENT_ID=<application-client-id>
SSO_ENTRA_CLIENT_SECRET=<client-secret>
SSO_ENTRA_SCOPES=openid,email,profile
SSO_ENTRA_ALLOWED_EMAIL_DOMAINS=example.no,example.com
SSO_ENTRA_AUTO_PROVISION=false
SSO_ENTRA_AUTO_PROVISION_ACTIVE=false
SSO_ENTRA_DEFAULT_ROLE=USER
SSO_ENTRA_DEFAULT_DEPARTMENT=Oslo
SSO_ENTRA_GROUPS_CLAIM=groups
SSO_ENTRA_GROUP_ROLE_MAP={"FSM-Office":"OFFICE","FSM-Technicians":"TECHNICIAN"}
SSO_ENTRA_SYNC_ROLES=false

SSO_KEYCLOAK_DISPLAY_NAME=Keycloak
SSO_KEYCLOAK_ISSUER=https://keycloak.example.no/realms/fsm
SSO_KEYCLOAK_CLIENT_ID=fsm-web
SSO_KEYCLOAK_CLIENT_SECRET=<client-secret>
SSO_KEYCLOAK_ALLOWED_EMAIL_DOMAINS=example.no
SSO_KEYCLOAK_GROUPS_CLAIM=groups
SSO_KEYCLOAK_GROUP_ROLE_MAP=FSM-Office=OFFICE,FSM-Field=TECHNICIAN
```

| Variabel | Betydning |
| --- | --- |
| `SSO_<SLUG>_ENABLED` | `false` skjuler leverandøren uten å fjerne konfigurasjonen. Standard `true`. |
| `SSO_<SLUG>_ISSUER` / `_DISCOVERY_URL` | Issuer eller full discovery-URL. Discovery utledes som `<issuer>/.well-known/openid-configuration`. |
| `SSO_<SLUG>_CLIENT_ID` / `_CLIENT_SECRET` | Klient for den konfidensielle OIDC-applikasjonen. |
| `SSO_<SLUG>_SCOPES` | Kommaseparert. `openid` legges alltid til. Standard `openid,email,profile`. |
| `SSO_<SLUG>_DISPLAY_NAME` | Teksten på knappen på innloggingssiden. |
| `SSO_<SLUG>_ALLOWED_EMAIL_DOMAINS` | Kommaseparert liste. Tom betyr alle domener. |
| `SSO_<SLUG>_AUTO_PROVISION` | `true` oppretter ukjente brukere. Standard `false`. |
| `SSO_<SLUG>_AUTO_PROVISION_ACTIVE` | `true` aktiverer nye brukere med en gang. Standard `false` (administrator må aktivere). |
| `SSO_<SLUG>_DEFAULT_ROLE` | Rolle for auto-provisjonerte brukere. Standard `USER`. `CUSTOMER` er ikke tillatt. |
| `SSO_<SLUG>_DEFAULT_DEPARTMENT` | Avdelingsnavn eller id for auto-provisjonerte brukere. |
| `SSO_<SLUG>_GROUPS_CLAIM` | Claim med grupper/roller. Standard `groups`. Punktnotasjon og Zitadel-rolleobjekt støttes. |
| `SSO_<SLUG>_GROUP_ROLE_MAP` | JSON-objekt eller `gruppe=ROLLE,...`. Eksplisitt mapping fra gruppe til rolle. |
| `SSO_<SLUG>_SYNC_ROLES` | `true` oppdaterer rollen ved hver innlogging ut fra gruppene. Standard `false`: en eksisterende brukers rolle endres aldri stille. |

**Redirect-URL** i IdP-en er alltid:

```text
https://<NEXTAUTH_URL>/api/auth/callback/sso-<slug>
```

Eksempel: `https://fsm.example.no/api/auth/callback/sso-entra`. URL-en må være
eksakt, ellers avviser IdP-en tilbakekallingen. NextAuth bruker authorization
code flow med PKCE, `state` og `nonce`, og validerer signatur, issuer, audience
og nonce mot discovery-dokumentet.

### Leverandøreksempler

- **Microsoft Entra ID:** registrer en webapplikasjon, legg redirect-URL-en
  over under *Authentication*. Gi `openid`, `email`, `profile` og eventuelt
  `GroupMember.Read.All` for grupper. Legg `email` og `groups` som optional
  claims i ID-tokenet. Entra setter ofte ikke `email_verified`; appen godtar i
  stedet `xms_edov=true` fra tenanten. Autorisasjon skjer i tenanten – ikke
  bruk en multi-tenant app uten å begrense `ALLOWED_EMAIL_DOMAINS`.
- **Keycloak:** lag en confidential client med *Standard Flow*, skru på PKCE,
  og legg redirect-URL-en under *Valid redirect URIs*. Legg en group membership
  mapper til i client scope med *Add to ID token*, slik at `groups` inneholder
  gruppenavnene som `GROUP_ROLE_MAP` refererer til.
- **Authentik:** lag en OAuth2/OpenID-provider og en application. Redirect-URL
  settes under *Redirect URIs*. Bruk en scope-mapping som legger gruppene i
  `groups`-claimet. Issuer er
  `https://<authentik>/application/o/<app-slug>/`.
- **Zitadel:** lag en OIDC-applikasjon av typen *Web*, legg redirect-URL-en inn,
  og be om `urn:zitadel:iam:org:project:roles` som scope/claim. Appen leser
  rolleobjektet som nøkler, så `SSO_ZITADEL_GROUPS_CLAIM` settes til
  `urn:zitadel:iam:org:project:roles`.

SAML er ikke implementert. Entra ID, Keycloak, Authentik og Zitadel dekkes via
OIDC; SAML kan legges til senere uten å endre kontomodellen.

Appen leser claims fra **ID-tokenet**. Sørg for at grupper/roller er med der,
ikke bare i userinfo. Entra ID utelater `groups` når brukeren er medlem av
svært mange grupper (overage). Da må gruppene begrenses eller hentes via en
egen app-rolle; appen mapper ikke overage-claims automatisk.

### Konto, rolle og 2FA

- En ny identitet matches først på `(leverandør, sub)`. E-post brukes bare ved
  første kobling, og bare når leverandøren har bekreftet adressen.
- En e-post som allerede tilhører en **aktiv** bruker kobles til den brukeren.
  Rollen endres ikke med mindre `SYNC_ROLES=true` og gruppemappingen gir en
  annen rolle. Koblingen og en eventuell rolleendring revisjonslogges.
- Kundeportalbrukere og brukere med `customerId` kobles aldri. Ukjente brukere
  avvises med en tydelig feilmelding når auto-provisjonering er av.
- Auto-provisjonerte brukere får ingen passord. Standard er inaktiv konto og
  rollen `USER`; en administrator må aktivere kontoen i **Ansatte & Roller**.
  Sett `AUTO_PROVISION_ACTIVE=true` bare når IdP-en er autoritativ for hele
  brukerpopulasjonen.
- Grupper som peker på flere ulike roller avvises. Rydd mappingen i stedet for
  å la appen velge «høyeste» rolle. `ADMIN` kan mappes eksplisitt, men bør være
  en egen, liten gruppe.
- Påkrevd 2FA (`REQUIRE_2FA_ROLES`) gjelder også SSO. En bruker med 2FA må
  taste engangskoden, og en privilegert bruker uten oppsett sendes til
  `/logg-inn/2fa/oppsett` før noen sesjon opprettes. SSO omgår aldri policyen.
- Deaktivert bruker, øktversjon som ikke stemmer, eller en rolle som er fjernet
  gir avvist innlogging/økt på neste forespørsel.

### SCIM 2.0

SCIM-flaten ligger under `/api/scim/v2` og krever `Authorization: Bearer
<scim-token>`. Sesjonscookies godtas ikke. Endepunkter:

| Endepunkt | Metode | Formål |
| --- | --- | --- |
| `/api/scim/v2/Users` | `GET` | Liste med `filter`, `startIndex`, `count`. Støtter `eq`, `ne`, `co`, `sw`, `pr` og `and` på `userName`, `emails.value`, `externalId`, `active`, `id`, `displayName` og `role`. |
| `/api/scim/v2/Users` | `POST` | Opprett bruker. `active=true` må sendes eksplisitt for at kontoen skal kunne logge inn. |
| `/api/scim/v2/Users/{id}` | `GET` / `PUT` / `PATCH` / `DELETE` | Hent, erstatt, deloppdater eller deaktiver. `DELETE` er myk deaktivering. |
| `/api/scim/v2/ServiceProviderConfig` | `GET` | Kapabiliteter for IdP-oppsett. |

- **Tokens:** opprettes under **Innstillinger → SSO og SCIM** av administrator.
  Bare SHA-256-hash og et visningsprefiks lagres. Klarteksttokenet vises én gang.
  Bruk ett token per IdP/integrasjon, og roter ved mistanke om lekkasje. Rotering
  tilbakekaller det gamle tokenet i samme transaksjon. Sist brukt og utløp vises
  i listen. Standard levetid er 365 dager (`SCIM_TOKEN_DEFAULT_LIFETIME_DAYS`),
  maks 730 (`SCIM_TOKEN_MAX_LIFETIME_DAYS`).
- **Entra:** *Provisioning → Automatic* med tenant-URL
  `https://fsm.example.no/api/scim/v2` og det hemmelige tokenet. Test connection
  og start provisjonering. Gruppen som gir ADMIN bør ikke være standardmapping.
- **Keycloak/Authentik/Zitadel:** bruk SCIM-klienten eller
  synkroniseringsjobben deres mot samme URL og token.
- **Feltmapping:** `userName`/`emails` → `User.email`, `externalId` →
  `User.scimExternalId`, `active` → `isActive`, `name` → navn, og
  enterprise-extension `department` → avdeling. Passordfelt ignoreres alltid.
  Ukjente PATCH-paths gir `400` i stedet for å bli stille ignorert.
- **Roller:** `SCIM_DEFAULT_ROLE` (standard `USER`) brukes ved opprettelse.
  `SCIM_GROUP_ROLE_MAP` mapper grupper/roller eksplisitt. `ADMIN` krever i
  tillegg `SCIM_ALLOW_ADMIN=true`. `CUSTOMER` kan ikke tildeles.
- **Domener:** `SCIM_ALLOWED_EMAIL_DOMAINS` begrenser hvilke adresser som kan
  provisjoneres. Tom liste betyr alle.
- **Sikkerhet:** SCIM kan ikke endre kundeportalbrukere, og kan ikke sette
  passord. Endringer i rolle, avdeling, e-post eller aktiv status øker
  `sessionVersion`, slik at eksisterende økter dør. Alle opprettelser,
  oppdateringer, deaktiveringer og tokenoperasjoner revisjonslogges.
  Bruk av tokenet revisjonslogges maks én gang i timen per token.
- **Rate limit:** 120 kall per minutt per token, delt mellom app-instansene.
  Overskridelse gir `429` med `Retry-After`.
- **Feilformat:** alle feil, også 401/403/404/409, bruker
  `application/scim+json` og `{ "schemas": [«...Error»], "detail": ..., "status": "400" }`.
- **Begrensninger:** SCIM Groups er ikke implementert. Rolle styres av `roles`
  / `groups` på brukeren og den eksplisitte mappingen. SAML er ikke
  implementert; Entra ID, Keycloak, Authentik og Zitadel bruker OIDC.

### Break-glass og minste privilegium

- Behold minst to lokale administratorer med sterkt passord og 2FA, også når
  SSO er på. Passordskjemaet på `/logg-inn` vises alltid.
- En lokal administrator kan låse seg ute av SSO ved feil i IdP-en. Da brukes
  den lokale kontoen, og `node scripts/break-glass-2fa.mjs --email ... --confirm`
  er den dokumenterte nødveien for 2FA.
- Gi `SSO_*_DEFAULT_ROLE=USER` og eksplisitt gruppemapping for kontor, montør
  og eventuelt admin. Ikke map en bred «alle ansatte»-gruppe til `ADMIN`.
- Begrens `ALLOWED_EMAIL_DOMAINS` og bruk én IdP-tenant per kundeinstallasjon.
  Del aldri SCIM-token mellom miljøer eller kunder.

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
  feilmelding. Kvoten reserveres atomisk før filen flyttes til den endelige
  mappen: en kortlevd `UploadQuotaReservation` teller sammen med ferdige
  `Upload`-rader, og en transaksjonslåst advisory lock serialiserer kontroll og
  innsetting per bruker/kunde. Samtidige opplastinger kan derfor ikke lenger
  passere grensen sammen. Reservasjonen skrives om til en `Upload`-rad i samme
  transaksjon som den slettes; avvises opplastingen, slettes både filen og
  reservasjonen. Utløpte reservasjoner (15 min) ignoreres og ryddes av
  `/api/cron/cleanup`. Volumbegrensning i drift er fortsatt nødvendig som
  ytterste sikkerhet.
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

### Personvern og sletting av kundedata

- Admin-only flyt på kundekortet: **Mer → Personvern / Slett kundedata**.
  Forhåndsvisningen viser antall berørte rader og blokkerer ved
  `WorkOrder.legalHold`, `Report.legalHold` eller aktivt `AuditHold`.
- Slettingen anonymiserer direkte identifikatorer i én databasetransaksjon.
  Oppdrag, rapporter, revisjoner, signerte rapport-PDF-er, teknikersignaturer
  og revisjonsloggen bevares. Kundens egne vedlegg og dokumentbibliotek slettes.
- Signerte rapport-PDF-er bevares uendret som tjenestebevis og kan fortsatt
  inneholde opprinnelige data. Det er et dokumentert retensjonsvalg, ikke en
  feil. Se [`privacy-erasure.md`](privacy-erasure.md) for retensjonsmatrise,
  prosedyre og bevis.
- Etter store slettinger: kontroller `UPLOAD_DIR` for filer uten `Upload`-rad.
  Tjenesten forsøker å rydde dem, men filer fra eldre data kan mangle metadata.
  Sammenlign med `Upload.storedName` før manuell sletting.

### Kundeoverføring (eksport/import)

- Midlertidige kundepakker og staging ligger i `UPLOAD_DIR/.transfer/<jobbId>/`.
  Mappen opprettes med `0700`, og `package.zip` skrives med `0600`.
- **Grenser:** maks 50 MiB per fil, 500 MiB per pakke (ukomprimert og
  komprimert), 20 000 ZIP-oppføringer og kompresjonsforhold 100:1. Hele pakken
  holdes i minnet, så den praktiske minnegrensen er også 500 MiB.
  `next.config.ts` (`proxyClientMaxBodySize`) er hevet til 512 MiB for å slippe
  importkroppen gjennom proxyen.
- **Asynkrone jobber:** eksport starter som `PENDING`; bekreftet import blir
  `QUEUED`. Workeren i `src/lib/customer-transfer/worker.ts` henter én jobb om
  gangen med `FOR UPDATE SKIP LOCKED`, setter `RUNNING`, oppdaterer
  `progressStage`/`progressProcessed`/`progressTotal` og avslutter som `READY`,
  `COMPLETED` eller `FAILED`. Statusruten polles av UI-et. Workeren starter fra
  `startJobWorker()` når `transfer`-modulen er på.
- **Gjenopptak:** en `RUNNING`-jobb uten oppdatering i mer enn
  `CUSTOMER_TRANSFER_STALE_JOB_MS` (standard 60 min) settes tilbake til
  `PENDING` (eksport) eller `QUEUED` (import). Eksport bygges på nytt fra
  scratch; importens databasetransaksjon er atomisk med jobbstatusen, så et
  nytt forsøk kan ikke duplisere rader. `CUSTOMER_TRANSFER_JOB_RETENTION_DAYS`
  styrer hvor lenge terminale jobbrader beholdes (standard 90 dager eksport,
  365 dager import).
- **Én aktiv import per pakke/kunde:** bekreftelse tar en PostgreSQL advisory
  lock på pakkesjekksummen. En ny import av samme pakke mens en annen er
  `QUEUED` eller `RUNNING` avvises med `409`. Selve anvendelsen låser også hver
  eksisterende målkunde (sortert, for å unngå deadlock), slik at to ulike
  pakker som treffer samme kunde serialiseres.
- **Signatur (anbefalt):** to moduser kan brukes sammen. Begge signerer
  manifestet og `checksums.sha256` med samme kanoniske payload.
  - **HMAC-SHA256:** sett `CUSTOMER_TRANSFER_SIGNING_KEY` (minst 32 tegn,
    f.eks. `openssl rand -base64 48`) på både kilde- og målinstallasjonen.
    Eksporten legger signaturen i `manifest.sig`. Den er bakoverkompatibel med
    alle eksisterende pakker.
  - **Ed25519:** generer et nøkkelpar på kildeinstallasjonen:
    `openssl genpkey -algorithm ED25519 -out transfer-ed25519-private.pem` og
    `openssl pkey -in transfer-ed25519-private.pem -pubout -out transfer-ed25519-public.pem`.
    Sett `CUSTOMER_TRANSFER_ED25519_PRIVATE_KEY` på kilden og
    `CUSTOMER_TRANSFER_ED25519_PUBLIC_KEY` på mottakeren. PEM kan inneholde
    ekte linjeskift eller escaped `\n` (nyttig i Docker/env-filer).
    `CUSTOMER_TRANSFER_ED25519_KEY_ID` er en valgfri, ikke-hemmelig etikett for
    logging. Eksporten legger signaturen i `manifest.sig.ed25519`.
    På en installasjon som bare skal verifisere, settes bare den offentlige
    nøkkelen. Setter man bare privatnøkkelen, utleder appen den offentlige
    nøkkelen for egen verifisering; dette er praktisk i enkeltinstallasjoner.
  - **Modus:** `CUSTOMER_TRANSFER_SIGNATURE_MODE` kan være `hmac`, `ed25519`,
    `both` eller `any`. `hmac`/`ed25519` godtar bare den valgte algoritmen og
    ignorerer den andre med en advarsel. `both` krever at begge signaturfilene
    finnes og er gyldige. `any` krever minst én gyldig av de konfigurerte
    algoritmene. Standard er `any` når både HMAC og Ed25519 er konfigurert,
    ellers den ene konfigurerte algoritmen. Standardvalget bevarer gamle
    HMAC-pakker etter at Ed25519 tas i bruk. En signatur som er til stede, men
    ugyldig, avvises alltid – også i `any`.
  - Sett `CUSTOMER_TRANSFER_REQUIRE_SIGNATURE=true` for å kreve signatur.
    Pakker med feil nøkkel får `customer_transfer.signature_untrusted`, endret
    innhold får `customer_transfer.signature_invalid`, og manglende påkrevd
    signatur får `customer_transfer.signature_missing`.
  - **Nøkkellagring:** private nøkler og HMAC-hemmeligheter skal aldri i git,
    logger, pakken eller vanlige env-filer i klartekst. Bruk
    secrets-manager/Docker secret, begrens lesetilgang og roter ved mistanke om
    lekkasje. Den offentlige Ed25519-nøkkelen er ikke hemmelig og kan
    distribueres over en verifisert kanal.
  - **Rotasjon:** generer nytt nøkkelpar (eller ny HMAC-nøkkel), sett den nye
    som aktiv signeringsnøkkel og legg den gamle offentlige nøkkelen i
    `CUSTOMER_TRANSFER_ED25519_PUBLIC_KEYS_PREVIOUS` (kommaseparert PEM eller
    JSON-array med PEM/`{id, publicKey}`). For HMAC legges den gamle nøkkelen i
    `CUSTOMER_TRANSFER_SIGNING_KEYS_PREVIOUS` (kommaseparert). Nye pakker
    signeres med den nye nøkkelen; gamle verifiseres med den gamle. Fjern gamle
    verifiseringsnøkler når alle mellomliggende pakker er importert eller
    utløpt.
  - **Gjenoppretting:** mistes privatnøkkelen, kan nye pakker ikke signeres med
    den. Generer et nytt par, distribuer den nye offentlige nøkkelen og behold
    den gamle offentlige nøkkelen til gamle pakker er importert. Mistes en
    offentlig nøkkel på mottakeren, kan pakken ikke verifiseres; skaff den fra
    en verifisert kanal. Signer aldri om en mottatt pakke for å «reparere» den.
  - **Trust model:** HMAC er et delt hemmelighetssystem. Det beviser at pakken
    er laget av noen med nøkkelen, ikke hvem i en juridisk
    ikke-fornektelsesforstand. Ed25519 fjerner behovet for å dele en hemmelighet
    med mottakeren og gir asymmetrisk verifisering, men det er fortsatt én
    felles signeringsidentitet for installasjonen – ikke per-bruker
    ikke-fornektelse. I `any`-modus kan en gyldig HMAC-signatur godtas når
    Ed25519 mangler; bruk `both` eller `ed25519` hvis bare asymmetrisk
    verifisering skal være mulig.
- **Valgfri kryptering:** `npm run transfer:encrypt -- pakke.zip pakke.fsmenc`
  (eller `TRANSFER_PASSPHRASE=...`) lager et AES-256-GCM-omslag med
  scrypt-nøkkel. Import kan ta imot `.fsmenc` med passfrasen i multipart-feltet
  `passphrase`; CLI kan også dekryptere med `npm run transfer:decrypt`.
  - **Admin-UI:** importfanen har et eget passordfelt for `.fsmenc`. Feltet
    sendes bare som multipart `passphrase` i den ene opplastingsforespørselen,
    tømmes fra React-state etter at pakken er tatt imot, og lagres aldri i DB,
    jobb-JSON eller logg. Vanlige ZIP-pakker lastes opp uten passfrase.
    Manglende passfrase gir `customer_transfer.passphrase_required`; feil
    passfrase gir `customer_transfer.decryption_failed`. Begge vises som
    oversatte feilmeldinger i UI-et.
  - **Eksport:** nedlastingsknappen lager en vanlig ZIP. Skal pakken krypteres
    før overføring, kjøres CLI-en etter nedlasting og `.fsmenc`-filen lastes opp
    i mottakerens importfane. `X-Transfer-Passphrase` er bare for CLI og må ikke
    logges av proxyer. Bruk TLS i tillegg.
- **Levetid/opprydding:** eksportartefakter og importstaging utløper etter 24
  timer. `cleanupExpiredTransfers()` kalles hver time, avstemmer filer, sletter
  staging, markerer jobben `EXPIRED` og fjerner forlatte kataloger uten levende
  jobb. Hjelperen kan også kalles manuelt ved diskmangel.
- **Avstemming etter krasj:** importen skriver fillisten
  `.transfer/<jobbId>/final-files.json` før første sluttfil. Jobben
  `reconcileTransferFiles()` sletter bare navn fra denne listen, og bare når
  `isUploadReferenced()` bekrefter at ingen attachment, dokument(versjon),
  rapport, revisjon eller kladd peker på filen. Refererte filer slettes aldri.
  Kjør manuelt med `npm run transfer:reconcile` dersom en import krasjet og
  staging fortsatt finnes. Den skriver en JSON-oppsummering og er trygg å
  gjenta. Slett aldri filer i `UPLOAD_DIR` manuelt uten å sammenligne med
  `Upload.storedName` og referansetabellene.
- **Ingen offentlig URL:** ZIP-en serveres bare fra en autentisert adminrute
  med `no-store`. Den skal aldri legges i `public/`, `/uploads` eller en delt
  cache.
- **Ikke backup:** kundepakken er et overføringsverktøy for én eller flere
  kunder. Den erstatter ikke PostgreSQL-backup + uploadvolum, og den inneholder
  bevisst ikke passord, sesjoner, API-nøkler eller 2FA-hemmeligheter.
- **Eksisterende QR-koder:** kundens egne QR-verdier følger med i
  `data/equipment-qr-codes.json` og importeres med kilden `IMPORT`. Verdiene er
  globalt unike, også på tvers av kunder. En kollisjon i målbasen er en
  konflikt som blokkerer importen; den importeres aldri som en ny kobling på
  feil enhet. `Product.qrToken` gjenbrukes ikke.
- **Overvåking:** følg diskbruk på `UPLOAD_DIR`, antall `QUEUED`/`RUNNING` som
  ikke beveger seg, og antall `FAILED`. Utløpte jobber skal forsvinne fra
  staging innen en time etter `expiresAt`. Jobb-JSON inneholder bare ID-er,
  antall, sjekksummer, regler og stabile feilkoder – aldri navn, e-post,
  filnavn eller passfrase.

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
| PDF vises ikke i appen, men kan lastes ned | nettleserens PDF-støtte, CSP `frame-src 'self' blob:`/`object-src 'none'`, prøv **Åpne i ny fane** |
| PDF mangler bilder eller signaturer | advarsel i PDF-en, `report_pdf_images_missing` i loggen, `Upload`-rad med riktig `ownerId`/`departmentId`/`customerId`, og at filen finnes i `UPLOAD_DIR` |
| OCR henger | `DocumentJob`-status, `PDF_JOB_WORKER`, `TESSDATA_DIR`, full `/tmp` |
| Serviceavtaler lages ikke | `RECURRING_SCHEDULER`, advisory lock, `nextServiceDate` |
| SLA-oppryddingen kjører ikke | `SLA_CLEANUP_ENABLED`, `SLA_CLEANUP_INTERVAL_HOURS`, `SlaCleanupRun`, advisory lock, `fsm_sla_cleanup_stale` |
| Disk full | `df -h /`, `docker system df -v`, opplastingsvolum, backupfiler |

Rapport-PDF-er bygger inn bilder og signaturer fra `UPLOAD_DIR` bare når
`Upload`-raden eies av nøyaktig samme oppdrag, avdeling og kunde. Filen leses
aldri over HTTP fra `/uploads` under rendering. Når et forventet bilde ikke kan
bygges inn, skrives en advarsel i PDF-en og `report_pdf_images_missing` logges
med antall (uten filnavn eller personopplysninger). PDF-cachen har en egen
`rendererVersion`; den må økes når bildeinnbygging endres, slik at gamle PDF-er
uten bilder ikke gjenbrukes.

Rapport- og revisjons-PDF-er leveres som vedlegg som standard. Den innebygde
viseren ber eksplisitt om `?inline=1`, og ruten svarer først
`Content-Disposition: inline` etter at `sanitizePdfActiveContent` har godkjent
filen. Feiler saneringen, svarer ruten 422 og viser en feilmelding i appen; den
usanerte filen sendes aldri. Begge variantene har `Cache-Control: no-store` og
`X-Content-Type-Options: nosniff`. CSP-en tillater `frame-src 'self' blob:` for
viseren og beholder `object-src 'none'`.

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

## Native feltapp

Android- og iOS-appen ligger i et eget repo: [`fsm-mobile`](https://github.com/EroticD/fsm-mobile). Plattformen
inneholder ikke lenger Capacitor-prosjekter, skall eller signeringsfiler.

- Appen starter på en lokal oppsettside der brukeren skriver inn URL-en til
  FSM-installasjonen. Adressen lagres native og er ikke bygget inn.
- Serveradressen kan endres fra tannhjulet nederst i appen.
- Plattformens service worker cacher sider, API-GET og `/uploads/`-filer i
  **7 døgn** per bruker. Cacheene slettes ved utlogging, utløpt økt og «Bytt
  server».
- Bygg, signering, lokal testserver og butikkoppføring er dokumentert i
  `fsm-mobile`-repoets `README.md` og `docs/NATIVE.md`.

Plattformen må fortsatt angi riktig `NEXTAUTH_URL` og `AUTH_TRUST_HOST`, og
bruke HTTPS i produksjon. Push (FCM/APNs) er ikke satt opp.
