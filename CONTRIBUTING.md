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

E2E-testene for de fire rollene krever `E2E_ADMIN_EMAIL/PASSWORD`,
`E2E_OFFICE_EMAIL/PASSWORD`, `E2E_TECHNICIAN_EMAIL/PASSWORD` og
`E2E_CUSTOMER_EMAIL/PASSWORD`. Kopier [`.env.e2e.example`](.env.e2e.example) til
`.env.e2e.local`, opprett den isolerte databasen `fsm_ui_e2e`, kjør
migrasjonene mot den og deretter `npm run seed:e2e`. Skriptet er destruktivt
bare for demodataene i E2E-databasen og skal **aldri** kjøres mot produksjon.
Se «E2E og skjermbilder» i [README.md](README.md) for hele flyten.

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

## Terminologi og oversettelser

UI-teksten er norsk som standard. Engelsk er en fullverdig oversettelse, men
norske fagbegreper skal ikke «oversettes» til noe annet i den norske kilden.

| Norsk | Engelsk | Betydning |
| --- | --- | --- |
| oppdrag | work order | Selve entiteten (ikke «jobb» eller «sak» i UI) |
| montør | technician | Intern person/ansatt som utfører oppdrag |
| tekniker | technician (external) | Ekstern person hos kunde/leverandør; ikke det samme som montør |
| kundens ordrenummer | customer order number | Kundenes egen referanse, lagret i `orderNumber` |

Unntak: **HMS** og **SJA** beholdes som norske forkortelser i begge språk
(engelsk UI bruker «HSE»/«SJA» der det er etablert). HMS-malene er i tillegg
seed-data i databasen og redigeres som maler i appen; selve malinnholdet er
derfor norsk uavhengig av grensesnittspråket.

Når du legger til tekst:

- Legg nøkler i `messages/nb.json`, `messages/en.json` eller riktig fragment.
  `pl` og `de` er fullstendige kataloger i `messages/pl.json` og
  `messages/de.json`; nye nøkler skal legges i **alle fire** kataloger i samme
  commit. `npm run check:i18n:strict` feiler ved manglende paritet.
- Metadata: bruk `getTranslations("common")` og `metadata.*`-nøklene, ikke
  hardkodede titler i `layout.tsx` eller `page.tsx`.
- Revisjonsloggen lagrer stabile norske handlingsstrenger. Nye handlinger skal
  legges inn i mønsteroversettelsen i `src/lib/audit-actions.ts` og få nb/en-
  tekster under `auditActions.*`. Lagrede rader skal aldri skrives om.
- API-feil skal bruke en stabil kode fra `src/lib/api-errors.ts`, ikke
  prosa. Offentlige `/api/v1`-svar har `{ error: { code, message, messageKey,
  details? } }`; interne ruter bruker `internalApiError` og klienten oversetter
  `messageKey`.
- PDF-etiketter skal ligge i `src/lib/pdf-labels.ts` (locale-nøklet, norsk
  standard), ikke i `ReportDocument.tsx`.
- Valideringsfeil fra zod skal være stabile koder/nøkler (for eksempel
  `orders.errors.endBeforeStart`), ikke ferdige setninger. Oversett ved
  visning.
- `node scripts/check-i18n.mjs --strict` feiler også på hardkodede norske
  strenger og ubrukte nøkler. Bevisste unntak markeres med
  `i18n-ignore-file` øverst i filen og en kort begrunnelse. Dynamiske prefikser
  (`errors.*`, `auditActions.*`, `metadata.*`, `settings.permissions.items.*`,
  `settings.roles.builtIn.*`) er dokumentert i sjekken.
- Bruk `npm run i18n:unused` for å se ubrukte nøkler før du sletter dem. En
  nøkkel skal ikke fjernes før den er bekreftet ubrukt, også i dynamiske
  oppslag.

## Lisens på bidrag

Ved å sende inn en pull request godtar du at bidraget lisensieres under
Business Source License 1.1 på samme vilkår som resten av prosjektet, og at
lisensgiveren kan bruke det videre på samme måte. Du beholder opphavsretten til
ditt eget bidrag.
