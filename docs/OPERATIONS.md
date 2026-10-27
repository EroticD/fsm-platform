# Drift og feilsøking

## Helse og readiness

- `GET /api/health` — **liveness**. Billig: svarer 200 når Node-prosessen
  lever, uten database-, disk- eller køkall. Docker-healthchecken bruker denne,
  slik at en treg database ikke gir restart-løkke.
- `GET /api/ready` — **readiness**. Uautentiserte kall får en kort status og en
  billig databasekontroll (rate-limitert per IP). Med `READY_SECRET` eller
  `CRON_SECRET` sjekkes også skrivbart opplastingsvolum og jobbkøen, og
  detaljene returneres. Returnerer 503 når noe mangler.

Bruk `/api/ready` fra orchestratoren før trafikk sendes til instansen.
Begge svarer med `requestId`, slik at loggen kan korreleres med forespørselen.
Proxyen setter `x-request-id` på alle svar.

## Logger

Loggene er JSON-linjer:

```json
{"time":"2026-10-24T08:00:00.000Z","level":"info","message":"...","requestId":"...","userId":"..."}
```

`LOG_LEVEL` styrer nivået (`debug`, `info`, `warn`, `error`; standard `info`).
Bruk `logger.info/warn/error` fra `src/lib/logger.ts` i ny kode. Eldre
`console.*`-kall migreres gradvis.

## Migrasjoner

Appen kjører `prisma migrate deploy` ved oppstart. For å kjøre migrasjonene som
et eget steg:

```bash
SKIP_MIGRATIONS=true docker compose up -d app
docker compose run --rm app node ./node_modules/prisma/build/index.js migrate deploy
```

Bruk alltid `prisma migrate deploy` i produksjon — aldri `prisma db push`.
Verifiser skjemaet med:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

### Trygg migrasjonsport i produksjon

Sett `REQUIRE_BACKUP_BEFORE_MIGRATE=true` i produksjon. Da nekter
oppstartsskriptet å kjøre migrasjoner før du har tatt backup og starter med
`BACKUP_CONFIRMED=true`:

```bash
./scripts/backup.sh
./scripts/restore-test.sh   # verifiser at backupen kan leses
BACKUP_CONFIRMED=true docker compose -f docker-compose.prod.yml up -d
```

Standard er av, slik at lokal utvikling og eksisterende oppsett ikke endres.
Prisma tar sin egen advisory lock, så flere instanser ikke migrerer samtidig.

## Seed

`SEED_DATABASE` er **false** som standard. Sett det bare eksplisitt til `true`
før første oppstart mot en tom database, og fjern det etterpå:

```bash
SEED_DATABASE=true SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... docker compose up -d
```

## Backup og restore

Ta backup av database og opplastingsvolum:

```bash
./scripts/backup.sh
```

Test at backupen kan gjenopprettes (oppretter og sletter en midlertidig
database):

```bash
BACKUP_FILE=backups/db-20261024-030000.sql.gz ./scripts/restore-test.sh
```

Backupene bør lagres kryptert og utenfor samme maskin. `scripts/backup.sh`
beholder 30 dager som standard (`RETENTION_DAYS`).

## Opplastinger

- Filer ligger i `UPLOAD_DIR` (standard `./uploads`, i Docker `/app/uploads`).
- `/uploads/...` krever innlogging og sjekker `Upload`-raden per fil.
- Per-fil-grenser: 15 MB for bilder og 50 MB for PDF (`UPLOAD_MAX_IMAGE_MB`,
  `UPLOAD_MAX_DOCUMENT_MB`). Hele forespørselen avvises tidlig med 413 basert på
  `Content-Length`, og filstørrelsen sjekkes på nytt etter parsing.
- Sharp/bildeflyt og skriving går gjennom en prosesslokal kø
  (`UPLOAD_CONCURRENCY`, standard 2). Store PDF-er strømmes til disk uten en
  ekstra full buffer i minnet.
- Rapporter sendes som server action med små signaturbilder. `bodySizeLimit` er
  hevet til 20 MB for dette skjemaet; vanlige bilder/PDF-er skal fortsatt gå via
  `/api/upload`.
- Ved oppstart registreres eldre filer med `scripts/backfill-uploads.mjs`
  (`BACKFILL_UPLOADS=false` slår det av).
- Når et dokument, vedlegg eller oppdrag slettes, frigjøres filen bare når
  ingen andre rader refererer til den (`src/lib/upload-cleanup.ts`).

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
| Innlogging logger ut alle | `sessionVersion` er økt (passord/rolle/2FA-endring) |
| PDF vises ikke | `APP_URL`/`NEXTAUTH_URL`, `Upload`-rad for filen |
| OCR henger | `DocumentJob`-status, `PDF_JOB_WORKER`, `TESSDATA_DIR` |
| Serviceavtaler lages ikke | `RECURRING_SCHEDULER`, advisory lock, `nextServiceDate` |
