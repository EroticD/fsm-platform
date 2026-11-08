# Lagring: lokal disk, S3 og MinIO

Appen lagrer opplastinger gjennom et felles `StorageDriver`-grensesnitt i
`src/lib/storage/`. Standard er fortsatt lokal disk, så eksisterende
installasjoner trenger ingen endring. Med `STORAGE_DRIVER=s3` kan flere
app-replikaer dele samme filer.

## Drivere

| Driver | Når | Rot | URL-er |
| --- | --- | --- | --- |
| `local` (standard) | Én app-instans, én disk | `UPLOAD_DIR` (standard `./uploads`, i Docker `/app/uploads`) | `/uploads/<filnavn>` |
| `s3` | Flere replikaer, HA, ekstern lagring | `S3_PREFIX` i `S3_BUCKET` | Samme `/uploads/<filnavn>` |

URL-ene og de lagrede filnavnene er **uendret**. En `Upload.storedName` er
alltid en relativ nøkkel uten skråstrek for vanlige opplastinger. Interne
stagingfiler for kundeoverføring ligger under `.transfer/<jobbId>/` i samme
lager, men `/uploads` nekter å serve nøkler som starter med «.».

`StorageDriver` har `read`, `write`, `writeFromFile`, `delete`, `stat`, `list`,
`stream`, `healthCheck` og `localPath`. `localPath` er bare en snarvei for
verktøy som `pdftotext` og tesseract; ved S3 lastes filen ned til
`UPLOAD_TEMP_DIR` og ryddes etterpå.

## Miljøvariabler

```dotenv
# local (standard) eller s3
STORAGE_DRIVER=local

# Lokal arbeidsmappe for multipart/OCR/PDF. Ved S3 må denne være skrivbar,
# og bør ligge på tmpfs i containeren.
# UPLOAD_TEMP_DIR=/tmp

# S3/MinIO
# S3_BUCKET=fsm-uploads
# S3_REGION=eu-north-1
# S3_PREFIX=fsm
# S3_ENDPOINT=https://minio.example.no   # bare for MinIO/S3-kompatibel
# S3_FORCE_PATH_STYLE=true              # standard når S3_ENDPOINT er satt
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
# S3_SESSION_TOKEN=
# S3_SERVER_SIDE_ENCRYPTION=AES256      # eller aws:kms
# S3_KMS_KEY_ID=
```

- Uten `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` bruker AWS SDK sin vanlige
  kjede (miljø, delt fil, IAM-rolle, workload identity). Det er anbefalt i
  sky. `S3_REQUIRE_EXPLICIT_CREDENTIALS=true` nekter oppstart uten nøkler.
- Er bare én av nøklene satt, nekter appen å starte. Det er nesten alltid en
  skrivefeil.
- `S3_ENDPOINT` må være `http(s)://`. MinIO og de fleste kompatible tjenester
  krever path-style; det slås på automatisk med endpoint.
- Legg aldri nøkler i repoet. `.env` er ignorert og skal være `0600`.

## Nøkkel- og URL-kartlegging

```
Database: Upload.storedName = "0f4c....pdf"
URL:      /uploads/0f4c....pdf
Lokal:    $UPLOAD_DIR/0f4c....pdf
S3:       s3://$S3_BUCKET/$S3_PREFIX/0f4c....pdf
```

Staging:

```
URL:      ingen (nekta av /uploads)
Lokal:    $UPLOAD_DIR/.transfer/<jobbId>/package.zip
S3:       s3://$S3_BUCKET/$S3_PREFIX/.transfer/<jobbId>/package.zip
```

`normaliseStorageKey()` avviser absolutte stier, `..`, backslash, NUL og tomme
segmenter. Alle drivere bruker den samme porten, så en kompromittert database
rad eller klientverdi kan ikke bli en vilkårlig filakses.

## Migrering fra lokal disk

Migreringen er gjenopptakbar og verifiserer hver fil. Kjør den mens appen
fortsatt skriver til lokal disk, og bytt deretter driver.

```bash
# 1. Tørrkjøring: vis hva som ville blitt kopiert
STORAGE_DRIVER=s3 S3_BUCKET=... S3_PREFIX=... \
  npm run storage:migrate -- --dry-run

# 2. Kopier. Eksisterende filer med samme størrelse hoppes over.
STORAGE_DRIVER=s3 S3_BUCKET=... S3_PREFIX=... \
  npm run storage:migrate

# 3. Verifiser sjekksum for alle filene (kan kjøres flere ganger)
STORAGE_DRIVER=s3 S3_BUCKET=... S3_PREFIX=... \
  npm run storage:migrate -- --verify

# 4. Kontroller at ingenting mangler uten å skrive
STORAGE_DRIVER=s3 S3_BUCKET=... S3_PREFIX=... \
  npm run storage:migrate -- --check

# 5. Stopp appen, kjør migreringen en siste gang, og start med S3
docker compose -f docker-compose.prod.yml stop app
STORAGE_DRIVER=s3 ... npm run storage:migrate -- --verify
# sett STORAGE_DRIVER=s3 i .env og start appen
docker compose -f docker-compose.prod.yml up -d
```

Merk:

- `BACKFILL_UPLOADS` (metadata for gamle lokale filer) kjøres bare når
  `STORAGE_DRIVER=local`. Kjør den før migreringen, ikke etter.
- Migreringen hopper over `.transfer/` med mindre `--include-internal` er satt.
  Staging er kortlevd og trenger normalt ikke flyttes.
- `--force` skriver over målfilen. `--verify` leser begge sider og sammenligner
  SHA-256. `--limit=N` er nyttig for gradvis migrering.
- Kildefilene slettes ikke. Behold dem til minst én vellykket backup/restore og
  en driftsperiode med S3 har gått. Deretter kan `UPLOAD_DIR` arkiveres.
- **Rekkefølge:** kopier filene **før** du bytter `STORAGE_DRIVER`. En app som
  peker på S3 uten at filene er kopiert gir 404 på gamle vedlegg, men ingen
  datatap.
- **Rollback:** bytt `STORAGE_DRIVER=local` igjen. Filer som ble skrevet mens
  S3 var aktiv ligger bare i S3; kopier dem tilbake med et speilet
  migreringsløp (eller behold begge drivere aktive til migreringen er ferdig).

## Drift av S3/MinIO

- Slå på **versjonering** og gjerne object lock/immutability for
  etterlevelseskrav. En sletting i appen skal kunne gjenopprettes.
- Krypter ved lagring (`S3_SERVER_SIDE_ENCRYPTION`). Ved KMS, angi
  `S3_KMS_KEY_ID`.
- Blokker offentlig tilgang. Appen leser og skriver med server-side
  legitimasjon; `/uploads` håndhever tilgangskontrollen.
- Livssyklus: `.transfer/` kan slettes etter 24 timer. Vanlige opplastinger må
  leve så lenge rapporten/vedlegget er rettslig bevis.
- Overvåk 4xx/5xx, `HeadBucket`-feil og latens. `/api/ready` sjekker
  `HeadBucket` når `READY_SECRET`/`CRON_SECRET` er satt.
- MinIO i `docker-compose.ha.yml` har profilen `minio` og er bare for test.
  I produksjon brukes ekstern S3/MinIO.

## Feilsøking

| Symptom | Sjekk |
| --- | --- |
| `STORAGE_DRIVER=s3 krever S3_BUCKET` | `S3_BUCKET` mangler i appens miljø |
| `S3_ACCESS_KEY_ID og S3_SECRET_ACCESS_KEY må settes sammen` | Bare én nøkkel er satt |
| 404 på gamle filer etter bytte | Filene er ikke migrert; kjør `--check` |
| 403 fra S3 | Bucket-policy, nøkkelrettigheter eller KMS |
| `HeadBucket` feiler i readiness | Endpoint/DNS/TLS, legitimasjon eller bucket |
| Treg PDF/OCR med S3 | `UPLOAD_TEMP_DIR` er ikke skrivbar, eller for liten tmpfs |

## Tester

- `src/lib/storage/*.test.ts` dekker nøkkelmapping, traversal, lokal driver i
  temp-mappe, S3-driver med falsk klient, manglende/ halvferdige nøkler og
  prefiks/paginering.
- Integrasjonstestene bruker lokal driver mot en midlertidig `UPLOAD_DIR`, slik
  at forretningslogikken testes uten skyavhengighet. Ekte S3/MinIO krever
  legitimasjon og kjøres som egen røyktest.
