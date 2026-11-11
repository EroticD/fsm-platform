# Revisjonslogg: hash-kjede, retensjon, bevaringsplikt og eksport

Dette dokumentet beskriver DATA-02 og DATA-03. Det erstatter ikke
`docs/OPERATIONS.md` (drift av database, backup og proxy), men supplerer den
med reglene som gjelder selve revisjonsloggen.

## Datamodell

`AuditLog` har fått:

- `seq` – monoton rekkefølge fra databasen. Hash-kjeden følger `seq`, ikke
  `createdAt`, slik at to hendelser i samme millisekund får en entydig orden.
- `departmentId` – avdelingen hendelsen skjedde i. Administrator ser alle
  logger; andre med `audit.view` ser bare egen avdeling. Eldre rader uten
  avdeling vises bare for administrator.
- `prevHash` og `hash` – SHA-256-kjeden. `hash` er SHA-256 av en kanonisk
  beskrivelse av raden og `prevHash`.

I tillegg finnes:

- `AuditRetentionSetting` – én rad (`id = 'default'`) med `retentionDays`.
  `0` slår automatisk purring av. Standard er 365 dager.
- `AuditHold` – bevaringsplikt på én logg (`auditLogId`) eller en hel entitet
  (`entityType` + `entityId`). Holdet er en egen rad fordi selve revisjonsraden
  aldri skal endres.
- `AuditPurgedHash` – tombstone for hver hash retensjonsjobben fjerner. Uten
  disse ville neste rad sett ut som et kjede brudd.

## Migrering og backfill

1. Ta backup.
2. Kjør migreringen med migrasjonsrollen:

   ```bash
   DATABASE_MIGRATION_URL=... npx prisma migrate deploy
   ```

3. Backfyll hash-kjeden med en rolle som har `UPDATE` på `"AuditLog"`
   (migrasjons- eller vedlikeholdsrollen). Stopp appens skriving til
   revisjonsloggen mens dette gjøres – migreringen legger til kolonnene, men
   appen kan ikke skrive en gyldig `prevHash` før backfillen er ferdig:

   ```bash
   DATABASE_MIGRATION_URL=... npm run audit:backfill
   ```

Backfillen leser radene i `seq`-rekkefølge og skriver `prevHash`/`hash` for
rader som mangler hash. Den er idempotent, og avbryter uten å skrive mer dersom
en eksisterende hash ikke stemmer med innholdet. Kjør den én gang etter
migreringen; nye rader får hash i skriveveien.

Verifiser hele kjeden med:

```bash
DATABASE_URL=... npm run audit:verify
```

Skriptet godtar tombstones fra retensjonen som kontrollerte hull, og gir
exit-kode 1 ved manglende hash eller manipulert innhold.

### Når kjeden er forgrenet

En rad som skrives utenom `audit()` får ingen hash, og radene etter den kan ha
kjedet seg til feil hale. Da hjelper ikke vanlig backfill: den avbryter på
`prev_hash_mismatch`. Regn hele kjeden på nytt:

```bash
DATABASE_MIGRATION_URL=... npm run audit:backfill -- --rebuild
```

`--rebuild` skriver nye `prevHash`/`hash` for alle rader i `seq`-rekkefølge.
Eksporterte bevis som er tatt før ombygging må tas på nytt, fordi hash-verdiene
endres. Ta backup først. Kilden til forgreningen må være lukket (se
`src/lib/audit-write-paths.test.ts`), ellers gjentar den seg.

## Skriveveien

`src/lib/audit.ts` tar en PostgreSQL-transaksjonslås
(`pg_advisory_xact_lock`) før den leser forrige hash. Låsen gjør at samtidige
transaksjoner ikke kan forgrene kjeden. Hash og revisjonsrad skrives i samme
transaksjon som mutasjonen, så en rullet tilbake endring gir ingen logg.

Rader som ikke har en forretningsmutasjon å henge på – innlogging, utlogging,
avviste kall, filnedlasting – skrives med `auditStandalone()`, som bruker egen
transaksjon og samme lås. Testen `src/lib/audit-write-paths.test.ts` feiler
dersom noen skriver `auditLog` direkte utenom `audit.ts`.

## Retensjon og bevaringsplikt

Retensjonsjobben ligger i `src/server/audit-retention.ts` og starter fra
jobbarbeideren (`startAuditRetentionCleanup`, én kjøring ved oppstart og deretter
hvert døgn). Den:

1. leser `AuditRetentionSetting` (eller `AUDIT_RETENTION_DAYS` som fallback),
2. finner logger eldre enn fristen,
3. hopper over logger med aktivt `AuditHold`, og logger for oppdrag/rapporter
   med `legalHold = true`,
4. skriver tombstones og sletter radene i samme transaksjon,
5. skriver selve purringen til revisjonsloggen.

Purringen krever `DELETE` på `"AuditLog"`. Når runtime-rollen er låst, må den
kjøres med vedlikeholdsrollen. Sett `AUDIT_RETENTION_DATABASE_URL` til en slik
rolle; uten variabelen brukes `DATABASE_URL`. Jobben feiler trygt (logger) hvis
rollen mangler rettighet, og sletter ingenting.

### Retensjonsklasser

`AuditLog.retentionClass` lar strengere krav overstyre den globale fristen:

| Klasse | Frist | Brukes til |
| --- | --- | --- |
| `ACCOUNTING_5Y` | 5 år | faktura, betaling, kreditnota, avtale |
| `SECURITY_1Y` | 1 år | innlogging, 2FA, tilgangs- og rettighetsendringer |
| `OPS_90D` | 90 dager | jobber, opprydding, drift |
| `null` | Global `AUDIT_RETENTION_DAYS` | alt annet |

Den globale verdien er et gulv: en klasse kan bare forlenge oppbevaringen, ikke
forkorte den. Regnskapsmateriale skal ifølge bokføringsloven § 13 bevares i fem
år, uavhengig av hva den globale innstillingen sier.

## Anbefalt databaseoppdeling

Behold `fsm_app` som runtime-rolle, men fjern mutasjonsretten på historikken:

```sql
-- Runtime skal bare kunne legge til revisjonslogger, ikke endre eller slette.
REVOKE UPDATE, DELETE ON TABLE "AuditLog" FROM fsm_app;
REVOKE UPDATE, DELETE ON TABLE "AuditPurgedHash" FROM fsm_app;
REVOKE UPDATE, DELETE ON TABLE "AuditHold" FROM fsm_app;
GRANT INSERT ON TABLE "AuditLog" TO fsm_app;

-- Hold og retensjonsinnstillinger administreres av appen.
GRANT SELECT, INSERT, UPDATE ON TABLE "AuditHold", "AuditRetentionSetting" TO fsm_app;
-- Runtime skal bare lese tombstones; de skrives av vedlikeholdsjobben.
GRANT SELECT ON TABLE "AuditPurgedHash" TO fsm_app;

-- Vedlikeholdsrollen brukes av backfill og retensjonsjobben.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "AuditLog", "AuditHold", "AuditPurgedHash", "AuditRetentionSetting"
  TO fsm_migrator;
```

Tilpass rollenavnene til installasjonen. `AuditHold` må kunne oppdateres fordi
oppheving setter `releasedAt`; selve `AuditLog` skal aldri oppdateres etter
backfill. Hvis man vil være strengere, kan `AuditHold`-oppheving flyttes til en
egen vedlikeholdsrolle, men da må UI-handlingen kjøre der.

Merk at `AuditLog.seq` bruker en sekvens. Runtime-rollen trenger
`USAGE, SELECT` på sekvensen for å kunne sette inn nye logger; dette følger
vanligvis med standardprivilegiene.

## Eksport

### Revisjonslogg (DATA-02)

`GET /api/innstillinger/audit/eksport` er bare for administrator. Ruten lager
et ZIP-arkiv med:

- `audit.jsonl` – kanoniske rader med `prevHash` og `hash`,
- `purge-tombstones.jsonl` – kontrollerte hull,
- `manifest.json` – SHA-256 for hver fil og kjedehode,
- `manifest.sha256` – SHA-256 av manifestet,
- `manifest.sig` – HMAC-SHA256 når `AUDIT_EXPORT_SIGNING_KEY` er satt.

Eksporten verifiserer kjeden før den bygges, og hendelsen logges etterpå slik at
eksporten ikke refererer til seg selv.

### Bevispakke for ett oppdrag (DATA-03)

`GET /api/innstillinger/bevis/export?oppdrag=<id>` er bare for administrator.
Pakken inneholder oppdrag, kunde, rapporter, revisjoner, vedlegg/signaturer,
relevante revisjonslogger og manifest. Filene leses gjennom samme
`Upload`-metadata og opplastingsmappe som `/uploads`, med banesjekk. En
manglende fil stopper ikke pakken; den føres opp i `manifest.json` med årsak.

Verifisering offline:

```bash
unzip -o bevis-....zip -d bevis
cd bevis
sha256sum -c manifest.sha256
# Sammenlign hver path/sha256 i manifest.json med sha256sum <path>
```

Endres én fil, feiler `sha256sum`/sammenligningen. `verifyEvidenceArchive` og
`verifyAuditArchive` gjør samme kontroll i koden, inkludert hver enkelt
revisjonsrads hash.

## Signeringsnøkkel

`AUDIT_EXPORT_SIGNING_KEY` er valgfri, men anbefalt. Den må være minst 16 tegn
og skal behandles som en hemmelighet. Nøkkelen ligger aldri i arkivet. Uten
nøkkel er pakken fortsatt forseglet med SHA-256-manifestet, men uten
HMAC-signatur.

## Tester

- `src/lib/audit-chain.test.ts` – hash, manipulering, hull og backfill.
- `src/server/audit-retention.test.ts` – grenser, hold, tombstone og purring.
- `src/server/audit-export.test.ts` – eksport og verifisering.
- `src/server/evidence-export.test.ts` – komplett oppdrag, manglende fil,
  utrygg bane og endret fil.
- `src/server/integration/audit-chain.integration.test.ts` – ekte migrering og
  database når `TEST_DATABASE_URL` er satt.
