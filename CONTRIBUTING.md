# Bidra

Takk for at du vil bidra til FSM-plattformen. Prosjektet er kildeåpent under
[Business Source License 1.1](LICENSE), og bidrag er velkomne.

## Kom i gang

Forutsetninger: Node.js 22+, Docker og npm.

```bash
git clone <repo-url> fsm-platform
cd fsm-platform
npm install
cp .env.example .env      # fyll inn DATABASE_URL og NEXTAUTH_SECRET
docker compose up -d postgres
npx prisma migrate deploy
npm run seed              # valgfritt: oppretter en administrator
npm run dev
```

Appen svarer på <http://localhost:3000>. OCR krever `poppler-utils` lokalt
(`pdftotext`/`pdftoppm`); i Docker-imaget er det installert.

## Før du sender en pull request

Kjør alt lokalt og få det grønt:

```bash
npm run typecheck        # next typegen + tsc --noEmit
npm test                 # vitest (enhetstester)
npm run test:coverage    # enhetstester + dekningskrav (CI bruker denne)
npm run test:integration # mot en dedikert Postgres-testdatabase
npm run test:e2e         # Playwright + axe (krever `npx playwright install chromium`)
npm run test:lighthouse  # Lighthouse mobil a11y (krever kjørende app; >=95)
npm run lint             # eslint
npm run build            # produksjonsbygg
```

Integrasjonstestene hoppes over med mindre `TEST_DATABASE_URL` er satt (eller
`CI=true`). Lag en egen database og kjør migrasjonene først:

```bash
createdb fsm_integration
DATABASE_URL=postgresql://.../fsm_integration npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://.../fsm_integration npm run test:integration
```

CI kjører de samme stegene, i tillegg til Docker-bygg og en sjekk for at
migrasjonene gir samme skjema som `prisma/schema.prisma`.

## Retningslinjer

- **Norsk i brukergrensesnittet.** Nye knapper, feilmeldinger og hjelpetekster
  skrives på norsk, og følger tonen i resten av appen.
- **Forretningslogikk i tjenestelaget.** Mutasjoner og gjenbrukbare spørringer
  ligger i `src/server/*` (work-orders, reports, customers, documents, users,
  settings). Server actions i `src/app/**/actions.ts` er tynne wrappers som
  leser `FormData`, kaller tjenesten og oversetter resultatet til redirect,
  revalidering eller en feilkode. Ikke legg domenelogikk i sidekomponentene.
- **Autoriser på nytt i hver handling.** Skjul ikke bare knappen i UI-en –
  sjekk rolle, `isActive`, avdeling/kunde og eierskap på serveren. Tjenestene
  tar en eksplisitt aktør, slik at autorisasjonen kan testes uten nettleser.
- **Valider ved inputgrensen.** Bruk zod-skjemaene i `src/lib/schemas/*` for
  id-er, datoer, Markdown og andre felt. Returner en feilkode i stedet for å
  kaste en ukontrollert feil.
- **Revisjonslogg i samme transaksjon.** En mutasjon og `audit(tx, ...)` skal
  ligge i samme `prisma.$transaction`, med en ekte rad-id som `entityId` (aldri
  en tittel). Da kan ikke en endring committed uten logg.
- **Rens all input på serveren.** Fritekst kan inneholde Markdown, men HTML skal
  aldri tolkes. Bruk hjelperne i `src/lib/sanitize.ts` og `src/lib/markdown.ts`.
- **Ingen ubegrensede listespørringer i sider.** Bruk `take` eller paginering.
  `src/lib/query-limits.test.ts` feiler hvis en ny side glemmer det.
- **Ikke endre eksisterende migrasjoner.** Legg nye endringer i en egen mappe
  under `prisma/migrations/` med `npx prisma migrate dev --name <navn>`.
- **Aldri `prisma db push` i delt kode.** Produksjon og CI kjører
  `prisma migrate deploy`; en skjemaendring uten migrasjon vil mangle i
  produksjon. Verifiser alltid med `npx prisma migrate diff` før du pusher.
- **Legg til tester** for ny logikk som er lett å teste isolert (datoer, rensing,
  autorisasjon, kalenderhendelser). Se `src/lib/*.test.ts`.
- **Ingen hemmeligheter eller persondata** i kode, tester, logger eller
  skjermbilder. Bruk `.env` og syntetiske testdata.

## Lisens på bidrag

Ved å sende inn en pull request godtar du at bidraget lisensieres under
Business Source License 1.1 på samme vilkår som resten av prosjektet, og at
lisensgiveren kan bruke det videre på samme måte. Du beholder opphavsretten til
ditt eget bidrag.
