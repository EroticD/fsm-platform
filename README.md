# FSM-plattformen

Et feltvennlig service- og vedlikeholdssystem (FSM) bygget med Next.js, Prisma og
PostgreSQL. Plattformen dekker hele flyten fra oppdraget planlegges til den
signerte servicerapporten kan lastes ned som PDF.

## Hva systemet gjør

- **Oppdrag og kalender** – planlegg, fordel og følg opp serviceoppdrag i måneds-,
  ukes- og dispatcher-visning, med avdelingssperre og tildeling av montører.
- **Servicerapporter** – sjekklister per enhet, kommentarer per sjekkpunkt,
  bilder og signaturer tegnet på skjermen, og ferdig PDF med firmaets logo.
- **Enheter og servicehistorikk** – hver kunde har oversikt over utstyret sitt,
  og hver enhet viser alle tidligere servicer med resultat, kommentarer og bilder.
- **Kunder og kundeportal** – kundekort med kontakter, kundeverlegg, avtaler og
  egne portalbrukere som bare ser sin egen bedrift. Kunder kan knyttes til en
  avdeling og en ansvarlig montør, og nye bestillinger varsler kontoret.
- **Avdelinger, roller og rettigheter** – oppdrag og serviceavtaler tilhører en
  avdeling, ansatte ser bare egen avdeling, og administrator kan opprette roller
  og tilpasse rettigheter per bruker.
- **Gjentagende serviceavtaler** – avtaler med intervall på 3, 6, 12 eller 24
  måneder; neste oppdrag opprettes automatisk med kundedata, ny sjekkliste og
  forrige rapport som vedlegg.
- **Dokumentbibliotek, OCR, tags og globalt søk** – PDF-er med mapper, tags og
  versjonering; innholdet indekseres (OCR for skannede filer), og fuzzy-søket
  lenker direkte til riktig side i PDF-en.
- **PWA, 2FA og Markdown** – installerbar feltapp med offline-side, to-trinns
  verifisering (TOTP) for alle innloggede, og Markdown i fritekst som vises likt
  på nettsiden og i PDF-en.

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

## Kom i gang lokalt

Forutsetninger: Node.js 22+, Docker og npm.

For OCR av skannede PDF-er trengs `poppler-utils` lokalt (`pdftotext`/`pdftoppm`);
i Docker-imaget er det allerede installert med norsk og engelsk språkdata.

```bash
git clone <repo-url> fsm-platform
cd fsm-platform
npm install
cp .env.example .env      # fyll inn DATABASE_URL og NEXTAUTH_SECRET
docker compose up -d postgres
npm run db:migrate        # oppretter tabellene
npm run seed              # valgfritt: oppretter en administrator
npm run dev
```

Appen er da tilgjengelig på <http://localhost:3000>. Alle miljøvariabler er
dokumentert i [`.env.example`](.env.example).

## Kjøre med Docker

`docker-compose.yml` setter opp appen og databasen, og appen kjører
migrasjonene ved oppstart.

```bash
cp .env.example .env
docker compose up -d --build
```

- Appen svarer på <http://localhost:3000> og har helsesjekk på `/api/health`.
- Opplastede filer ligger på et eget volum og overlever nytt bygg.
- Databasen eksponeres bare på `127.0.0.1`.
- I produksjon bør appen stå bak en reverse proxy med TLS; se
  [SECURITY.md](SECURITY.md).

## E2E og skjermbilder

E2E-testene og skjermbildene kjører mot en egen, isolert database
(`fsm_ui_e2e`) med fire fiktive demo-kontoer. All data der er syntetisk, og
seed-skriptet rører aldri utviklings- eller produksjonsdatabasen.

```bash
# 1. Opprett den isolerte databasen og kjør migrasjonene mot den.
createdb fsm_ui_e2e
DATABASE_URL=postgresql://admin:bytt-meg@localhost:5432/fsm_ui_e2e?schema=public \
  npx prisma migrate deploy

# 2. Last E2E-variablene og opprett de fiktive kontoene og demodataene.
cp .env.e2e.example .env.e2e.local   # fyll inn riktig DATABASE_URL
set -a && . ./.env.e2e.local && set +a
npm run seed:e2e

# 3. Start appen på port 3100.
npm run dev -- -p 3100

# 4. I en ny terminal: kjør Playwright med rollekontoene.
set -a && . ./.env.e2e.local && set +a
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e

# 5. Med appen kjørende: ta skjermbildene til screenshots/.
npm run screenshots
```

Rolle-testene bruker `E2E_ADMIN_*`, `E2E_OFFICE_*`, `E2E_TECHNICIAN_*` og
`E2E_CUSTOMER_*`. Uten dem hoppes de over; med `.env.e2e.local` lastet kjører
hele matrisen. Kontoene er `admin@example.test`, `kontor@example.test`,
`montor@example.test` og `kunde@example.test` – alle med passord som står i
[`.env.e2e.example`](.env.e2e.example).

## Teknisk oppbygning

- **Next.js 16** (App Router, React 19) med server components.
- **Prisma 7** mot PostgreSQL via `@prisma/adapter-pg`; skjemaet ligger i
  `prisma/schema.prisma` og migrasjonene i `prisma/migrations/`.
- **NextAuth** med kodeord, invitasjonslenker og to-trinns verifisering.
- **@react-pdf/renderer** for servicerapporter og **Tailwind CSS 4** for
  grensesnittet.
- **Markdown** (Obsidian + GFM) med felles visning på nett og i PDF; all input
  renses i `src/lib/sanitize.ts`.

## REST API

FSM-plattformen har et eget REST-API for oppdrag, kunder, rapporter og
dokumenter. API-et bruker Bearer-nøkler (`fsm_...`) og er helt atskilt fra
nettleserøkten. Administrator oppretter og tilbakekaller nøkler under
**Innstillinger → API-nøkler**; nøkkelen vises bare én gang.

- Full dokumentasjon med eksempler: [docs/API.md](docs/API.md)
- Maskinlesbar OpenAPI 3.1-kontrakt: `/api/v1/openapi.json`
- Grense: 120 forespørsler per minutt per nøkkel

## Sikkerhet

- Passord hashes med bcrypt, og innlogging, opplasting, søk og kommentarer har
  hastighetsbegrensning.
- All autorisasjon sjekkes på serveren; oppdrag er avdelingssperret, og
  kundeportalbrukere ser bare egen kundedata.
- Opplastede filer har tilgangskontroll per fil (oppdrag, kunde, dokument eller
  privat), og økter ugyldiggjøres når passord, rolle, rettigheter eller 2FA
  endres.
- To-trinns verifisering (TOTP) kan slås på per bruker, og signerte rapporter
  fryses med et øyeblikksbilde av malen slik at de ikke kan endres i ettertid.
- Skjemafelt renses på serveren, og responsene får sikkerhetsheadere. Se
  [SECURITY.md](SECURITY.md) for rapportering.

## Drift

- `/api/health` er liveness, og `/api/ready` sjekker database, opplastingsvolum
  og jobbkø. Produksjons-Compose bruker readiness som healthcheck uten å
  restart-loope ved databaseutfall.
- Produksjon bruker `docker-compose.prod.yml` med `APP_IMAGE` pinnet til en
  publisert versjon (ikke `latest`) og Postgres pinnet til en 15.x-minor.
- Migrasjoner kjøres ved oppstart med `prisma migrate deploy`.
- `SEED_DATABASE` er av som standard; seed bare en tom database eksplisitt.
- Backup, restore-test, logging og skalering er dokumentert i
  [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Bidra

Se [CONTRIBUTING.md](CONTRIBUTING.md) for oppsett, retningslinjer og hva som må
være grønt før en pull request.

## Lisens

Programmet er tilgjengelig under **Business Source License 1.1 (BSL 1.1)** – en
kildeåpen lisens, ikke en OSI-godkjent åpen kildekodelisens. Uten en ekstra
bruksrett krever all produksjonsbruk en egen kommersiell avtale med
lisensgiveren. Fra endringsdatoen 2030-10-19 gjelder Apache License 2.0 for den
aktuelle versjonen. Se [LICENSE](LICENSE) for den fullstendige teksten.
