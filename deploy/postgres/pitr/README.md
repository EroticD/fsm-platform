# PostgreSQL PITR og restore-øvelse

Denne katalogen inneholder WAL-arkivering, verifisert base-backup og
point-in-time restore for Compose-produksjonen i `docker-compose.ha.yml`.
Azure Flexible Server har tilsvarende PITR innebygd; se `docs/AZURE.md`.

## Mål

| Scenario | RPO | RTO | Forutsetning |
| --- | --- | --- | --- |
| Compose + WAL-arkiv + nattlig base-backup | **≤ 60 sekunder** for committede transaksjoner | **≤ 60 minutter** til ny database svarer | WAL-arkivet er intakt og kopiert offsite; base-backup finnes |
| Samme, men WAL-arkivet ligger bare på samme disk som databasen | Ikke godkjent som DR | – | Må kopieres til eget lagringsmedium |
| Azure Flexible Server PITR | **≤ 5 minutter** typisk | **≤ 1–2 timer** | PITR aktivert og innenfor retention |
| Kun daglig `pg_dump` | ≤ 24 timer | ≤ 2 timer | `scripts/restore-test.sh` er kjørt |

Tallene er mål, ikke garanti. Den reelle RTO-en er tiden dere har målt i en
øvelse. WAL-arkivet dekker **bare databasen**. Opplastinger ligger i S3/MinIO
og må ha egen versjonering/replikering og egen RPO.

## Slik fungerer det

1. Postgres kjører med `archive_mode=on` og `archive_timeout=60`.
2. Hver fullførte WAL-fil sendes til `archive-wal.sh`, som skriver atomisk til
   `fsm_wal_archive` og først returnerer 0 når filen er synlig i arkivet.
3. `postgres-basebackup` tar `pg_basebackup -X stream` og verifiserer med
   `pg_verifybackup`. Først da skrives `_SUCCESS`.
4. `restore-pitr.sh` kopierer en base-backup til et **nytt** datakatalog,
   setter `restore_command` og `recovery_target_time`, starter recovery,
   venter til `pg_is_in_recovery()` er `false`, og verifiserer
   `_prisma_migrations`. Alle feil gir nonzero exit.

## Daglig drift

```bash
# 1. Base-backup (legg i systemd/cron, f.eks. 02:15 UTC)
docker compose -f docker-compose.ha.yml --profile backup \
  run --rm postgres-basebackup

# 2. Kopier WAL-arkivet og base-backupene offsite. Eksempel med rclone:
docker run --rm \
  -v fsm_wal_archive:/wal:ro \
  -v fsm_base_backups:/backup:ro \
  rclone/rclone:1.69 copy /wal remote:fsm-pitr/wal
docker run --rm \
  -v fsm_base_backups:/backup:ro \
  rclone/rclone:1.69 copy /backup remote:fsm-pitr/base

# 3. Kontroller at siste base-backup er fersk og merket _SUCCESS
docker run --rm -v fsm_base_backups:/backup:ro postgres:15.13 \
  sh -c 'ls -1 /backup/base-*/_SUCCESS | tail -1'

# 4. Overvåk at WAL-arkivet vokser. Siste arkiverte fil skal være nyere enn
#    archive_timeout + margin. Ellers fylles pg_wal og databasen stopper.
```

`archive_command` feiler høylytt i Postgres-loggen hvis skrivingen feiler.
Varsle på `pg_stat_archiver.failed_count` og på at `last_archived_time` står
stille. Uten varsling er WAL-arkivering en tidsinnstilt RPO-felle.

## Restore-øvelse (obligatorisk kvartalsvis)

Kjør mot et **nytt** katalog og en annen port. Produksjonsvolumet skal ikke
være montert skrivbart.

```bash
# Forutsetter at en base-backup og WAL-arkivet finnes.
docker run --rm -it \
  -v fsm_base_backups:/backup:ro \
  -v fsm_wal_archive:/var/lib/postgresql/wal-archive:ro \
  -v fsm_pitr_restore:/var/lib/postgresql/restore \
  -e PGDATABASE=fsm_db \
  -e WAL_ARCHIVE_DIR=/var/lib/postgresql/wal-archive \
  postgres:15.13 \
  /scripts/restore-pitr.sh \
    --base /backup/base-<stamp> \
    --target-time 2026-11-09T09:59:00Z \
    --data-dir /var/lib/postgresql/restore/pgdata \
    --port 55432
```

Legg til `-v "$PWD/deploy/postgres/pitr:/scripts:ro"` i kommandoen over.

Etter at scriptet har promotert:

1. Sjekk at `_prisma_migrations` har samme antall som produksjon.
2. Sammenlign `count(*)` for `WorkOrder`, `Report`, `Upload`, `AuditLog` mot
   forventet tidspunkt. Tallene skal ligge mellom forrige og neste kjente
   backup, ikke være null.
3. Åpne en kjent rapport/oppdrag og kontroller at fil-URL-er peker på objekter
   som finnes i S3.
4. Mål tiden fra `docker run` til vellykket verifisering. Skriv den i
   driftsjournalen; dette er den reelle RTO-en.
5. Slett testkatalogen/volumet etter øvelsen.

## Sjekkliste ved reell hendelse

- [ ] Erklær hendelse, varsle dataeier, noter tidspunkt for siste kjente gode
      transaksjon.
- [ ] Stopp appen (`docker compose -f docker-compose.ha.yml stop app`) slik at
      nye skrivinger ikke gjør målet uklart.
- [ ] Ikke slett produksjonsvolumet. Restore går til nytt katalog.
- [ ] Velg base-backup **før** ønsket tidspunkt, med `_SUCCESS`.
- [ ] Velg `--target-time` i UTC, like etter siste kjente gode transaksjon.
- [ ] Verifiser at WAL-filene for intervallet finnes i arkivet.
- [ ] Kjør `restore-pitr.sh`, kontroller migrasjoner og forretningsdata.
- [ ] Pek appen mot den nye databasen, start **én** replika først, kontroller
      `/api/ready`, og skaler deretter ut.
- [ ] Verifiser opplastinger mot S3 (versjonering/point-in-time hvis
      tilgjengelig).
- [ ] Skriv hendelseslogg: base-backup, target-time, operatør, kommandoer,
      målt RTO, avvik.
- [ ] Roter eventuelle hemmeligheter som kan ha vært eksponert.

## Begrensninger

- WAL-arkivet på samme VM/disk er **ikke** DR. Kopier det offsite, og test at
  kopien kan leses.
- Skriptene er shell og krever `bash`, `pg_basebackup`, `pg_verifybackup`,
  `psql` og `pg_ctl` fra Postgres 15.
- `restore-pitr.sh` promoterer databasen. Det er riktig for et nytt
  restore-miljø, men skal aldri kjøres mot produksjonsdatakatalogen.
- Azure Flexible Server bruker Azures innebygde PITR. Skriptene her er for
  Compose-topologien og blandet ikke de to.
