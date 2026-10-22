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
npm run typecheck   # next typegen + tsc --noEmit
npm test            # vitest
npm run lint        # eslint
npm run build       # produksjonsbygg
```

CI kjører de samme stegene, i tillegg til Docker-bygg og en sjekk for at
migrasjonene gir samme skjema som `prisma/schema.prisma`.

## Retningslinjer

- **Norsk i brukergrensesnittet.** Nye knapper, feilmeldinger og hjelpetekster
  skrives på norsk, og følger tonen i resten av appen.
- **Følg eksisterende mønstre.** Server actions, autorisasjon og validering
  ligger nær rutene som bruker dem. Se `src/lib/session.ts` og
  `src/lib/sanitize.ts`.
- **Autoriser på nytt i hver handling.** Skjul ikke bare knappen i UI-en –
  sjekk rolle, `isActive` og eierskap på serveren.
- **Rens all input på serveren.** Fritekst kan inneholde Markdown, men HTML skal
  aldri tolkes. Bruk hjelperne i `src/lib/sanitize.ts` og `src/lib/markdown.ts`.
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
