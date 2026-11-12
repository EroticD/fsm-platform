# Backup og gjenoppretting (runbook)

> **Gjelder:** FSM-plattformen **0.9.5**.
> **Målgruppe:** driftsoperatører som skal kunne sikkerhetskopiere, verifisere
> og gjenopprette under tidspress.
> **Status:** skriptene og miljøvariablene er kontrollert mot kilden i denne
> versjonen. Azure-native steg er eksempler med `az`/portal og må verifiseres i
> abonnementet før de brukes i en reell hendelse. Se
> [docs/AZURE.md](AZURE.md) for selve Azure-utrulleringen (egen driftsguide).

Denne runbooken erstatter ikke [OPERATIONS.md](OPERATIONS.md), men går dypere i
backup og gjenoppretting. Ved konflikt mellom denne teksten og skriptene i
repoet, gjelder skriptene. Meld fra om avvik.

Forutsetter Linux med systemd, Docker Compose v2, `bash` og `age`. `rclone` og
`az`/`azcopy` kreves bare når dere bruker ekstern lagring eller Azure-native
steg.

---

## Innhold

1. [Hvis tjenesten er nede nå](#1-hvis-tjenesten-er-nede-nå)
2. [Omfang og verdier](#2-omfang-og-verdier)
3. [RPO og RTO](#3-rpo-og-rto)
4. [Hvordan backupen er bygget](#4-hvordan-backupen-er-bygget)
5. [Planlegging, overvåking og varsling](#5-planlegging-overvåking-og-varsling)
6. [Gjenoppretting – runbook](#6-gjenoppretting--runbook)
7. [Restore-test og øvelser](#7-restore-test-og-øvelser)
8. [Sikkerhet, personvern og etterlevelse](#8-sikkerhet-personvern-og-etterlevelse)
9. [Feilsøking](#9-feilsøking)
10. [Sjekklister](#10-sjekklister)
11. [English summary](#11-english-summary)

---

## 1. Hvis tjenesten er nede nå

Dette er minste trygge rekkefølge. Ikke hopp over verifiseringen.

1. **Erklær hendelse og varsle.** Opprett hendelsesnummer, skriv hvem som er
   incident lead, og varsle dataeier. Ved mistanke om datatap eller
   sikkerhetsbrudd: følg sikkerhetsvarslingsløpet i [SECURITY.md](../SECURITY.md).
2. **Stopp skriving.** `docker compose -f docker-compose.prod.yml stop app`.
   Ikke stopp PostgreSQL før du vet hva du skal gjøre.
3. **Sikre nåværende tilstand før du overskriver noe.** Ta en ny backup hvis
   disk og database er friske:
   `NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml RETENTION_DAYS=30 ./scripts/backup.sh`.
   Hvis det ikke er mulig, kopier databasen eller volumet først – den kan
   inneholde data du ellers mister.
4. **Velg gjenopprettingspunkt.** Bruk nyeste backup som har gyldig sjekksum og
   er testet. Ved tvil: nyeste *komplette* sett med samme tidsstempel for
   database og opplastinger.
5. **Verifiser før restore.** Sjekksum, dekryptering og `restore-test.sh` (eller
   tilsvarende manuell kontroll). Se [§6.2](#62-forberedelser-og-sikkerhetsport).
6. **Gjenopprett til et nytt mål først.** Ny database og/eller nytt volum. Ikke
   skriv over produksjon før det nye målet er kontrollert.
7. **Bytt trafikk, verifiser, og hold den gamle tilstanden tilbake.**
8. **Skriv hendelseslogg:** tidspunkt, backup-ID, operatør, kommandoer, resultat
   og eventuelle avvik. Oppdater denne runbooken etterpå.

> **Aldri** kjør `docker system prune --volumes` på en produksjonsmaskin. Det
> sletter `fsm_postgres_data` og `fsm_uploads`.

---

## 2. Omfang og verdier

### 2.1 Hva som må kunne gjenopprettes

| Verdi | Hvor den ligger | Tas den med av `scripts/backup.sh`? | Gjenopprettes fra |
| --- | --- | --- | --- |
| PostgreSQL-data | Docker-volumet `fsm_postgres_data` (prosjektprefiks, f.eks. `fsm-platform_fsm_postgres_data`) eller ekstern PostgreSQL/Azure Database for PostgreSQL | **Ja for Compose-databasen**; ekstern DB krever Azure-native backup eller manuell `pg_dump` (se [§6.7](#67-database-only-restore-fra-ekstern-server)) | `db-<stamp>.sql.gz[.age]`, Azure PITR eller Azure Backup |
| Opplastede filer (lokal driver) | Docker-volumet `fsm_uploads`, montert på `/app/uploads` (`UPLOAD_DIR=/app/uploads`) | **Ja**, som `tar.gz` (valgfritt age-kryptert) | `uploads-<stamp>.tar.gz[.age]` |
| Opplastede filer (S3/MinIO) | Bucket `S3_BUCKET` med `S3_PREFIX` | **Nei** av `scripts/backup.sh` | S3-versjonering/replikering + egen bucket-backup; se [`STORAGE.md`](STORAGE.md) |
| `.env` og hemmeligheter | `/opt/fsm-platform/.env` på verten | **Nei** | Hemmelighetshvelv, segl/offline kopi eller Azure Key Vault |
| age-identitet (privat nøkkel) | Primært offline/Key Vault; for automatisert restore-test en beskyttet kopi på verten, f.eks. `/etc/fsm/age/keys.txt` (0600, kun `fsmbackup`) | **Nei** | Minst to offline kopier; se [§4.5](#45-nøkler-og-nøkkelgjenoppretting) |
| Applikasjonsimage og versjon | `APP_IMAGE` i `.env`, image i GHCR | **Nei** (registry) | Samme tag/digest fra GHCR; se [§6.8](#68-versjons--og-migrasjonsavvik) |
| Caddy/proxy-konfigurasjon | `deploy/proxy/Caddyfile`, vertens `/etc/caddy/` | **Nei** | Git/IaC eller egen konfigkopi; se [deploy/proxy/README.md](../deploy/proxy/README.md) |
| DNS og TLS | DNS-sone og Caddy/ACME | **Nei** | IaC og DNS-leverandør; planlegg TTL før cutover |
| Revisjons- og bevis-eksport | Genereres fra appen som ZIP | **Nei** (men kan arkiveres separat) | Egen eksport til uforanderlig lagring; se [audit-retention.md](audit-retention.md) |
| Docker-volumoversikt | `docker volume ls` | **Nei** | Dokumentér navnene i driftsjournalen |

`backup.sh` tar **ikke** `.env`, age-identiteten, image eller proxy-konfig. De
må sikres separat. En databasebackup uten age-identiteten er verdiløs når
backupen er kryptert. Sørg også for at image-taggen/digesten dere trenger
faktisk finnes i GHCR (eller er eksportert lokalt); en slettet tag kan ikke
gjenopprettes fra databasen.

### 2.2 Hva som ikke sikkerhetskopieres

- `.next`-cachen: ligger i `tmpfs` i containeren og kan forkastes.
- `/tmp`: `tmpfs` for PDF/OCR og Node; mellomlagrede filer er ikke en verdi.
- Containerlogger: `json-file` med `max-size: 10m` og `max-file: 3`. De roterer
  og er ikke revisjonslogg.
- Docker-images: hentes på nytt fra GHCR. Behold likevel forrige kjente gode
  image for rask rollback.
- Prometheus/Alertmanager-data og node_exporter: overvåkingsdata, ikke
  forretningsdata.
- OS, Docker-daemon, brannmur, lastbalanserer og nettverkskonfigurasjon:
  håndteres som infrastruktur/IaC, ikke av appens backupskript.

### 2.3 Konsistens mellom database og opplastinger

`pg_dump` gir et transaksjonskonsistent bilde av **databasen**. Deretter pakkes
opplastingsvolumet. De to er **ikke** et atomisk tverrsnitt:

- Fil lastet opp mellom dump og tar kan ligge i arkivet uten å være referert i
  databasen. Det er normalt ufarlig, men gir avvik i antall.
- Fil slettet mellom dump og tar kan være referert i databasen, men mangle i
  arkivet. Det gir en «ødelagt» vedleggslenke.

Ved strenge krav: stopp appen (`docker compose ... stop app`) før `backup.sh`,
eller godta vinduet og dokumenter det. Gjenopprett alltid database og
opplastinger fra **samme tidsstempel**; ellers kan `Upload`-rader peke på filer
som ikke finnes.

### 2.4 `.env`, proxy-konfig og versjonsmetadata

`backup.sh` tar ikke disse filene. Lag en egen, kryptert pakke og oppbevar den
atskilt fra databasebackupene:

```bash
set -euo pipefail
cd /opt/fsm-platform
umask 077
: "${BACKUP_AGE_RECIPIENT:?Sett BACKUP_AGE_RECIPIENT}"
STAMP="$(date +%Y%m%d-%H%M%S)"

tar czf - .env deploy/proxy/Caddyfile \
  | age --recipient "$BACKUP_AGE_RECIPIENT" \
      --output "secrets-$STAMP.tar.gz.age"

sha256sum "secrets-$STAMP.tar.gz.age" > "secrets-$STAMP.sha256"

docker compose -f docker-compose.prod.yml config --images \
  > "images-$STAMP.txt"
```

Kontroller at pakken kan dekrypteres og inneholder det den skal, uten å skrive
ukryptert til disk:

```bash
age -d -i "$AGE_IDENTITY" "secrets-$STAMP.tar.gz.age" \
  | tar tzf - | grep -E '(^|/)\.env$|Caddyfile$'
```

Pakk **aldri** age-identiteten inn i samme arkiv. `.env` inneholder
hemmeligheter og skal behandles som en egen verdi med egen tilgangskontroll.
`images-$STAMP.txt` er ikke hemmelig, men gjør det mulig å se hvilken
`APP_IMAGE`/`POSTGRES_IMAGE` som hørte til backupen.

---

## 3. RPO og RTO

- **RPO (Recovery Point Objective):** hvor mye data som kan tapes, målt i tid.
- **RTO (Recovery Time Objective):** hvor lang tid gjenoppretting kan ta fra
  hendelse til tjenesten er tilbake.

### 3.1 Anbefalte mål

| Scenario | Anbefalt RPO | Anbefalt RTO | Forutsetning |
| --- | --- | --- | --- |
| Lokal Compose-installasjon, daglig backup | **≤ 24 timer** | **≤ 2 timer** for full restore | Siste backup er fersk og verifisert; age-nøkkel tilgjengelig; opplastingsvolumet er overkommelig |
| Samme, men timesbackup | **≤ 1 time** | **≤ 2 timer** | `fsm-backup.timer` endres bevisst; mer disk og I/O; testet |
| Compose med WAL-arkiv + nattlig base-backup (`docker-compose.ha.yml`) | **≤ 60 sekunder** | **≤ 60 minutter** | WAL-arkivet er intakt og kopiert offsite; base-backup med `_SUCCESS`; se [§6.5.1](#651-point-in-time-restore-med-compose-og-wal-arkiv) |
| Ekstern PostgreSQL med PITR (f.eks. Azure Flexible Server) | **≤ 1 time**, typisk få minutter | **≤ 1–2 timer** | PITR aktivert, innenfor retention, ny server kan opprettes; opplastinger har egen backup |
| Azure Backup/LTR i tillegg | Policyavhengig (typisk daglig/ukentlig) | Lengre enn PITR | Policy, vault og restore-prosedyre er testet |
| Kun database, liten installasjon | Siste verifiserte dump | **≤ 1 time** | `restore-test.sh` er kjørt; målrettet databasebytte |

Tallene er **mål**, ikke garanti. Den reelle RTO-en er tiden dere har målt i en
øvelse, ikke tiden skriptet bruker isolert.

PITR gjelder **bare databasen**. Opplastingsvolumet har fortsatt RPO lik
backupfrekvensen (normalt inntil 24 timer) med mindre det kopieres oftere. En
database rullet tilbake til 02:15 kombinert med opplastinger fra 03:17 gir
derfor et tidsmessig avvik dere må håndtere bevisst.

### 3.2 Hva som endrer RPO og RTO

**RPO blir dårligere av:**

- mislykket eller hoppet over backup (sjekk `fsm-backup-check`);
- at bare lokal backup finnes og verten mister disken;
- at `BACKUP_REMOTE` ikke er satt eller kopien feiler;
- at age-nøkkelen mangler – da kan ingen restore gjøres;
- at opplastinger og database er tatt på ulike tidspunkter.

**RTO blir lengre av:**

- stor database (indekser og constraints tar tid) og mange/små filer;
- stort opplastingsvolum og lav båndbredde;
- dekryptering på treg CPU;
- manglende lokal backup (må hentes fra ekstern lagring);
- venting på DNS/TTL, TLS-sertifikat eller Azure-provisjonering;
- manglende rettigheter (RBAC, Key Vault, PostgreSQL-brannmur);
- at noen må finne `.env`, imageversjon eller nøkkel under press;
- verifisering og røyktest som avdekker feil først etter cutover.

### 3.3 Slik verifiserer og oppdaterer dere målene

1. Mål fra siste fulløvelse: tid fra «go» til `/api/ready` er grønn og
   røyktesten er bestått.
2. Før logg:

   | Dato | Backup-stamp | Operatør | DB-tid | Uploads-tid | Cutover | Total RTO | Avvik |
   | --- | --- | --- | --- | --- | --- | --- | --- |
   |  |  |  |  |  |  |  |  |

3. Sammenlign med målene over. Er avviket stort, oppdater målene eller
   forbedre prosessen – ikke skjul det.
4. Kontroller at `fsm_backup_age_seconds` og `fsm_backup_fresh` faktisk
   reflekterer siste vellykkede backup. Se [§5.3](#53-målinger-og-alarmer).

---

## 4. Hvordan backupen er bygget

### 4.1 `scripts/backup.sh` – steg for steg

Skriptet kjøres fra repo-roten og bruker Docker Compose. Det leser **ikke**
`.env` selv; miljøvariablene må være eksportert eller ligge i systemd-enheten sin
`EnvironmentFile`.

```bash
cd /opt/fsm-platform
NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh
```

Flyten er:

1. **Fail-closed krypteringssjekk.** Med `NODE_ENV=production` eller
   `REQUIRE_BACKUP_ENCRYPTION=true` avbryter skriptet **før** det oppretter
   backupmappen eller dumper noe, hvis `BACKUP_AGE_RECIPIENT` mangler. Det
   hindrer en stille ukryptert kopi av database og opplastinger.
2. **`umask 077`.** Nye backupfiler blir `0600`; mappen bør være `0700`.
3. **Database:** `docker compose exec -T postgres pg_dump -U "$POSTGRES_USER"
   -d "$POSTGRES_DB"` piped gjennom `gzip` og eventuelt `age --recipient`.
   Formatet er **plain SQL**, ikke custom-format. Ukrypterte filer skrives aldri
   til disk når kryptering er på.
4. **Opplastinger:** `docker run --rm -v "$UPLOADS_VOLUME:/data:ro"
   postgres:15.13 tar czf - -C /data .` piped gjennom samme kryptering.
   `UPLOADS_VOLUME` finnes automatisk med `docker volume ls | grep -E
   '_fsm_uploads$'`, men bør settes eksplisitt når flere stacks deler vert.
5. **Sjekksum:** `sha256sum` for database- og opplastingsfilen skrives til
   `checksums-<stamp>.sha256`. Sjekksumfilen er ikke kryptert og inneholder
   bare filnavn og hasher.
6. **Ekstern kopi (valgfritt):** `rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE"
   --include "*-$STAMP.*"`, deretter `rclone check ... --one-way` med mindre
   `BACKUP_VERIFY_REMOTE=false`. Kopien skjer **etter** kryptering og
   sjekksum.
7. **Statusfil:** skrives atomisk (`tmp` + `mv`) først når dump, arkiv,
   sjekksum og eventuell ekstern kopi er ferdige. Den brukes av
   `backup-freshness.sh` og `/api/metrics`.
8. **Retention:** `find "$BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS"
   -delete`. Bare **lokale** filer ryddes. Ekstern lagring må ha egen
   livssyklus/retention.

Statusfilen inneholder ikke `APP_IMAGE`. Noter image-tag/digest (for eksempel
fra `docker compose ... config --images`) i driftsjournalen eller i
`images-<stamp>.txt` fra [§2.4](#24-env-proxy-konfig-og-versjonsmetadata), slik
at dere vet hvilken appversjon backupen hører til.

Feiler rclone-kopien eller verifiseringen, skrives **ingen ny statusfil**.
Forrige status blir stående, og freshness-kontrollen vil etter hvert si at
backupen er for gammel. Det er tilsiktet: en uverifisert ekstern kopi skal ikke
se ut som en vellykket backup.

Ved feil i en pipeline fjerner `trap cleanup_partial ERR` den halvskrevne filen.
En databasefil kan likevel bli liggende hvis dumpen lykkes og opplastingssteget
feiler; den får da ingen sjekksum/status og skal ikke brukes. Rydd slike
foreldreløse filer bevisst.

**Ikke kjør to backups samtidig.** Skriptet har ingen egen lås. Systemd-timeren
kjører én instans, men en manuell kjøring bør ikke overlappe. Bruk gjerne:

```bash
flock -n /run/lock/fsm-backup.lock \
  env NODE_ENV=production COMPOSE_FILE=docker-compose.prod.yml \
  ./scripts/backup.sh
```

`flock` er et ekstra vern rundt skriptet, ikke en del av det.

Forventet utdata (avhengig av om kryptering og rclone er konfigurert):

```text
→ Dumper database fsm_db ...
→ Finner opplastingsvolumet ...
→ Pakker fsm-platform_fsm_uploads ...
→ Krypterte backupene med age.
→ Skriver sjekksummer ...
→ Kopierte backupene til remote:fsm-backups.
→ Verifiserte den eksterne kopien.
→ Oppdaterer backupstatus ...
✓ Ferdig:
  /var/backups/fsm/db-20261107-031703.sql.gz.age
  /var/backups/fsm/uploads-20261107-031703.tar.gz.age
  /var/backups/fsm/checksums-20261107-031703.sha256
  /var/backups/fsm/backup-status.json
```

### 4.2 Miljøvariabler

| Variabel | Standard | Bruk |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Katalog for lokale backupfiler. Bruk et dedikert, tilgangsstyrt sted i produksjon, f.eks. `/var/backups/fsm`. |
| `BACKUP_STATUS_FILE` | `<BACKUP_DIR>/backup-status.json` | Statusfil for freshness og `/api/metrics`. I produksjon peker den ofte på `/opt/fsm-platform/monitoring/backup-status.json`, som monteres read-only i appen. |
| `BACKUP_AGE_RECIPIENT` | tom | Offentlig age-mottaker (`age1...`). **Påkrevd** når `NODE_ENV=production` eller `REQUIRE_BACKUP_ENCRYPTION=true`. |
| `AGE_IDENTITY` | `~/.config/age/keys.txt` | Privat age-identitet. Brukes av `restore-test.sh` ved dekryptering, **ikke** av `backup.sh`. Må settes eksplisitt for automatisk restore-test. |
| `REQUIRE_BACKUP_ENCRYPTION` | `false` | Sett `true` for å kreve kryptering også utenfor produksjon. |
| `BACKUP_REMOTE` | tom | rclone-mål, f.eks. `remote:fsm-backups` eller en Azure Blob-container konfigurert i rclone. |
| `BACKUP_VERIFY_REMOTE` | `true` | Verifiser med `rclone check` i `backup.sh`. Sett bare `false` bevisst når backenden ikke støtter hashing. Merk: `backup-freshness.sh` leser ikke denne variabelen – den kjører `rclone check` så lenge `BACKUP_REMOTE` er satt. |
| `BACKUP_MAX_AGE_HOURS` | `26` | Maks alder før `backup-freshness.sh` og appens `fsm_backup_fresh` sier at backupen er for gammel. |
| `REQUIRE_REMOTE_BACKUP` | `false` | Når `true`, feiler freshness-kontrollen hvis `BACKUP_REMOTE` mangler eller kopien ikke er verifisert. |
| `RETENTION_DAYS` | `30` i `backup.sh`, `365` i appen | **Overlastet variabel:** `backup.sh` bruker den til lokal backupretention (standard 30), mens appens job-worker bruker den til hard sletting av mykt slettede oppdrag (standard 365). Se advarselen under. |
| `POSTGRES_USER` | `admin` | Databasebruker for `pg_dump`/restore. Må ha lesetilgang til alle tabeller. |
| `POSTGRES_DB` | `fsm_db` | Databasenavn. |
| `UPLOADS_VOLUME` | autofinnes | Eksakt Docker-volumnavn. Sett det når autofinning kan velge feil volum. |
| `POSTGRES_IMAGE` | `postgres:15.13` | Image som brukes til tar-containeren (ikke databasebildet i Compose). Må finnes lokalt eller kunne hentes. |
| `APP_IMAGE` | påkrevd i produksjon | Appens image-tag eller digest. Brukes ikke av `backup.sh`, men må noteres sammen med backupen for å kunne gjenopprette riktig versjon. |
| `COMPOSE_FILE` | `docker-compose.yml` | Sett til `docker-compose.prod.yml` i produksjon. `backup.sh` kaller `docker compose` uten `-f`. |
| `NODE_ENV` | ikke satt | `production` gjør kryptering påkrevd. |
| `REQUIRE_BACKUP_BEFORE_MIGRATE` | `false` | Appens oppstartssperre. Når `true`, nekter appen å migrere uten `BACKUP_CONFIRMED=true`. |
| `BACKUP_CONFIRMED` | `false` | Bekreftelse for denne oppstarten. Koden nullstiller den **ikke**; fjern den eller sett den tilbake til `false` etterpå, ellers er migrasjonssperren permanent åpen. Beviser **ikke** at backupen er god. |

Sikre produksjonsverdier i `/etc/fsm/fsm-backup.env` (chmod `600`, eid av
driftsbrukeren):

```dotenv
NODE_ENV=production
COMPOSE_FILE=docker-compose.prod.yml
BACKUP_DIR=/var/backups/fsm
BACKUP_STATUS_FILE=/opt/fsm-platform/monitoring/backup-status.json
# Eksempel – bytt til deres faktiske mottaker og rclone-mål:
BACKUP_AGE_RECIPIENT=age1exampleexampleexampleexampleexample
BACKUP_REMOTE=remote:fsm-backups
BACKUP_VERIFY_REMOTE=true
REQUIRE_BACKUP_ENCRYPTION=true
RETENTION_DAYS=30
# Age-identiteten skal ikke ligge på samme maskin som backupen:
# AGE_IDENTITY=/etc/fsm/age/keys.txt
```

`BACKUP_AGE_RECIPIENT` er en **offentlig** nøkkel og kan ligge i miljøfilen.
`AGE_IDENTITY` er den **private** nøkkelen og må beskyttes som en hemmelighet.

For at den ukentlige restore-testen skal kunne dekryptere, må `AGE_IDENTITY`
være satt og lesbar for `fsmbackup` (0600). Det er en bevisst avveining: den
automatiske testen trenger nøkkelen på verten, men den skal **ikke** ligge i
`BACKUP_DIR` eller i samme katalog som backupene. Oppbevar i tillegg minst én
offline kopi.

`POSTGRES_USER` og `POSTGRES_DB` må også inn i `/etc/fsm/fsm-backup.env` når de
avviker fra `admin`/`fsm_db`. Skriptene leser ikke `.env` selv.

> **`RETENTION_DAYS` er overlastet.** `backup.sh` bruker den til **lokal
> backupretention** (standard 30 dager), mens appens job-worker bruker samme
> variabel til **hard sletting av mykt slettede oppdrag** (standard 365 dager,
> se `src/lib/job-worker.ts`). Hold verdiene adskilt: backupjobben får sin verdi
> fra `/etc/fsm/fsm-backup.env`, appen fra `.env`. Sourcer du appens `.env` inn i
> en manuell backupkjøring, kan `RETENTION_DAYS=365` gjøre at backupfiler blir
> liggende mye lenger enn planlagt – overstyr den eksplisitt ved behov.

**To roller for `BACKUP_STATUS_FILE`:** I `/etc/fsm/fsm-backup.env` er det
**vertsstien** som backupjobben skriver (f.eks.
`/opt/fsm-platform/monitoring/backup-status.json`). I appens `.env` er det
**containerstien** appen leser (`/app/monitoring/backup-status.json`). Begge
peker på samme fil gjennom bind-mountet `./monitoring:/app/monitoring:ro`.
Ikke sett vertsstien i appens `.env` – da ser appen en fil som ikke finnes i
containeren.

### 4.3 Systemd-enheter og varsling

Enhetene ligger i [`deploy/systemd/`](../deploy/systemd/README.md):

| Enhet | Når | Hva |
| --- | --- | --- |
| `fsm-backup.timer` | daglig kl. 03:17, `Persistent=true`, `RandomizedDelaySec=15m` | Kjører `scripts/backup.sh` som `fsmbackup` med `EnvironmentFile=/etc/fsm/fsm-backup.env`. Timeout 2 timer. |
| `fsm-backup-check.timer` | daglig kl. 06:10, `RandomizedDelaySec=10m` | Kjører `backup-freshness.sh --prometheus-output /var/lib/node_exporter/textfile/fsm-backup.prom`. |
| `fsm-restore-test.timer` | søndag kl. 04:30, `RandomizedDelaySec=30m` | Kjører `restore-test.sh` med `ExecStartPre` freshness-grense 168 timer. |
| `fsm-alert@.service` | ved `OnFailure` | Kjører `ops-alert.sh critical "systemd: %i" ...` mot `ALERT_WEBHOOK_URL`. |

Alle tre har `OnFailure=fsm-alert@%n.service`. Det betyr at en feilet
backup/check/restore-test varsler, men bare hvis varslingskanalen faktisk
virker. Test den bevisst.

Installasjon og driftsbruker er beskrevet i
[deploy/systemd/README.md](../deploy/systemd/README.md). Kort:

```bash
sudo cp deploy/systemd/fsm-*.service deploy/systemd/fsm-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fsm-backup.timer fsm-backup-check.timer fsm-restore-test.timer
systemctl list-timers 'fsm-*'
```

`fsmbackup` må være i `docker`-gruppen for å kunne kalle `docker compose`.
Docker-gruppen er i praksis root-ekvivalent; begrens innlogging og bruk en
dedikert driftsbruker.

### 4.4 Azure-spesifikke muligheter

Azure kan brukes på flere nivåer. **Skill mellom hva repo-skriptene gjør og hva
Azure selv gjør.** Repo-skriptet tar logisk `pg_dump` + opplastings-tar og kan
kopiere filene til Blob via rclone. Azure-native backup tar ikke
opplastingsvolumet med mindre du også sikrer det separat.

| Behov | Løsning | Hva dekkes | Viktig |
| --- | --- | --- | --- |
| Kort PITR for database | **Azure Database for PostgreSQL Flexible Server** automatiske backup + PITR | Bare databaseserveren | PITR oppretter en **ny** server; 7–35 dagers retention; geo-redundant backup må velges ved opprettelse |
| Langtidsretensjon/etterlevelse | **Azure Backup** for PostgreSQL Flexible Server (vaulted/LTR) | Databaseserveren, policybasert | Inntil 10 år avhengig av policy; sjekk støtte for daglig/ukentlig i din region/versjon; følg Microsofts dokumentasjon |
| Hele VM-en | **Azure Backup for VM** / managed disk-snapshot | OS, Docker, volumer på disken | Crash-konsistent med mindre appen quiesces; ikke en erstatning for `pg_dump` |
| Opplastinger og dumpfiler | **Blob Storage** med rclone/azcopy | Filene `backup.sh` lager | Slå på versioning, soft delete og immutability/legal hold; privat container |
| Identitet og nøkler | **Managed identity + Key Vault** | Tilgang til Blob og age-identitet | Ikke gjør Key Vault til eneste kopi av age-identiteten |

#### PostgreSQL Flexible Server – PITR

Forutsetninger: serveren er en Flexible Server, backupretention er satt (7–35
dager), og du vet hvilken region/versjon den har. PITR gir en **ny** server i
samme region og samme majorversjon. Restore til et tidligere punkt innenfor
retention.

```bash
# Eksempel – kontroller resource group, servernavn og tidspunkt.
RG="rg-fsm-prod"
PG="fsm-pg-prod"
SUBSCRIPTION="00000000-0000-0000-0000-000000000000"

az account set --subscription "$SUBSCRIPTION"
az postgres flexible-server show \
  --resource-group "$RG" --name "$PG" \
  --query '{version:version,state:state,retention:backup.backupRetentionDays,geo:backup.geoRedundantBackup}' \
  -o json

az postgres flexible-server backup list \
  --resource-group "$RG" --name "$PG" -o table

RESTORE_TIME="2026-11-07T02:15:00Z"
NEW="fsm-pg-restore-$(date +%Y%m%d-%H%M)"

az postgres flexible-server restore \
  --resource-group "$RG" \
  --name "$NEW" \
  --source-server "$PG" \
  --restore-time "$RESTORE_TIME"
```

Etter restore:

1. Vent til `az postgres flexible-server show ... --query state -o tsv` viser
   `Ready`.
2. Kontroller nettverk: privat DNS, subnet/firewall, og at appen kan nå den nye
   serveren.
3. Oppdater `DATABASE_RUNTIME_URL` og `DATABASE_MIGRATION_URL` i `.env` til den
   nye serveren. Bruk `sslmode=require` og de rollene dere faktisk bruker.
4. Start appen og verifiser `/api/ready`, migrasjoner og tellinger.
5. **Opplastinger er ikke en del av PITR.** Gjenopprett `fsm_uploads` fra
   arkivet til samme tidspunkt hvis databasen rulles tilbake.

Geo-restore til paregion (bare når geo-redundant backup er slått på):

```bash
az postgres flexible-server geo-restore \
  --resource-group "$RG" \
  --name "$NEW" \
  --source-server "$PG" \
  --location "$PAIRED_REGION"
```

Azure Backup (vaulted/LTR) settes opp med policy i portal eller med `az backup`.
CLI-støtten og policyfeltene varierer med versjon/region. Bruk Microsofts
dokumentasjon for PostgreSQL Flexible Server og verifiser i et testabonnement
før dere stoler på det. Repo-skriptet dekker **ikke** denne flyten.

#### Azure Backup for VM og managed disks

En VM-backup tar hele maskinen, inkludert Docker-volumene. Den er nyttig ved
tap av hele verten, men:

- den er normalt **crash-konsistent**, ikke applikasjonskonsistent;
- den fanger ikke opp at `pg_dump` er tatt;
- den gir ikke en enkel enkeltfil-gjenoppretting av en opplasting;
- den erstatter ikke `restore-test.sh`.

Eksempel (verifiser vault/policy i abonnementet):

```bash
az backup vault create \
  --resource-group "$RG" --name "$BACKUP_VAULT" --location "$LOCATION"

az backup protection enable-for-vm \
  --resource-group "$RG" --vault-name "$BACKUP_VAULT" \
  --vm "$VM_NAME" --policy-name Daily
```

For managed disks kan dere bruke disksnapshots, men en snapshot av et aktivt
PostgreSQL-volum er ikke det samme som en logisk dump. Stopp appen eller bruk
`pg_dump` når dere trenger en garantert konsistent database.

#### Blob Storage, immutability og versjonering

Bruk en **egen** container for backup, privat nettverkstilgang og minst mulig
RBAC. `backup.sh` lager allerede age-krypterte filer; Blob-kryptering er et
ekstra lag, ikke en erstatning for age.

```bash
SA="stfsmbackup"
CONTAINER="fsm-backups"

az storage account blob-service-properties update \
  --resource-group "$RG" --account-name "$SA" \
  --enable-versioning true \
  --enable-delete-retention true \
  --delete-retention-days 30

az storage container immutability-policy create \
  --resource-group "$RG" --account-name "$SA" \
  --container-name "$CONTAINER" --period 90

az storage container legal-hold set \
  --resource-group "$RG" --account-name "$SA" \
  --container-name "$CONTAINER" --tags fsmbackup
```

Kontroller syntaks og policy med `az ... --help` i deres CLI-versjon.
Immutability-policyen opprettes **ulåst**; lås den bevisst når den er verifisert.
Immutability/legal hold kan gjøre det **umulig** å slette filer før fristen –
det er poenget, men planlegg retention og kostnad.

#### Managed identity, azcopy og rclone

- Gi VM-ens system- eller brukeridentitet `Storage Blob Data Contributor` på
  containerens scope, ikke på hele abonnementet.
- `azcopy login --identity` (eller `--identity-client-id`) og deretter
  `azcopy copy`.
- rclone kan bruke Azure Blob med managed identity. Konfigurer remote med
  `use_msi = true` (og **ikke** `env_auth` samtidig), eller bruk `env_auth` når
  identiteten kommer fra miljøet/CLI. Test at den faktisk bruker identiteten,
  ikke en gammel SAS.
- Unngå å legge SAS-tokens eller account keys i `.env` eller i kommandolinjen.

Eksempel med azcopy (repo-skriptet bruker rclone, men azcopy er et alternativ):

```bash
azcopy login --identity
azcopy copy "/var/backups/fsm/" \
  "https://${SA}.blob.core.windows.net/${CONTAINER}/fsm/" \
  --recursive
```

#### Key Vault for age-identitet

Age-identiteten er en liten tekstfil. Den kan lagres som en Key Vault-secret,
men **bare som et supplement** til minst én offline kopi utenfor Azure:

```bash
az keyvault secret set \
  --vault-name "$KEY_VAULT" \
  --name "fsm-age-identity" \
  --file /secure/offline/age-keys.txt

az keyvault secret download \
  --vault-name "$KEY_VAULT" \
  --name "fsm-age-identity" \
  --file /etc/fsm/age/keys.txt
```

Begrens `get`/`list` til driftsidentiteten, slå på soft delete og purge
protection, og logg alle uttak. Mistet Key Vault-tilgang må ikke bety mistet
age-nøkkel.

### 4.5 Nøkler og nøkkelgjenoppretting

- `BACKUP_AGE_RECIPIENT` er en **offentlig** nøkkel. Den kan ligge i
  `/etc/fsm/fsm-backup.env`.
- `AGE_IDENTITY` er den **private** nøkkelen. Uten den kan ingen eksisterende
  age-backup åpnes. Ingen i appen kan gjenopprette den.
- Lag nytt nøkkelpar bevisst (overskriv aldri et eksisterende):

  ```bash
  umask 077
  age-keygen -o /secure/offline/age-keys.txt
  age-keygen -y /secure/offline/age-keys.txt
  # den siste linjen er den offentlige mottakeren (age1...)
  ```
- Oppbevar **minst to kopier** på separate, krypterte medier utenfor serveren,
  med tydelig hvem som har ansvar. Test dem med `restore-test.sh`.
- Den automatiske restore-testen trenger en kopi på verten som `fsmbackup` kan
  lese (0600). Denne kopien skal ligge utenfor `BACKUP_DIR` og er **ikke** en
  erstatning for offlinekopiene.
- Ved rotasjon: lag nytt nøkkelpar, ta ny backup med ny mottaker, verifiser
  restore, og behold den gamle identiteten til alle gamle backuper er ute av
  retention.
- Ved mistanke om kompromittering: roter mottaker, ta nye backuper, og vurder
  offline re-kryptering av eldre backuper. Slett ikke den gamle identiteten før
  dere er sikre på at ingen gamle backuper trengs.
- Dokumentér nøkkelutstedelse, kopier, oppbevaringssted og destruksjon.

### 4.6 Compose PITR: WAL-arkiv og base-backup

For `docker-compose.ha.yml` ligger verktøyene i
[`deploy/postgres/pitr/`](../deploy/postgres/pitr/README.md). Kort:

- Postgres arkiverer hver WAL-fil med `archive-wal.sh` til
  `fsm_wal_archive`. Skriptet returnerer bare 0 når filen er synlig i arkivet.
- `postgres-basebackup` kjører `pg_basebackup -X stream`, verifiserer med
  `pg_verifybackup` og skriver `_SUCCESS` først etter at begge er grønne.
- `restore-pitr.sh` gjenoppretter til et **nytt** datakatalog, promoterer og
  verifiserer `_prisma_migrations`. Alle feil gir nonzero exit.
- WAL og base-backup må kopieres offsite (rclone/restic/Azure Blob). En volume
  på samme VM er ikke en disaster-recovery-kopi.
- Skriptene er ikke kjørt mot en ekte S3/Redis/Postgres i denne endringen;
  kjør en øvelse før de tas i bruk. Se restrisiko i
  [`docs/BACKLOG.md`](BACKLOG.md).

---

## 5. Planlegging, overvåking og varsling

### 5.1 Tidsplan

| Jobb | Standard | Formål |
| --- | --- | --- |
| `fsm-backup.timer` | Daglig 03:17 ± 15 min | Tar kryptert database- og opplastingsbackup. `Persistent=true` tar igjen en misset kjøring etter reboot. |
| `fsm-backup-check.timer` | Daglig 06:10 ± 10 min | Kontrollerer alder, sjekksum, statusfil og eventuell ekstern kopi. |
| `fsm-restore-test.timer` | Søndag 04:30 ± 30 min | Gjenoppretter til midlertidig database og verifiserer opplastingsarkivet. |

Endrer dere tidene, oppdater både enhetene og denne tabellen. En `OnCalendar`
endring krever `systemctl daemon-reload`.

### 5.2 Ferskhetskontroll

```bash
cd /opt/fsm-platform
./scripts/backup-freshness.sh
./scripts/backup-freshness.sh --max-age-hours 26 --require-remote
./scripts/backup-freshness.sh --prometheus-output /var/lib/node_exporter/textfile/fsm-backup.prom
```

Forventet ved OK:

```text
→ Kontrollerer backup i backups ...
  Alder: 14400s (grense 93600s)
  Sjekksum: OK
  Ekstern kopi: OK
✓ Backupkontrollen er OK.
```

Skriptet gir:

- **exit 0** når alle harde kontroller er OK (advarsler kan forekomme);
- **exit 1** ved manglende/foreldet backup, feil sjekksum eller manglende
  ekstern kopi når `REQUIRE_REMOTE_BACKUP=true`;
- **exit 2** ved ugyldig argument.

Advarsler gir exit 0 og utløser dermed **ikke** `OnFailure`. Vil dere at
manglende ekstern kopi skal være en hard feil, sett
`REQUIRE_REMOTE_BACKUP=true` i miljøfilen. Ellers er det bare en advarsel i
loggen.

Det kontrollerer også at nyeste database- og opplastingsfil har **samme
stamp**. Ulike stamps er en hard feil. En statusfil som peker på en annen
backup gir advarsel, ikke nødvendigvis feil. Sørg for at vertens klokke er
synkronisert (NTP/chrony); både mtime og `completedAt` brukes i vurderingen.

Merk: standard `BACKUP_STATUS_FILE` er `<BACKUP_DIR>/backup-status.json`. I
systemd-oppsettet peker den ofte på `monitoring/backup-status.json`. Kjører du
manuelt uten `EnvironmentFile`, kan du få advarsel om manglende statusfil selv
om backupen er OK. Bruk samme miljø som tjenesten:

```bash
sudo bash -c 'set -a; . /etc/fsm/fsm-backup.env; set +a; \
  cd /opt/fsm-platform && ./scripts/backup-freshness.sh --require-remote'
```

### 5.3 Målinger og alarmer

Appens `/api/metrics` (beskyttet med `METRICS_SECRET`) og
`backup-freshness.sh --prometheus-output` eksponerer:

| Metrikk | Betydning |
| --- | --- |
| `fsm_backup_present` | Siste backup finnes (textfile) |
| `fsm_backup_age_seconds` | Alder på siste backup |
| `fsm_backup_fresh` | Innenfor `BACKUP_MAX_AGE_HOURS` (standard 26) |
| `fsm_backup_checksum_ok` | Sjekksummen er gyldig (textfile) |
| `fsm_backup_remote_ok` | Ekstern kopi er verifisert (textfile) |

Alarmreglene i [`deploy/monitoring/fsm-alerts.yml`](../deploy/monitoring/fsm-alerts.yml):

| Alarm | Uttrykk | Alvor |
| --- | --- | --- |
| `FsmBackupStale` | `fsm_backup_fresh == 0` i 30 min | critical |
| `FsmBackupAgeHigh` | `fsm_backup_age_seconds > 93600` (26 t) i 30 min | critical |
| `FsmDiskLow` | `fsm_disk_used_ratio > 0.80` i 15 min | warning |

Systemd-checken fanger i tillegg sjekksum og ekstern kopi. Prometheus-reglene
over gjør det ikke alene; sørg for at `fsm-backup-check.service` også varsler
via `OnFailure`. `FsmBackup*` er **alarmnavn**; selve metrikkene heter
`fsm_backup_*`.

Rask kontroll:

```bash
curl -fsS -H "Authorization: Bearer $METRICS_SECRET" \
  http://127.0.0.1:3000/api/metrics | jq .backup

curl -fsS -H "Authorization: Bearer $METRICS_SECRET" \
  'http://127.0.0.1:3000/api/metrics?format=prometheus' | grep fsm_backup
```

Forventet:

```text
fsm_backup_age_seconds 14400
fsm_backup_fresh 1
```

`/api/metrics` svarer `503` uten `METRICS_SECRET`, og `401` ved feil token.

### 5.4 Logger og statusfiler

| Hva | Hvor |
| --- | --- |
| Backupstatus | `BACKUP_STATUS_FILE`, f.eks. `/var/backups/fsm/backup-status.json` og appens `/opt/fsm-platform/monitoring/backup-status.json` |
| Backupfiler | `BACKUP_DIR`, f.eks. `/var/backups/fsm` |
| Systemd-logger | `journalctl -u fsm-backup.service -u fsm-backup-check.service -u fsm-restore-test.service` |
| Varslingslogg | `journalctl -u 'fsm-alert@*'` |
| Cron (hvis dere bruker det) | `/var/log/fsm-backup.log`, `/var/log/fsm-backup-check.log`, `/var/log/fsm-restore-test.log` |
| Prometheus textfile | `/var/lib/node_exporter/textfile/fsm-backup.prom` |

`/opt/fsm-platform/monitoring/` må finnes og være skrivbar for `fsmbackup`, slik
at statusfilen kan oppdateres og Compose kan montere den read-only inn i appen.
Mangler katalogen eller rettighetene, blir `fsm_backup_fresh` stående på 0 selv
om backupen ellers er OK.

```bash
jq . /var/backups/fsm/backup-status.json
journalctl -u fsm-backup.service -n 100 --no-pager
journalctl -u fsm-backup-check.service -n 100 --no-pager
systemctl list-timers 'fsm-*'
```

Statusfilen ser slik ut:

```json
{
  "completedAt": "2026-11-07T02:17:04Z",
  "stamp": "20261107-021703",
  "databaseFile": "db-20261107-021703.sql.gz.age",
  "uploadsFile": "uploads-20261107-021703.tar.gz.age",
  "checksumsFile": "checksums-20261107-021703.sha256",
  "encrypted": true,
  "remote": "remote:fsm-backups",
  "databaseBytes": 12345678,
  "uploadsBytes": 98765432
}
```

`completedAt` er UTC. Filen skrives atomisk og skal ikke redigeres manuelt.

### 5.5 Test varslingskanalen

```bash
sudo bash -c 'set -a; . /etc/fsm/fsm-alert.env; set +a; \
  /opt/fsm-platform/scripts/ops-alert.sh --test'
```

Forventet:

```text
✓ Varsel sendt (info): TEST: FSM varslingskanal
```

Uten webhook (bare payload til stdout):

```bash
ALERT_DRY_RUN=true ./scripts/ops-alert.sh critical "test" "Dette er en test"
```

Test også systemd-veien:

```bash
sudo systemctl start fsm-alert@fsm-backup.service
journalctl -u fsm-alert@fsm-backup.service -n 50 --no-pager
```

Dette sender en `critical`-melding som om `fsm-backup.service` hadde feilet.
Bekreft at den kommer fram til riktig kanal og at noen faktisk ser den utenfor
arbeidstid. Dokumentér mottaker og eskalering i driftsjournalen.

Feiler testen, er ikke `OnFailure` et reelt vern. Rett kanalen før dere gjør
andre endringer. `ALERT_WEBHOOK_FORMAT` kan være `generic` (standard),
`alertmanager` eller `slack`; payloaden inneholder vert, tid, alvorlighetsgrad
og melding – aldri hemmeligheter eller persondata.

---

## 6. Gjenoppretting – runbook

### 6.1 Velg riktig prosedyre

| Situasjon | Prosedyre |
| --- | --- |
| Bare database, samme vert | [§6.3](#63-database-only-restore--ny-database-på-samme-vert) |
| Hele verten/volumene er borte | [§6.4](#64-full-disaster-restore--ny-vert) |
| Azure PostgreSQL, kortsiktig datatap | [§6.5](#65-point-in-time-restore-med-azure-postgresql-flexible-server) |
| Bare filer/vedlegg mangler | [§6.6](#66-uploads-only-og-enkeltfilgjenoppretting) |
| Feil appversjon eller migrering | [§6.8](#68-versjons--og-migrasjonsavvik) |
| Restore gikk galt | [§6.9](#69-rollback-etter-feilet-restore) |

### 6.2 Forberedelser og sikkerhetsport

**Ikke start en destruktiv restore før alle punktene er oppfylt.**

- [ ] Hendelsen er erklært, og incident lead er navngitt.
- [ ] Dataeier/eier av tjenesten er varslet. Ved personopplysninger: vurder
      personvernvarsel.
- [ ] Skriving er stoppet: `docker compose -f docker-compose.prod.yml stop app`.
- [ ] Nåværende tilstand er sikret så langt det er mulig (ny backup eller kopi
      av volum/DB).
- [ ] Gjenopprettingspunkt er valgt, med **samme stamp** for database og
      opplastinger.
- [ ] Målmiljøet er identifisert (vert, prosjekt, database, volum). Ikke pek på
      produksjon ved en feil.
- [ ] To personer er enige om kommandoene som sletter/overskriver noe.
- [ ] Nøkkel og `.env` er tilgjengelig uten å hente dem fra den skadede
      maskinen.

**Navngi miljøet eksplisitt i shellen.** Eksempel:

```bash
set -euo pipefail
cd /opt/fsm-platform
set -a; . ./.env; set +a
export COMPOSE_FILE=docker-compose.prod.yml
COMPOSE="docker compose"
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-fsm_db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fsm}"
AGE_IDENTITY="${AGE_IDENTITY:-/etc/fsm/age/keys.txt}"
STAMP="20261107-021703"
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz.age"
UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz.age"
TARGET_DB="${DB_NAME}_restore"
```

`set -a; . ./.env` forutsetter at `.env` er shell-kompatibel. Har dere verdier
med spesialtegn, hent dem med en trygg konfigurasjonsleser i stedet. Kontroller
alltid navnene før du bruker dem i `DROP`/`ALTER`:

```bash
printf 'DB_USER=%s\nDB_NAME=%s\nTARGET_DB=%s\n' "$DB_USER" "$DB_NAME" "$TARGET_DB"
```

**Verifiser sjekksum og dekryptering:**

```bash
(cd "$BACKUP_DIR" && sha256sum --check --strict "checksums-$STAMP.sha256")
```

Forventet:

```text
db-20261107-021703.sql.gz.age: OK
uploads-20261107-021703.tar.gz.age: OK
```

```bash
age -d -i "$AGE_IDENTITY" "$DB_FILE" | gzip -t
age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" | tar tzf - >/dev/null
```

Uten kryptering:

```bash
gzip -t "$DB_FILE"
tar tzf "$UPLOADS_FILE" >/dev/null
```

> **Formatvarsel – les dette:**
> `scripts/backup.sh` bruker `pg_dump` **uten** `-Fc`, altså **plain SQL**,
> gzippet. Den **må** gjenopprettes med `psql`, ikke `pg_restore`.
> Har dere derimot en `.dump` fra `pg_dump -Fc` (den manuelle
> flytteprosedyren i [README.md](../README.md#flytte-database-og-data)), bruker
> dere `pg_restore` – og da **ikke** `psql`. `pg_restore --clean` sletter
> objekter i måldatabasen; bruk en ny database og verifiser før cutover.
> `psql` uten `ON_ERROR_STOP=1` fortsetter etter feil og kan etterlate en
> halv database som ser «vellykket» ut. Bruk alltid
> `-v ON_ERROR_STOP=1`.

### 6.3 Database-only restore – ny database på samme vert

Dette er den vanligste og tryggeste varianten: produksjonsdatabasen røres ikke
før den nye er kontrollert.

> Kommandoene under forutsetter variablene fra [§6.2](#62-forberedelser-og-sikkerhetsport).
> Kjører du dem i en ny shell, sett `COMPOSE`, `DB_USER`, `DB_NAME`, `STAMP`,
> `BACKUP_DIR`, `DB_FILE`, `UPLOADS_FILE`, `TARGET_DB` og `AGE_IDENTITY` på
> nytt først.

```bash
# 1. Stopp appen, men behold Postgres.
$COMPOSE stop app
$COMPOSE up -d postgres
$COMPOSE exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME"
```

Ta en sikkerhetsbackup av dagens tilstand hvis mulig:

```bash
# Når miljøet er eksportert i shellen:
# Overstyr RETENTION_DAYS eksplisitt hvis .env har appens verdi (365):
RETENTION_DAYS=30 NODE_ENV=production \
  COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup.sh

# Hvis BACKUP_AGE_RECIPIENT bare finnes i systemd-miljøfilen:
sudo -u fsmbackup bash -c 'set -a; . /etc/fsm/fsm-backup.env; set +a; \
  cd /opt/fsm-platform && ./scripts/backup.sh'
```

Opprett en ny database og gjenopprett:

```bash
$COMPOSE exec -T postgres dropdb -U "$DB_USER" --if-exists "$TARGET_DB"
$COMPOSE exec -T postgres createdb -U "$DB_USER" "$TARGET_DB"

age -d -i "$AGE_IDENTITY" "$DB_FILE" \
  | gunzip -c \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 \
      -U "$DB_USER" -d "$TARGET_DB"
```

Er backupen ukryptert:

```bash
gunzip -c "$DB_FILE" \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 \
      -U "$DB_USER" -d "$TARGET_DB"
```

Er den `.sql` uten gzip:

```bash
# Kryptert .sql.age:
age -d -i "$AGE_IDENTITY" "$DB_FILE" \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 \
      -U "$DB_USER" -d "$TARGET_DB"

# Ukryptert .sql:
$COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$TARGET_DB" < "$DB_FILE"
```

> **Separate database roller:** Dumpen inneholder eierskap og `GRANT` fra
> kilden. Rollene `fsm_app`/`fsm_migrator` (eller de dere bruker) må finnes før
> restore, og gjenopprettingen må kjøres med en rolle som har nok rettigheter.
> `restore-test.sh` bruker `POSTGRES_USER` (standard `admin`). Får appen
> `permission denied` etter restore, sjekk roller og grants – ikke gi
> runtime-rollen superbruker for å «løse» det.

Kontroller kjernedata og migrasjoner:

```bash
$COMPOSE exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -c '
  SELECT
    (SELECT count(*) FROM "User")     AS users,
    (SELECT count(*) FROM "Customer") AS customers,
    (SELECT count(*) FROM "WorkOrder") AS work_orders,
    (SELECT count(*) FROM "Upload")   AS uploads,
    (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations;
'
```

Forventet: tall som ligner produksjonen like før backupen. Er `users` 0, er
dumpen feil eller ufullstendig – ikke bytt.

Kontroller at opplastingsarkivet har omtrent samme antall filer som
`Upload`-tabellen (det kan avvike noe på grunn av deduplisering og filer uten
metadata):

```bash
age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" | tar tzf - \
  | awk '$0 != "." && $0 != "./"' | wc -l
```

**Bytt database først når kontrollene er OK.** Appen er fortsatt stoppet.

```bash
# Avbryt eventuelle resterende tilkoblinger.
$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME';"

# Behold den gamle databasen under et tydelig navn.
$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE \"$DB_NAME\" RENAME TO \"${DB_NAME}_pre_restore_$STAMP\";"

$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE \"$TARGET_DB\" RENAME TO \"$DB_NAME\";"
```

Navnene må være enkle SQL-identifikatorer. Har dere bindestrek eller andre tegn
i databasenavnet, må det quoted riktig; kontroller med `\l` først.

Start appen med riktig image og eventuell migrasjonssperre:

```bash
BACKUP_CONFIRMED=true $COMPOSE up -d app
```

`BACKUP_CONFIRMED=true` kreves bare når `REQUIRE_BACKUP_BEFORE_MIGRATE=true`.
Det er en bekreftelse på at dere **har** tatt og verifisert backup, ikke en
magisk kvalitetsgaranti. Verdien nullstilles ikke av appen: fjern den eller sett
`BACKUP_CONFIRMED=false` etter at oppstarten er vellykket, ellers er sperren åpen
ved neste oppstart også.

Følg opp:

```bash
$COMPOSE ps
$COMPOSE logs --tail=100 app
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

Med `READY_SECRET`:

```bash
curl -fsS -H "Authorization: Bearer $READY_SECRET" \
  http://127.0.0.1:3000/api/ready | jq .
# forventet: status "ready" og databaseRole.canDdl: false
```

#### Ekstern database (ikke Docker Compose)

`backup.sh` kaller `docker compose exec postgres pg_dump`, så den virker **ikke**
mot en ekstern PostgreSQL/Azure-server uten en lokal `postgres`-tjeneste i
Compose. For ekstern database:

- bruk Azure PITR/Azure Backup når det er tilgjengelig;
- eller ta en logisk dump med `pg_dump` mot `DATABASE_URL` og gjenopprett med
  `psql` til en ny database/server.

Eksempel på manuell logisk dump (ikke en del av repo-skriptet):

```bash
set -euo pipefail
umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
: "${DATABASE_URL:?Sett DATABASE_URL}"
: "${BACKUP_AGE_RECIPIENT:?Sett BACKUP_AGE_RECIPIENT}"

pg_dump "$DATABASE_URL" \
  | gzip -c \
  | age --recipient "$BACKUP_AGE_RECIPIENT" \
      --output "db-$STAMP.sql.gz.age"

sha256sum "db-$STAMP.sql.gz.age" > "checksums-$STAMP.sha256"
```

Bruk en `pg_dump`-klient som er lik eller nyere enn serverens majorversjon.
Test alltid med `psql` mot en midlertidig database, ikke direkte mot produksjon.

### 6.4 Full disaster restore – ny vert

Bruk denne når maskinen, Docker-volumene eller hele miljøet er tapt. Målet er
å bygge et nytt, isolert miljø, gjenopprette data, verifisere, og først deretter
sende trafikk dit.

#### 1. Forbered verten

- **Provisioner** ny VM/vert i henhold til [docs/AZURE.md](AZURE.md) eller deres
  vanlige infrastrukturmal.
- Installer Docker med Compose v2, `age`, `rclone` og `git`/utrullingsverktøy.
- Legg repoet på samme sti som før, f.eks. `/opt/fsm-platform`, og check ut
  riktig versjon/tag.
- Gjenopprett `.env` fra hemmelighetshvelv eller segl. Ikke kopier den fra en
  mistenkelig eller skadet maskin uten å vurdere rotasjon.
- Legg age-identiteten på plass med `0600`, og kontroller at den kan dekryptere
  en testfil.
- Gjenopprett Caddy/proxy-konfigurasjon og eventuell DNS-plan.

```bash
sudo install -d -m 700 -o fsmbackup -g fsmbackup /var/backups/fsm
sudo install -d -m 755 -o fsmbackup -g fsmbackup /opt/fsm-platform/monitoring
cd /opt/fsm-platform
chmod 600 .env
docker compose -f docker-compose.prod.yml config --images
```

`config --images` viser faktisk `APP_IMAGE` og `POSTGRES_IMAGE`. Bekreft at
`APP_IMAGE` er en konkret versjon/digest, ikke `latest`.

#### 2. Opprett volumer uten å starte appen

```bash
COMPOSE="docker compose -f docker-compose.prod.yml"

$COMPOSE pull
$COMPOSE up -d --no-start
docker volume ls --format '{{.Name}}' | grep -E 'fsm_(postgres_data|uploads)$'
```

`up -d --no-start` oppretter containere og navngitte volumer uten å starte dem.
Volumnavnene får prosjektprefiks (prosjektnavnet er normalt katalognavnet).
Bekreft navnene før du rører dem.

#### 3. Gjenopprett database

```bash
docker compose -f docker-compose.prod.yml up -d postgres
# Vent til healthcheck er grønn:
docker compose -f docker-compose.prod.yml ps
```

Følg [§6.3](#63-database-only-restore--ny-database-på-samme-vert) for
oppretting av mål-DB, `psql`-restore og kontroll. På en helt ny vert kan du
gjenopprette direkte i `fsm_db` etter at Postgres har initialisert den tomme
databasen:

```bash
COMPOSE="docker compose -f docker-compose.prod.yml"
DB_USER="admin"          # eller POSTGRES_USER fra .env
DB_NAME="fsm_db"         # eller POSTGRES_DB fra .env
AGE_IDENTITY="/etc/fsm/age/keys.txt"
DB_FILE="/var/backups/fsm/db-20261107-021703.sql.gz.age"

$COMPOSE exec -T postgres dropdb -U "$DB_USER" --if-exists "$DB_NAME"
$COMPOSE exec -T postgres createdb -U "$DB_USER" "$DB_NAME"

age -d -i "$AGE_IDENTITY" "$DB_FILE" \
  | gunzip -c \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 \
      -U "$DB_USER" -d "$DB_NAME"
```

Kontroller også her at `User`, `Customer`, `WorkOrder`, `Upload` og
`_prisma_migrations` har forventede tall før du går videre:

```bash
$COMPOSE exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c '
  SELECT
    (SELECT count(*) FROM "User")      AS users,
    (SELECT count(*) FROM "Customer")  AS customers,
    (SELECT count(*) FROM "WorkOrder") AS work_orders,
    (SELECT count(*) FROM "Upload")    AS uploads,
    (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations;
'
```

På et helt nytt PostgreSQL-cluster må også approllene finnes. `pg_dump`
inneholder ikke roller eller passord. Provisioner `fsm_app`/`fsm_migrator` med
[`scripts/provision-db-roles.sh`](../scripts/provision-db-roles.sh) og
`deploy/postgres/provision-roles.sql` før appen startes; ellers kan appen falle
tilbake til `admin` og `/api/ready` bli `503` i produksjon. Se
[OPERATIONS.md](OPERATIONS.md#databaseroller-minste-privilegium). Ikke løs det
permanent med `ALLOW_DB_DDL_ROLE=true`.

#### 4. Gjenopprett opplastingsvolumet

```bash
AGE_IDENTITY="${AGE_IDENTITY:-/etc/fsm/age/keys.txt}"
UPLOADS_FILE="${UPLOADS_FILE:-/var/backups/fsm/uploads-20261107-021703.tar.gz.age}"
VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_fsm_uploads$' | head -n 1)"
printf 'Bruker volum: %s\n' "$VOLUME"
printf 'Bruker arkiv: %s\n' "$UPLOADS_FILE"
test -n "$VOLUME"
test -f "$UPLOADS_FILE"

# Tøm det nye, tomme volumet. Kontroller VOLUME først!
docker run --rm -v "$VOLUME:/data" postgres:15.13 sh -c 'find /data -mindepth 1 -delete'

age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" \
  | docker run --rm -i -v "$VOLUME:/data" postgres:15.13 tar xzf - -C /data
```

Kontroller:

```bash
docker run --rm -v "$VOLUME:/data" postgres:15.13 \
  sh -c 'find /data -type f | wc -l'

docker run --rm -v "$VOLUME:/data" postgres:15.13 \
  sh -c 'find /data -maxdepth 2 -type f | head'
```

Sammenlign med `Upload`-antallet. Er volumet tomt eller mangler filer, ikke
start appen.

Eierskap: imaget kjører som UID/GID `1001:1001` (`nextjs`). Tar-arkivet fra en
tidligere produksjon bør allerede ha riktig eierskap. Har dere pakket ut med
feil eier, sammenlign med en fersk installasjon før dere eventuelt retter:

```bash
docker run --rm -v "$VOLUME:/data" postgres:15.13 \
  sh -c 'find /data -maxdepth 2 -printf "%u:%g %m %p\n" | head'
```

Ikke bruk `chmod 777`. Bruk `chown 1001:1001` bare når dere vet at arkivet
kommer fra samme appbruker.

#### 5. Start appen og verifiser

```bash
$COMPOSE up -d app
$COMPOSE ps
$COMPOSE logs --tail=100 app
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

Gjør røyktest **før** DNS-cutover:

- logg inn som administrator;
- åpne en kunde og et oppdrag;
- åpne et vedlegg fra opplastingsvolumet;
- åpne/generer en rapport-PDF;
- se at revisjonsloggen viser handlingene;
- sjekk `fsm_backup_*`-metrikkene og at backup-timeren er aktiv.

#### 6. DNS/Caddy-cutover

1. Senk TTL i god tid før planlagt cutover.
2. Pek DNS mot ny vert.
3. Start/reload Caddy med riktig `Caddyfile`.
4. Verifiser sertifikat og proxy:

```bash
dig +short fsm.example.com
curl -fsS https://fsm.example.com/api/health
curl -fsS https://fsm.example.com/api/ready
```

Før DNS er byttet kan dere teste mot ny IP med `curl --resolve`, men vær klar
over at Caddy/ACME kan kreve at domenet faktisk peker dit for å utstede
sertifikat. Ikke send brukere til et miljø som ikke er verifisert.

#### 7. Etter cutover

- Overvåk feilrate, `/api/ready`, logger og innlogging i minst 30–60 minutter.
- Behold gammel vert/volum/database i karantene til dere har bekreftet at ny
  backup er tatt og verifisert.
- Ta en ny backup umiddelbart etter vellykket restore.
- Roter hemmeligheter hvis den gamle verten kan ha vært kompromittert.
- Oppdater driftsdokumentasjonen med faktisk RTO og avvik.

### 6.5 Point-in-time restore med Azure PostgreSQL Flexible Server

Dette gjelder bare når databasen er en Azure Database for PostgreSQL Flexible
Server. Det gjenoppretter **databasen**, ikke opplastingsvolumet.

1. Finn ønsket tidspunkt i UTC og kontroller at det er innenfor
   backupretention (7–35 dager).
2. Opprett en ny server med `az postgres flexible-server restore` (se
   [§4.4](#44-azure-spesifikke-muligheter)). PITR krever nytt servernavn og
   samme majorversjon.
3. Vent til serveren er `Ready`, og kontroller nettverk, privat DNS og
   brannmurregler.
4. Oppdater `DATABASE_RUNTIME_URL`/`DATABASE_MIGRATION_URL` i `.env` til den nye
   serveren. Bruk `sslmode=require`. Ikke gjenbruk en gammel tilkoblingsstreng
   med feil host.
5. Start appen. `prisma migrate deploy` kjøres ved oppstart; verifiser at
   `_prisma_migrations` matcher imageversjonen.
6. Verifiser tellinger og røyktest. Opplastinger må gjenopprettes separat hvis
   de også er rullet tilbake; ellers kan databasen peke på filer som er nyere
   eller mangler.
7. Behold den gamle serveren til ny er verifisert. Slett den bevisst etter
   retention/vurdering – ikke automatisk.

Azure Backup (vaulted/LTR) gir policybaserte recovery points utover 35 dager.
Restore skjer til en ny server. Følg Microsofts prosedyre for deres policy og
verifiser at både database og opplastinger er dekket; Azure Backup for
PostgreSQL dekker ikke Docker-volumet med opplastinger.

### 6.5.1 Point-in-time restore med Compose og WAL-arkiv

Bruk denne når dere kjører `docker-compose.ha.yml` og har WAL-arkiv +
base-backup. Restore skjer alltid til et nytt katalog og en annen port.

1. Stopp appen: `docker compose -f docker-compose.ha.yml stop app`.
2. Finn siste **verifiserte** base-backup før ønsket tidspunkt:
   `docker run --rm -v fsm_base_backups:/backup:ro postgres:15.13 sh -c 'ls -1 /backup/base-*/_SUCCESS | tail -1'`.
3. Kontroller at WAL-filene for intervallet finnes i `fsm_wal_archive`.
4. Kjør `restore-pitr.sh` mot et nytt, tomt datakatalog og port 55432. Se
   [`deploy/postgres/pitr/README.md`](../deploy/postgres/pitr/README.md) for
   eksakt `docker run`-kommando.
5. Verifiser at `pg_is_in_recovery()` er `false`, at `_prisma_migrations` har
   forventet antall, og at tellinger for oppdrag/rapporter/opplastinger ligger
   mellom kjente punkter.
6. Pek `DATABASE_RUNTIME_URL` mot den nye databasen, start **én** app-replika,
   kontroller `/api/ready`, og skaler deretter ut.
7. Opplastinger i S3 er **ikke** rullet tilbake av PITR. Bruk S3-versjonering
   eller en bucket-backup fra samme tidsvindu, og verifiser at fil-URL-ene
   fortsatt finnes.
8. Skriv hendelseslogg med base-backup, target-time, operatør og målt RTO.

### 6.6 Uploads-only og enkeltfilgjenoppretting

Bruk denne når databasen er OK, men filer mangler eller er skadet.

> **Ta alltid en ny backup av dagens volum først**, eller kopier volumet til et
> midlertidig volum. `find -delete` nedenfor er destruktivt.

```bash
AGE_IDENTITY="${AGE_IDENTITY:-/etc/fsm/age/keys.txt}"
UPLOADS_FILE="${UPLOADS_FILE:-/var/backups/fsm/uploads-20261107-021703.tar.gz.age}"
VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_fsm_uploads$' | head -n 1)"
printf 'Bruker volum: %s\n' "$VOLUME"
printf 'Bruker arkiv: %s\n' "$UPLOADS_FILE"
test -n "$VOLUME"
test -f "$UPLOADS_FILE"
```

#### Hele volumet

```bash
docker run --rm -v "$VOLUME:/data" postgres:15.13 sh -c 'find /data -mindepth 1 -delete'
age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" \
  | docker run --rm -i -v "$VOLUME:/data" postgres:15.13 tar xzf - -C /data
```

#### Enkelt fil

List innholdet og finn eksakt sti:

```bash
age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" | tar tzf - | grep -i 'del av filnavn'
```

Trekk ut bare denne stien (ta med `./` slik den står i arkivet):

```bash
FILE_PATH="./2026/11/abc123.pdf"   # bytt til faktisk sti fra listen

age -d -i "$AGE_IDENTITY" "$UPLOADS_FILE" \
  | docker run --rm -i -v "$VOLUME:/data" postgres:15.13 \
      tar xzf - -C /data "$FILE_PATH"
```

Kontroller at filen finnes, har riktig eier og kan åpnes i UI. Ikke legg
ukrypterte filer på vertens `/tmp`; hvis du må det, bruk `umask 077` og slett
dem umiddelbart.

Ved «permission denied»: sammenlign eierskap med en frisk fil. Appen kjører som
`1001:1001`; filer med annen eier kan gi 403/500.

### 6.7 Database-only restore fra ekstern server

Har dere en dump fra ekstern PostgreSQL, gjenopprett til en **ny** database på
en **ny** server eller et isolert schema:

```bash
# Eksempel – tilpass host, bruker og database.
# Bruk .pgpass eller en beskyttet fil; ikke skriv passordet i historikken.
export PGPASSWORD="$(cat /etc/fsm/pg-password)"
psql "host=$PGHOST port=5432 dbname=postgres user=$PGUSER sslmode=require" \
  -c 'CREATE DATABASE fsm_db_restore;'

age -d -i "$AGE_IDENTITY" "$DB_FILE" \
  | gunzip -c \
  | psql "host=$PGHOST port=5432 dbname=fsm_db_restore user=$PGUSER sslmode=require" \
      -v ON_ERROR_STOP=1
```

Ikke lim inn passord i historikken på en delt maskin; bruk `.pgpass`,
`PGPASSWORD` fra en beskyttet fil, eller en sky-identitet. Bytt appens
`DATABASE_URL` etter verifisering, ikke før.

### 6.8 Versjons- og migrasjonsavvik

Dumpen inneholder `_prisma_migrations` fra tidspunktet den ble tatt. Appimaget
inneholder migrationsfilene. De må være kompatible.

Sjekk hvilke migrasjoner som er anvendt i dumpen:

```bash
$COMPOSE exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -c '
  SELECT migration_name, finished_at
  FROM "_prisma_migrations"
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 10;
'
```

Sammenlign med `prisma/migrations/` i repoet eller imaget for `APP_IMAGE`.
Regler:

- **Dumpen er eldre enn imaget:** appen kan kjøre `prisma migrate deploy` og
  anvende de manglende, additive migrasjonene. Verifiser etterpå.
- **Dumpen er nyere enn imaget:** ikke start et eldre image mot en nyere
  database. Bruk imaget som matcher dumpen, eller et nyere image som er testet
  mot disse migrasjonene.
- **Ukjent/avvikende historikk:** ikke rediger `_prisma_migrations` manuelt, og
  ikke kjør `prisma migrate reset` eller `prisma db push` i produksjon. Det
  sletter data. Rett fremover med riktig image, eller gjenopprett på nytt.
- **Migrering feiler:** appen stopper ofte før den blir klar. Les
  `$COMPOSE logs app`, og hold databasen. Ikke slett den for å «prøve på nytt».

Hvis `REQUIRE_BACKUP_BEFORE_MIGRATE=true` og `BACKUP_CONFIRMED` mangler, nekter
oppstartsskriptet å migrere. Det er en sperre, ikke en feil i backupen.
`BACKUP_CONFIRMED` nullstilles ikke automatisk; fjern den etter vellykket
oppstart. `SKIP_MIGRATIONS=true` hopper over hele migrasjonssteget og dermed også
denne sperren; ikke bruk det i produksjon uten en bevisst, dokumentert grunn.

### 6.9 Rollback etter feilet restore

Behold alltid:

- gammel database under navnet `${DB_NAME}_pre_restore_$STAMP`;
- gammel `fsm_uploads` (ny backup eller kopiert volum);
- forrige `APP_IMAGE`-tag/digest;
- `.env` og nøkkel.

Ved feil:

```bash
$COMPOSE stop app

# Avbryt tilkoblinger og bytt tilbake databasen.
$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME';"

$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE \"$DB_NAME\" RENAME TO \"${DB_NAME}_failed_restore_$STAMP\";"

$COMPOSE exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE \"${DB_NAME}_pre_restore_$STAMP\" RENAME TO \"$DB_NAME\";"
```

Gjenopprett opplastingsvolumet fra sikkerhetsbackupen hvis det ble endret.
Start deretter med gammelt image:

```bash
APP_IMAGE=ghcr.io/eroticd/fsm-platform:v0.9.5 $COMPOSE up -d app
```

Rollback av database er **destruktivt** for data skrevet etter at den gamle
databasen ble tatt ut av bruk. Gjør det bare når det er bedre enn alternativet,
og dokumenter tapet.

### 6.10 Kontroller etter restore

| Kontroll | Kommando | Forventet |
| --- | --- | --- |
| Liveness | `curl -fsS http://127.0.0.1:3000/api/health` | `200`, `status: ok` |
| Readiness | `curl -fsS http://127.0.0.1:3000/api/ready` | `200`, `status: ready` |
| DB-rolle | `curl ... -H "Authorization: Bearer $READY_SECRET" .../api/ready \| jq .databaseRole` | `canDdl: false` |
| Brukere | `SELECT count(*) FROM "User";` | > 0 og sammenlignbar med kilden |
| Kunder/oppdrag | `SELECT count(*) FROM "Customer";`, `"WorkOrder"` | Sammenlignbar |
| Opplastinger | `SELECT count(*) FROM "Upload";` og filantall i volumet | Sammenlignbart |
| Migrasjoner | `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;` | Matcher image |
| Vedlegg | Åpne en kjent fil i UI | Lastes ned, ikke 403/404 |
| PDF | Åpne/generer en rapport-PDF | Vises uten feil |
| Revisjonskjede | `DATABASE_URL=... npm run audit:verify` | `✓ Revisjonskjeden er intakt` |
| Backup | `./scripts/backup-freshness.sh --require-remote` | Exit 0 |
| Metrikker | `curl ... /api/metrics \| jq .backup` | `fresh: true` |

Får dere `503` fra `/api/ready` med `databaseRole.canDdl: true`, kjører appen
med en DDL-rolle (ofte fordi `DATABASE_RUNTIME_URL` mangler og fallback er
`POSTGRES_USER`). Provisioner `fsm_app`/`fsm_migrator` og sett URL-ene riktig;
ikke skru på `ALLOW_DB_DDL_ROLE=true` permanent.

`npm run audit:verify` krever dev-avhengigheter (`tsx`), som ikke ligger i
produksjonsimaget. Kjør det fra en kopi av repoet med `npm ci`, eller i en
midlertidig container med repoet og avhengighetene montert – ikke anta at
kommandoen virker inne i appcontaineren. Kommandoen krever `DATABASE_URL`.

Appen kjører `scripts/backfill-uploads.mjs` ved oppstart når
`BACKFILL_UPLOADS=true` (standard). Den registrerer `Upload`-metadata for filer
som er referert i eksisterende data, men mangler egen rad. Den er idempotent og
kan derfor kjøre trygt etter restore. Den beviser ikke at database-rader peker
på eksisterende filer – kontroller det separat.

Sørg for at `SEED_DATABASE=false` etter restore. Ellers kan oppstartsseed legge
til data i den gjenopprettede databasen. `SEED_DATABASE` er av som standard, men
kontroller verdien i `.env` før appen startes.

Ved restore fra en eldre eller ukjent backup: vurder å rotere `NEXTAUTH_SECRET`
før appen settes i drift. Det kan ugyldiggjøre eksisterende økter, men er ofte
riktig når backupens opprinnelse eller integritet ikke er fullt dokumentert.
Test innlogging etterpå.

---

## 7. Restore-test og øvelser

### 7.1 Ukentlig automatisk test

`scripts/restore-test.sh`:

- finner nyeste `db-*.sql.gz[.age]` og `uploads-*.tar.gz[.age]` i `BACKUP_DIR`
  hvis dere ikke peker eksplisitt;
- dekrypterer i en strøm (aldri ukryptert fil på disk);
- oppretter en midlertidig database (standard `fsm_restore_test`);
- gjenoppretter med `psql -v ON_ERROR_STOP=1`;
- kontrollerer `User`, `Customer` og `_prisma_migrations`;
- verifiserer at opplastingsarkivet kan listes;
- sletter testdatabasen via `EXIT`-trap, også ved feil.

Kjør manuelt:

```bash
cd /opt/fsm-platform
COMPOSE_FILE=docker-compose.prod.yml \
AGE_IDENTITY=/etc/fsm/age/keys.txt \
BACKUP_FILE=/var/backups/fsm/db-20261107-021703.sql.gz.age \
UPLOADS_FILE=/var/backups/fsm/uploads-20261107-021703.tar.gz.age \
./scripts/restore-test.sh
```

Uten eksplisitte filer:

```bash
COMPOSE_FILE=docker-compose.prod.yml \
AGE_IDENTITY=/etc/fsm/age/keys.txt \
./scripts/restore-test.sh
```

Forventet:

```text
→ Verifiserer opplastingsarkivet /var/backups/fsm/uploads-20261107-021703.tar.gz.age ...
  Opplastinger: 123 filer i arkivet
→ Oppretter midlertidig database fsm_restore_test ...
→ Gjenoppretter /var/backups/fsm/db-20261107-021703.sql.gz.age ...
→ Kontrollerer kjernedata ...
  Brukere:     12
  Kunder:      34
  Migrasjoner: 56
✓ Restore-test fullført (database og opplastinger).
```

Exit 0 er et minstekrav. Exit != 0 betyr at testen ikke er bestått – ikke
ignorer den fordi «backupen sikkert er fin».

`TEST_DB` (standard `fsm_restore_test`) kan overstyres, men scriptet nekter å
bruke samme navn som `POSTGRES_DB`. Bruk aldri et navn som peker på produksjon.

### 7.2 Hva testen beviser – og ikke beviser

**Beviser:**

- at arkivet kan dekrypteres med den oppgitte identiteten;
- at SQL-dumpen kan leses inn uten feil med `ON_ERROR_STOP`;
- at kjernetabellene finnes og har data;
- at migrasjonshistorikken finnes;
- at opplastingsarkivet er et gyldig tar-arkiv og kan listes.

**Beviser ikke:**

- at hver `Upload`-rad peker på riktig fil;
- at alle filer er komplette eller lesbare av appen;
- at PDF/OCR, tilgangskontroll eller UI fungerer;
- at appversjonen matcher skjemaet i alle detaljer;
- at restore tar den tiden dere tror.

Derfor: ukentlig `restore-test.sh`, og **kvartalsvis full øvelse** på isolert
vert med database + opplastinger + app + røyktest.

### 7.3 Full øvelse

1. Velg en backup, fortrinnsvis nyeste og en eldre innenfor retention.
2. Bygg et isolert miljø (egen VM/namespace) med samme image og `.env`-mal.
3. Gjenopprett database og opplastinger etter [§6.3](#63-database-only-restore--ny-database-på-samme-vert)
   og [§6.6](#66-uploads-only-og-enkeltfilgjenoppretting).
4. Start appen og gjør røyktest: innlogging, kunde, oppdrag, vedlegg, PDF,
   revisjonslogg.
5. Mål tiden fra «go» til verifisert tjeneste. Det er RTO.
6. Test også at dere kan dekryptere **uten** den opprinnelige serveren, med
   bare den offline nøkkelen.
7. Skriv bevis:

   | Felt | Verdi |
   | --- | --- |
   | Dato og varighet |  |
   | Backup-stamp |  |
   | Databasefil / opplastingsfil |  |
   | Operatør(er) |  |
   | Miljø |  |
   | Resultat (bestått/feilet) |  |
   | RTO målt |  |
   | Avvik og tiltak |  |
   | Neste øvelse |  |

8. Oppdater [§3](#3-rpo-og-rto) hvis målene ikke holdt.

### 7.4 Når testen må kjøres i tillegg

- etter nøkkelrotasjon;
- etter majoroppgradering av PostgreSQL eller appen;
- etter endring av `BACKUP_DIR`, rclone eller Azure-oppsett;
- etter en hendelse der dere gjenopprettet;
- før en stor migrering eller et stort datauttrekk.

---

## 8. Sikkerhet, personvern og etterlevelse

### 8.1 Kryptering

- **I transit:** rclone/azcopy mot ekstern lagring skal bruke TLS. PostgreSQL
  mot ekstern server skal bruke `sslmode=require` (eller sterkere).
- **At rest:** age-kryptering er påkrevd i produksjon
  (`BACKUP_AGE_RECIPIENT`). Blob-kryptering og diskkryptering er ekstra lag,
  ikke erstatning.
- **Nøkkelseparasjon:** den offentlige mottakeren kan ligge på serveren; den
  private identiteten skal primært oppbevares offline og ikke sammen med
  backupene. Automatisert restore-test krever en beskyttet kopi på verten
  (0600, utenfor `BACKUP_DIR`); det er en bevisst avveining, ikke en erstatning
  for offlinekopiene.
- Sjekksumfiler og statusfiler er ikke kryptert, men inneholder bare filnavn,
  hasher, tid og størrelse – ikke persondata.

### 8.2 Personopplysninger

Database og opplastinger kan inneholde navn, adresser, bilder, rapporter og
revisjonsspor. Backupene arver dette.

- Begrens lesetilgang til `BACKUP_DIR` og ekstern container.
- Ikke kopier backupfiler til laptop, e-post eller chat.
- Ved databehandleravtale/GDPR: dokumentér behandling, lagringssted,
  underleverandører og retention.
- Ved innsyn/sletting: ikke slett enkeltrader direkte i en backup. Gjenopprett
  til et isolert miljø, utfør endringen der, og følg deres prosedyre for
  oppdatert backup/retention. Dokumentér vurderingen.
- Ved brudd: følg [SECURITY.md](../SECURITY.md), varsle personvernansvarlig, og
  ikke slett logger eller bevis.

### 8.3 Tilgang og roller

- `fsmbackup` er en dedikert driftsbruker. Docker-gruppen er root-ekvivalent;
  begrens hvem som kan bruke den.
- `chmod 600` på `.env` og nøkkelfiler, `0700` på backupmappen.
- Ekstern lagring: egen container, privat nettverk, minst mulig RBAC. Ingen
  offentlig Blob-tilgang.
- Azure: bruk managed identity og RBAC på container/server, ikke account keys
  eller lange SAS-tokens.
- To-personersregel ved destruktiv restore og sletting av backup.
- Tilgangsliste gjennomgås minst kvartalsvis.

### 8.4 Retension, legal hold og uforanderlighet

- Lokal `RETENTION_DAYS=30` er et utgangspunkt, ikke en etterlevelsesregel.
  `BACKUP_DIR` bør ligge på en annen disk/volum enn database- og
  opplastingsvolumet; ellers kan én diskfeil ta både drift og lokal backup.
  Ekstern lagring bør ha lengre retention og egen livssyklus.
- Ved `legalHold` på oppdrag/rapporter eller `AuditHold`: ikke slett backuper
  som kan inneholde beviset før holdet er opphevet og juridisk avklart.
- Bruk Blob-versioning, soft delete og immutability/legal hold for å beskytte
  mot sletting og ransomware. Test at policyen faktisk blokkerer sletting.
- 3-2-1: minst tre kopier, to medier/lagre, én utenfor primærmiljøet.
  Kvartalsvis øvelse skal bevise at den eksterne kopien kan brukes.

### 8.5 Revisjon av driftshandlinger

- Logg hver backup, restore, nøkkelrotasjon og sletting: hvem, hva, når,
  hvorfor, hvilken backup-ID, mål og resultat.
- Systemd/journalctl og Prometheus er driftslogger, ikke forretningsrevisjon.
  Appens `AuditLog` er inne i databasen. Ved total tap må driftsjournalen kunne
  dokumentere hva som skjedde.
- Eksporter revisjonslogg/bevis med appens egne endepunkter og arkiver ZIP-en
  på uforanderlig lagring. Se [audit-retention.md](audit-retention.md).

### 8.6 Absolutte regler

- Gjenopprett **aldri** over produksjon uten en verifisert backup og et
  identifisert tilbakefallspunkt.
- Slett **aldri** en backup eller nøkkel før en ny restore er testet og
  retention/legal hold er avklart.
- Kjør **aldri** `prisma migrate reset`, `prisma db push` eller
  `docker system prune --volumes` i produksjon.
- Bruk **aldri** `psql` uten `ON_ERROR_STOP=1` til en automatisk restore.

---

## 9. Feilsøking

| Symptom | Sannsynlig årsak | Tiltak |
| --- | --- | --- |
| `✖ Fant ikke opplastingsvolumet. Sett UPLOADS_VOLUME=<navn>` | Volumet har annet navn, eller flere stacks forvirrer autofinning | `docker volume ls`; sett `UPLOADS_VOLUME` eksplisitt i miljøfilen |
| `✖ Fant ikke age-identiteten «...». Sett AGE_IDENTITY.` | Nøkkelen mangler på verten, eller feil sti | Hent offline kopi/Key Vault; kontroller `AGE_IDENTITY`; ikke lag ny nøkkel for gamle backuper |
| `age: error: no identity matched any of the recipients` | Feil nøkkel for denne backupen, eller rotasjon | Bruk identiteten som hører til stampen; test med `restore-test.sh` |
| `✖ Sjekksummen stemmer ikke for ...` | Avkuttet/endret fil, feil kopi, diskfeil | Slett ikke beviset; sammenlign med ekstern kopi; bruk annen backup; undersøk lagring |
| `✖ Siste backup er ... over grensen` | Timer har ikke kjørt, jobben feilet, eller statusfil mangler | `journalctl -u fsm-backup.service`; sjekk disk, nøkkel, rclone; kjør manuelt |
| `✖ Den eksterne kopien mangler eller avviker` | rclone feilet, feil remote, retention/livssyklus slettet filer, eller hashing ikke støttet | `rclone check` manuelt; sjekk credentials; ikke sett `BACKUP_VERIFY_REMOTE=false` uten dokumentert grunn |
| `BACKUP_VERIFY_REMOTE=false` men daglig check feiler fortsatt | `backup-freshness.sh` ignorerer variabelen og kjører `rclone check` når `BACKUP_REMOTE` er satt | Bruk backend med hashing, eller fjern/juster `BACKUP_REMOTE` og dokumenter avveiningen |
| `rclone: command not found` | rclone ikke installert på verten | Installer rclone, eller fjern `BACKUP_REMOTE` midlertidig og varsle |
| `pg_restore: error: input file appears to be a text format dump. Please use psql` | Dumpen er plain SQL fra `backup.sh`, men du brukte `pg_restore` | Bruk `psql -v ON_ERROR_STOP=1`; se [§6.2](#62-forberedelser-og-sikkerhetsport) |
| `psql: ... invalid command \` eller `COPY`-feil | Du brukte `psql` på en custom-format `.dump` | Bruk `pg_restore -d ...` for `-Fc`-dump |
| `database "fsm_db" is being accessed by other users` | Appen eller andre tilkoblinger er fortsatt aktive | Stopp appen; `pg_terminate_backend`; prøv igjen |
| `✖ Fant ingen brukere i backupen` (restore-test) | Feil/ufullstendig dump, eller feil database | Kontroller at du peker på riktig fil; ikke bytt produksjonsdatabase |
| `No space left on device` / `FsmDiskLow` | Disk full, ofte backup- eller opplastingsvolum | Rydd gamle backupfiler bevisst, øk volum, ikke slett nyeste; sjekk `df -h` |
| Migrering feiler ved oppstart (`P3009`, `P3018`, `migrate deploy` exit != 0) | Dump/image-mismatch, manglende rolle/rettighet, eller feil i migrering | Les `logs app`; bruk riktig image; ikke `migrate reset`; vurder rollback |
| Migrasjonssperren slår ikke inn selv om `REQUIRE_BACKUP_BEFORE_MIGRATE=true` | `BACKUP_CONFIRMED=true` står fortsatt i miljøet, eller `SKIP_MIGRATIONS=true` | Fjern/sett `BACKUP_CONFIRMED=false`; fjern `SKIP_MIGRATIONS`; start på nytt |
| Backupfiler beholdes mye lenger enn 30 dager | `.env` med appens `RETENTION_DAYS=365` er sourcet inn i backupjobben | Bruk `/etc/fsm/fsm-backup.env` eller overstyr `RETENTION_DAYS=30` |
| `fsm_backup_fresh` er 0 rett etter restore | Ingen ny backup er tatt, eller statusfilen mangler/finnes ikke i `monitoring/` | Ta ny backup; kontroller `BACKUP_STATUS_FILE`, katalogrettigheter og at appen leser riktig containersti |
| `EACCES`/403/500 på vedlegg | Feil eier/rettigheter på opplastingsvolumet, eller `UPLOAD_DIR` feil | Sammenlign med fersk installasjon; `chown 1001:1001` bare ved behov; sjekk `UPLOAD_DIR=/app/uploads` |
| Vedlegg 404 etter restore | Database og opplastinger er fra ulike tidspunkter, eller filen mangler i arkivet | Gjenopprett begge fra samme stamp; enkeltfilgjenoppretting |
| `docker: permission denied ... docker.sock` | `fsmbackup` er ikke i docker-gruppen | `sudo usermod -aG docker fsmbackup`; logg inn på nytt; vurder sikkerhetskonsekvens |
| PITR avvises: utenfor retention | Ønsket tidspunkt er eldre enn 7–35 dager | Bruk Azure Backup/LTR eller logisk dump; ikke prøv vilkårlig tid |
| Azure-restore navn/region feiler | Navn er tatt, eller PITR prøver annen region/versjon | Velg nytt navn; PITR samme region/majorversjon; geo-restore for paregion |
| Key Vault `Forbidden` | Manglende RBAC/access policy for driftsidentiteten | Gi minste nødvendige `get`/`list`; bruk offline nøkkel som fallback |

---

## 10. Sjekklister

### 10.1 Daglig

- [ ] `systemctl list-timers 'fsm-*'` viser at backup/check har kjørt.
- [ ] `journalctl -u fsm-backup.service -n 50` er uten feil.
- [ ] `./scripts/backup-freshness.sh --require-remote` gir exit 0.
- [ ] `jq '{completedAt,stamp,encrypted,remote,databaseBytes,uploadsBytes}' "$BACKUP_STATUS_FILE"` viser fersk tid og `encrypted: true`.
- [ ] Ekstern kopi finnes, og `fsm_backup_remote_ok` er 1.
- [ ] `df -h` og `FsmDiskLow` er OK.
- [ ] Ingen uleste kritiske varsler.

### 10.2 Ukentlig

- [ ] `fsm-restore-test.timer` har kjørt, og `restore-test.service` er grønn.
- [ ] `journalctl -u fsm-restore-test.service` viser brukere, kunder,
      migrasjoner og opplastingsfiler.
- [ ] Sjekk at database- og opplastingsstamp er like.
- [ ] Se over backupstørrelse og vekst; varsle om unormal endring.
- [ ] Kontroller at `RETENTION_DAYS` og ekstern livssyklus ikke sletter for
      tidlig.
- [ ] Kontroller at `monitoring/backup-status.json` er lesbar for appen.

### 10.3 Månedlig

- [ ] Test varslingskanalen med `ops-alert.sh --test`.
- [ ] Test `fsm-alert@fsm-backup.service` manuelt.
- [ ] Verifiser at minst én offline age-nøkkel kan dekryptere en testbackup.
- [ ] Gjennomgå tilgang til `BACKUP_DIR`, rclone/Blob og Key Vault.
- [ ] Se over Azure PITR-retention og Azure Backup-policy.
- [ ] Kontroller at ingen ukrypterte backupfiler ligger utenfor `BACKUP_DIR`.
- [ ] Roter/oppdater hemmeligheter etter behov.

### 10.4 Kvartalsvis

- [ ] Full restore-øvelse på isolert vert, med database + opplastinger + app.
- [ ] PITR-øvelse med `deploy/postgres/pitr/restore-pitr.sh` mot et nytt
      katalog; mål RTO og kontroller at WAL-arkivet er kopiert offsite.
- [ ] Kontroller at S3-bucket har versjonering og at en slettet fil kan
      gjenopprettes (eller at bucket-backup finnes).
- [ ] Prøv både nyeste og en eldre backup innenfor retention.
- [ ] Mål RTO og oppdater [§3](#3-rpo-og-rto).
- [ ] Test gjenoppretting **uten** den opprinnelige serveren (bare offline
      nøkkel og ekstern backup).
- [ ] Test sletting/immutability/legal hold i Blob.
- [ ] Gjennomgå access-lister og RBAC.
- [ ] Oppdater denne runbooken med erfaringer og kommandoer som faktisk virket.
- [ ] Bekreft at `docs/AZURE.md`, image-tags og prosedyrer fortsatt stemmer.

### 10.5 Incident command – gjenoppretting

- [ ] Erklær hendelse, velg incident lead og kommunikasjonskanal.
- [ ] Varsle dataeier, ev. personvernansvarlig og sikkerhet.
- [ ] Stopp skriving; ikke stopp Postgres uten plan.
- [ ] Sikre nåværende tilstand (ny backup/kopi) før noe overskrives.
- [ ] Velg recovery point; kontroller stamp, sjekksum og dekryptering.
- [ ] Bekreft mål (vert, DB, volum) med en annen person.
- [ ] Gjenopprett til nytt mål; ikke overskriv produksjon før verifisert.
- [ ] Verifiser `/api/ready`, tellinger, vedlegg, PDF, revisjonslogg.
- [ ] Cutover; overvåk i minst 30–60 minutter.
- [ ] Ta ny backup etter vellykket restore.
- [ ] Behold gammel tilstand til ny backup er verifisert.
- [ ] Skriv hendelsesrapport: tidslinje, rotårsak, data tap, RTO, tiltak.
- [ ] Roter hemmeligheter hvis kompromittering ikke kan utelukkes.
- [ ] Oppdater runbook og øvelsesplan.

---

## 11. English summary

**Scope.** The backup covers the PostgreSQL database (`fsm_postgres_data` or an
external/Azure PostgreSQL server) and the uploads volume (`fsm_uploads`,
mounted at `/app/uploads`). With `STORAGE_DRIVER=s3`, uploads live in the bucket
and are protected by bucket versioning/replication instead of `backup.sh`. It does **not** cover `.env`/secrets, the private
age identity, the app image, proxy/DNS configuration, `.next` cache, `/tmp`,
container logs, or monitoring data. Store `.env` in a secret manager and keep at
least two offline copies of the age identity.

**Repo backup design.** `scripts/backup.sh` runs a plain-SQL `pg_dump` through
`gzip` and optional `age` encryption, tars the uploads volume through the same
encryption, writes SHA-256 checksums, optionally copies to an rclone remote and
verifies with `rclone check`, then atomically writes `backup-status.json` and
applies local retention (`RETENTION_DAYS`, default 30). Production fails closed
without `BACKUP_AGE_RECIPIENT`. The script does not read `.env`; set
`COMPOSE_FILE=docker-compose.prod.yml`, `POSTGRES_USER`, `POSTGRES_DB`,
`UPLOADS_VOLUME` and the `BACKUP_*` variables explicitly.

**Schedule and monitoring.** systemd timers run the backup daily at 03:17, a
freshness/checksum check at 06:10, and a restore test on Sundays at 04:30. Each
unit uses `OnFailure=fsm-alert@%n.service` and `scripts/ops-alert.sh`. Metrics
are `fsm_backup_present`, `fsm_backup_age_seconds`, `fsm_backup_fresh`,
`fsm_backup_checksum_ok` and `fsm_backup_remote_ok`; alert names include
`FsmBackupStale` and `FsmBackupAgeHigh`.

**Targets.** Recommended RPO is ≤24 hours with daily local backups, ≤1 hour
with PostgreSQL PITR (typically a few minutes for Azure Flexible Server),
and RTO ≤2 hours for a full restore. Measure the real RTO in quarterly drills;
database size, uploads volume, bandwidth, key availability and DNS all affect
it.

**Restore.** Verify checksums and decryption first, stop the app, restore the
database into a new database with `psql -v ON_ERROR_STOP=1`, restore uploads
from the same timestamp, verify counts and `/api/ready`, then switch traffic.
`backup.sh` produces **plain SQL**, so use `psql`, not `pg_restore`; use
`pg_restore` only for custom-format `pg_dump -Fc` files. For a full disaster,
provision a new host/volumes, restore `.env` and the age key from secure storage,
restore DB and uploads, start the app, then cut over DNS/Caddy.

**Azure.** Flexible Server automated backups provide PITR for 7–35 days and
restore to a **new** server; geo-restore requires geo-redundant backup enabled
at creation. Azure Backup provides policy-based long-term retention (up to 10
years, subject to policy/region). Azure VM backup covers the whole VM but is not
a substitute for a consistent `pg_dump`. Blob versioning, soft delete and
immutability protect offsite copies. Use managed identity for Blob and Key Vault
for the age identity, but keep an offline key copy. Azure-native database
backup does **not** include the uploads volume.

**Validation.** The repo scripts, paths and variable names in this document were
checked against the 0.9.5 source. Azure CLI/portal steps are examples and must
be verified in the target subscription; they were not executed here.

---

*Sist oppdatert: 2026-11-07. Oppdater denne runbooken etter hver øvelse og hver
endring i backupoppsettet.*
