# FSM-plattformen

Et feltvennlig service- og vedlikeholdssystem (FSM) bygget med Next.js, Prisma og
PostgreSQL. Plattformen dekker flyten fra oppdraget planlegges til den signerte
servicerapporten kan vises eller lastes ned som PDF.

## Hva systemet gjør

- **Oppdrag og kalender** – planlegg, fordel og følg opp serviceoppdrag i liste,
  tavle, kalender, dispatch og ruteplan, med avdelingssperre og montørtildeling.
- **Servicerapporter** – sjekklister per enhet, kommentarer, bilder og signaturer,
  og ferdig PDF som kan vises i appen eller lastes ned.
- **Enheter og servicehistorikk** – hver kunde har oversikt over utstyret sitt, og
  hver enhet viser tidligere servicer med resultat, kommentarer og bilder.
  Enheter kan flyttes til en annen kunde med hele servicehistorikken.
- **Kunder og kundeportal** – kundekort med kontakter, avtaler, steder og egne
  portalbrukere som bare ser sin egen bedrift.
- **Tilbud** – tilbud med linjer, versjoner og konvertering til oppdrag.
- **Fakturering og betaling** – fakturaer, kreditnota, CSV og betalingslenke.
- **Lager og reservedeler** – beholdning, reservasjon, forbruk og innkjøpsordrer.
- **Kjøring og utlegg** – utlegg per oppdrag med godkjenning og lønnsgrunnlag.
- **Lønnsomhet** – estimert og faktisk inntekt per avdeling, kunde og montør.
- **Regnskap** – synk av fakturaer til Fiken, Tripletex og PowerOffice Go.
- **Kart, sporing og ETA** – kart, posisjonssporing og beregnet ankomsttid.
- **Omtaler** – offentlig omtaleside og aggregat på dashbordet.
- **Avdelinger, roller og rettigheter** – oppdrag og avtaler tilhører en avdeling,
  og administrator kan lage roller og tilpasse rettigheter og felt.
- **Serviceavtaler, SLA og bookinger** – gjentagende service, frister og
  bookingkø med bekreftelse og varsling.
- **SMS, kontorinnboks og påminnelser** – toveis SMS med samtykke, samtaler i
  kontorinnboksen og automatiske SMS-/e-postpåminnelser før besøk.
- **E-post og push** – transaksjons-e-post og pushvarsler fra en varig utboks.
- **Dokumentbibliotek, OCR, tags og globalt søk** – PDF-er med mapper, tags,
  versjonering og fulltekstsøk.
- **SSO, SCIM og sikkerhet** – OIDC mot Entra ID, Keycloak, Authentik og Zitadel,
  SCIM-brukerprovisjonering, 2FA og revisjonslogg.
- **PWA og feltapp** – installerbar feltapp med offline-kladder, kamera/QR,
  strekkodeskanning, navigasjon og manuell kode når kameraet ikke er tilgjengelig.
- **Moduler** – kapabiliteter slås av og på per installasjon uten å slette data.
- **REST-API** – egne Bearer-nøkler og samme rettighetskontroll som i appen.

## Skjermbilder

| Dashbord | Oppdrag |
| --- | --- |
| ![Dashbord](screenshots/01-dashbord.png) | ![Oppdrag](screenshots/02-oppdrag.png) |

| Kalender | Kunder |
| --- | --- |
| ![Kalender](screenshots/04-kalender.png) | ![Kunder](screenshots/05-kunder.png) |

| Dokumentbibliotek | Kundeportal |
| --- | --- |
| ![Dokumenter](screenshots/07-dokumenter.png) | ![Kundeportal](screenshots/14-kundeportal.png) |

<details>
<summary>Flere skjermbilder (oppdragsdetaljer, kundekort, rapporter, innstillinger og mobil)</summary>

| | |
| --- | --- |
| ![Oppdragsdetaljer](screenshots/03-oppdrag-detalj.png) | ![Kundekort](screenshots/06-kunde-detalj.png) |
| ![Dokumentmappe](screenshots/08-dokumenter-mappe.png) | ![Rapporter](screenshots/09-rapporter.png) |
| ![Sikkerhet](screenshots/10-innstillinger-sikkerhet.png) | ![Merkevare](screenshots/11-innstillinger-merkevare.png) |
| ![Mobil dashbord](screenshots/12-mobil-dashbord.png) | ![Mobil oppdrag](screenshots/13-mobil-oppdrag.png) |
| ![Kundeportal mobil](screenshots/15-kundeportal-mobil.png) | |

</details>

Alle sidevisninger er også fanget i desktop- og mobilformat under
[`screenshots/pages/`](screenshots/pages/), med rutedekning i `manifest.json`.
`npm run screenshots:verify` kontrollerer at hver `page.tsx` er dekket.

## Hurtigstart med Docker

Dette er anbefalt måte å kjøre produksjon på. Du trenger Docker med Compose v2,
et domenenavn og minst 1 GB RAM og 2 GB swap. Sett opp reverse proxy etterpå – se
[Caddy](#caddy-reverse-proxy).

1. Hent koden og lag miljøfilen:

   ```bash
   git clone <repo-url> fsm-platform
   cd fsm-platform
   cp .env.example .env
   chmod 600 .env
   ```

2. Fyll inn de påkrevde verdiene i `.env`:

   ```dotenv
   POSTGRES_PASSWORD=<langt-tilfeldig-passord>
   NEXTAUTH_SECRET=<openssl rand -base64 32>
   NEXTAUTH_URL=https://fsm.example.com
   APP_URL=https://fsm.example.com

   # Pinn til en publisert versjon, ikke latest.
   APP_IMAGE=ghcr.io/eroticd/fsm-platform:v0.9.3
   POSTGRES_IMAGE=postgres:15.13
   ```

   `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` og `APP_URL` er
   påkrevd i produksjons-Compose. `NEXTAUTH_URL` og `APP_URL` må være `https://`.
   Alle variabler er dokumentert i [`.env.example`](.env.example).

3. Hent imaget og start tjenestene:

   ```bash
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

   Compose starter Postgres, venter til databasen er frisk, og appen kjører
   `prisma migrate deploy` ved oppstart. Første gang kan du opprette administrator
   med `SEED_DATABASE=true` og `SEED_ADMIN_*` mot en tom database; slå den av etterpå.

4. Kontroller at tjenesten er klar:

   ```bash
   docker compose -f docker-compose.prod.yml ps
   curl -fsS http://127.0.0.1:3000/api/health
   curl -fsS http://127.0.0.1:3000/api/ready
   docker compose -f docker-compose.prod.yml logs -f app
   ```

   `/api/health` er liveness, og `/api/ready` sjekker database – og med
   `READY_SECRET`/`CRON_SECRET` også opplastingsvolum og jobbkø. Readiness brukes
   som healthcheck uten restart-loop ved databaseutfall; appen lytter bare på
   `127.0.0.1:3000`.

## Caddy reverse proxy

Appen skal ikke eksponeres direkte. Proxyen terminerer TLS, begrenser
request-body til litt over appens 50 MB-grense og overskriver
videresendingsheadere, så klienten ikke kan spoofe IP eller protokoll.
Klient-IP bak proxyen krever `TRUST_PROXY=true` og riktig `TRUST_PROXY_HOPS`
(antall proxyer, ikke antall `X-Forwarded-For`-oppføringer); ellers er
IP-baserte rate limits inaktive.

Ferdig Caddyfile og nginx-eksempel: [`deploy/proxy/Caddyfile`](deploy/proxy/Caddyfile)
og [`deploy/proxy/README.md`](deploy/proxy/README.md). Body-grense, tidsavbrudd,
klient-IP-sjekk og 502-feilsøking: [`docs/OPERATIONS.md`](docs/OPERATIONS.md#proxy-og-klient-ip).

## Flytte database og data

Databasen ligger i Docker-volumet `fsm_postgres_data` og opplastede filer i
`fsm_uploads`. Begge må sikkerhetskopieres og flyttes fra **samme tidspunkt**;
`.next`-cachen og `/tmp` er `tmpfs` og kan forkastes. Bruk
[`scripts/backup.sh`](scripts/backup.sh), og verifiser backupen med
[`scripts/restore-test.sh`](scripts/restore-test.sh).

Rekkefølge, eierskap på volumene, `pg_dump`/`pg_restore`, verifisering og
rollback er en runbook: [§6 i `docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md#6-gjenoppretting--runbook).
Kjør aldri `docker system prune --volumes` i produksjon; det sletter begge volumene.

## Oppdatere til ny versjon

1. Les [endringsloggen](CHANGELOG.md) og ta en fersk backup. I produksjon kan
   `REQUIRE_BACKUP_BEFORE_MIGRATE=true` kreve det før migrering.
2. Sett `APP_IMAGE` i `.env` til den nye, pinnede taggen og hent imaget med
   `docker compose -f docker-compose.prod.yml pull app`.
3. Kjør migreringene ved å recreate appen
   (`docker compose -f docker-compose.prod.yml up -d --force-recreate app`);
   `prisma migrate deploy` kjøres ved oppstart.
4. Verifiser `/api/health` og `/api/ready`, og gjør en røyktest: logg inn, åpne
   en kunde, last opp en fil og åpne en rapport-PDF.
5. **Rull tilbake** ved feil: sett `APP_IMAGE` tilbake til forrige kjente gode
   tag eller digest, kjør `pull app` og `up -d app`, og verifiser igjen.

Full prosedyre for Compose – også [rollback](docs/OPERATIONS.md#rollback) og
[pinning til digest](docs/OPERATIONS.md#produksjonssett-image-pinning) – står i
[`docs/OPERATIONS.md`](docs/OPERATIONS.md); Azure-oppsettet i [`docs/AZURE.md`](docs/AZURE.md).

## Lokal utvikling

Forutsetninger: Node.js 24+ (26 brukes i produksjon), Docker og npm.

```bash
npm ci
cp .env.example .env      # sett DATABASE_URL og NEXTAUTH_SECRET
docker compose up -d postgres
npm run db:migrate
npm run seed              # valgfritt: oppretter administrator
npm run dev
```

Appen er da på <http://localhost:3000>. For OCR av skannede PDF-er trengs
`poppler-utils` lokalt (`pdftotext`/`pdftoppm`); i Docker-imaget er det
installert med norsk og engelsk språkdata. E2E, skjermbilder og
utviklingsdetaljer står i [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Dokumentasjon

Alle driftsdokumenter ligger i `docs/`; start med
[`OPERATIONS.md`](docs/OPERATIONS.md) og [`BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md).

**Drift**

- [OPERATIONS.md](docs/OPERATIONS.md) – produksjon, miljøfiler, helse, proxy, SSO, feilsøking
- [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) – RPO/RTO, PITR, restore-test, rollback
- [STORAGE.md](docs/STORAGE.md) – lokal disk eller S3/MinIO, nøkler, gjenopptakbar migrering
- [SCALING.md](docs/SCALING.md) – replikaer, Redis-kø/cache, DB-grenser, utrulling
- [AZURE.md](docs/AZURE.md) – VM, Compose, Caddy, Flexible Server, Key Vault, Blob-backup
- [ROUTING.md](docs/ROUTING.md) – ruteleverandører, trafikk-ETA og tidslinjer

**Moduler og integrasjoner**

- [MODULES.md](docs/MODULES.md) – modulkatalog, avhengigheter, presets og hva som skjer når en modul slås av
- [REV.md](docs/REV.md) – tilbud og fakturering (REV-01/REV-02)
- [INVENTORY.md](docs/INVENTORY.md) – lager, reservasjon og innkjøpsordrer
- [PAYROLL_EXPORT.md](docs/PAYROLL_EXPORT.md) – kjøreturer, utlegg og lønnsgrunnlag
- [BI.md](docs/BI.md) – lønnsomhetssiden og rapportbyggeren
- [PAYMENTS.md](docs/PAYMENTS.md) – betalingslenke via PSP (kort og Vipps)
- [ACCOUNTING.md](docs/ACCOUNTING.md) – Fiken, Tripletex, PowerOffice Go og CSV
- [EMAIL.md](docs/EMAIL.md) – transaksjons-e-post og utboks med retry
- [PUSH.md](docs/PUSH.md) – pushvarsler via FCM og APNs
- [API.md](docs/API.md) – REST-API med eksempler; OpenAPI på `/api/v1/openapi.json`

**Utvikling og testing**

- [CONTRIBUTING.md](CONTRIBUTING.md) – oppsett, tester og pull requests
- [TESTING.md](docs/TESTING.md) – Vitest-nivåer, Playwright og testdata
- [DESIGN.md](docs/DESIGN.md) – designsystem, farger og komponentregler
- [AGENTS.md](AGENTS.md) – agentinstrukser for kodearbeid ([CLAUDE.md](CLAUDE.md) er lik)

**Sikkerhet og compliance**

- [SECURITY.md](SECURITY.md) – sikkerhetsmodell og rapportering
- [RBAC.md](docs/RBAC.md) – feltnivå-RBAC for sensitive data
- [audit-retention.md](docs/audit-retention.md) – hash-kjede, retensjon og eksport av revisjonslogg
- [privacy-erasure.md](docs/privacy-erasure.md) – GDPR-sletting og anonymisering av kundedata
- [security-audit-2026-10-29.md](docs/security-audit-2026-10-29.md) – statisk sikkerhetsrevisjon (v0.7.5)
- [compliance/README.md](docs/compliance/README.md) – ISO/IEC 27001:2022 og SOC 2: omfang og leseveiledning
- [ISO27001-SOA.md](docs/compliance/ISO27001-SOA.md) – Statement of Applicability for alle 93 kontroller
- [SOC2-TSC-MAPPING.md](docs/compliance/SOC2-TSC-MAPPING.md) – TSC-kriterier mot kontroller og bevis
- [RISK-REGISTER.md](docs/compliance/RISK-REGISTER.md) – risiko med eiere og tiltak
- [ASSET-REGISTER.md](docs/compliance/ASSET-REGISTER.md) – eiendeler og eiere
- [DATA-CLASSIFICATION-RETENTION.md](docs/compliance/DATA-CLASSIFICATION-RETENTION.md) – dataklasser og lagringstid
- [GAP-ANALYSIS.md](docs/compliance/GAP-ANALYSIS.md) – gjenstående arbeid før revisjon
- [EVIDENCE-CHECKLIST.md](docs/compliance/EVIDENCE-CHECKLIST.md) – bevis og innsamling
- [compliance/policies/](docs/compliance/policies/) – 19 policyer; [templates/](docs/compliance/templates/) – 7 maler og logger

**Analyse og beslutninger**

- [PLATFORM-ANALYSIS.md](docs/PLATFORM-ANALYSIS.md) – plattformen sammenlignet med markedet
- [DECISIONS.md](docs/DECISIONS.md) – valg, avgrensninger og hva som er utsatt
- [BACKLOG.md](docs/BACKLOG.md) – den eneste køen for gjenstående arbeid

**Brukermanual**

- [Norsk brukermanual (PDF)](docs/manual/FSM-brukermanual-nb.pdf) – kontor, tekniker, administrator
- [English user manual (PDF)](docs/manual/FSM-user-manual-en.pdf) – samme inndeling
- [manual/README.md](docs/manual/README.md) – Markdown-kilder og `npm run manual:build`

## Sikkerhet

- Passord hashes med bcrypt, og innlogging, opplasting, søk og kommentarer har
  hastighetsbegrensning.
- All autorisasjon sjekkes på serveren; oppdrag er avdelingssperret, og
  kundeportalbrukere ser bare egen kundedata.
- Opplastede filer har tilgangskontroll per fil, og økter ugyldiggjøres når
  passord, rolle, rettigheter eller 2FA endres.
- 2FA (TOTP) kan kreves for utvalgte roller. Signerte rapporter fryses med et
  øyeblikksbilde, og PDF-er saneres før de vises i appen.
- Skjemafelt renses på serveren, og responsene får sikkerhetsheadere. Se
  [`SECURITY.md`](SECURITY.md) for rapportering.

## Lisens

Programmet er tilgjengelig under **Business Source License 1.1 (BSL 1.1)** – en
kildeåpen lisens, ikke en OSI-godkjent åpen kildekodelisens. Uten en ekstra
bruksrett krever all produksjonsbruk en egen kommersiell avtale med
lisensgiveren. Fra endringsdatoen 2030-10-19 gjelder Apache License 2.0 for den
aktuelle versjonen. Se [LICENSE](LICENSE) for den fullstendige teksten.
