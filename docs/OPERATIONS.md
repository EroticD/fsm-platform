# Drift og feilsøking

## Helse og readiness

- `GET /api/health` — **liveness**. Svarer 200 når appen og databasen er oppe.
- `GET /api/ready` — **readiness**. Sjekker database, skrivbart
  opplastingsvolum og at jobbkøen kan leses. Returnerer 503 når noe mangler.
- Docker-healthchecken bruker `/api/ready`, slik at en container uten skrivbart
  volum ikke får trafikk.

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
- Ved oppstart registreres eldre filer med `scripts/backfill-uploads.mjs`
  (`BACKFILL_UPLOADS=false` slår det av).
- Når et dokument, vedlegg eller oppdrag slettes, frigjøres filen bare når
  ingen andre rader refererer til den (`src/lib/upload-cleanup.ts`).

## Skalering

- Rate limits og jobbkø ligger i databasen og deles mellom instanser.
- Serviceavtale-genereringen bruker en PostgreSQL advisory lock, så bare én
  instans genererer om gangen.
- PDF-rendering har en prosesslokal semaphore (maks 2). Ved flere instanser
  gjelder grensen per instans.
- For større installasjoner: bytt lokal disk mot S3-kompatibel lagring og
  vurder Redis/BullMQ for kø og rate limits (P4).

## Feilsøking

| Symptom | Sjekk |
| --- | --- |
| 503 fra `/api/ready` | database, `UPLOAD_DIR`-tilgang, jobbkø |
| Innlogging logger ut alle | `sessionVersion` er økt (passord/rolle/2FA-endring) |
| PDF vises ikke | `APP_URL`/`NEXTAUTH_URL`, `Upload`-rad for filen |
| OCR henger | `DocumentJob`-status, `PDF_JOB_WORKER`, `TESSDATA_DIR` |
| Serviceavtaler lages ikke | `RECURRING_SCHEDULER`, advisory lock, `nextServiceDate` |
