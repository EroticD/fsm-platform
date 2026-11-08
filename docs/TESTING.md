# Testing

Repoet har tre nivåer av Vitest-tester og en egen Playwright-suite:

| Nivå | Filnavn | Kommando | Kjøres |
| --- | --- | --- | --- |
| Enhetstester | `*.test.ts` / `*.test.tsx` | `npm test` | Endrede på dev/PR, full på master/tag |
| Integrasjonstester | `*.integration.test.ts` | `npm run test:integration` | Endrede på dev/PR, full på master/tag |
| Dekning | samme som enhetstester | `npm run test:coverage` | Full på master/tag |
| E2E | `e2e/*.spec.ts` | `npm run test:e2e` | Som før, med seedet database |

Målet er at vanlig utvikling og pull requests bare kjører testene som er
påvirket av endringen, mens releaser fra `master`/`main` og tagger fortsatt
kjører hele suiten med dekningskrav. Typesjekk, lint, i18n-sjekk, bygg og E2E
er uendret og kjøres fullt i CI.

## Kommandoer

```bash
# Bare testene som er påvirket av endringene mot origin/dev
npm run test:changed

# Sammenlign mot en annen ref (for eksempel forrige commit)
npm run test:changed -- --base HEAD~1

# Se mappingen uten å kjøre Vitest
npm run test:changed -- --base origin/dev --list

# Bare påvirkede integrasjonstester
npm run test:changed:integration

# En navngitt modul eller domene
npm run test:module -- invoicing
npm run test:module -- auth --integration
npm run test:module -- api --all
npm run test:module -- core --list

# Testene til mapping-skriptet selv
npm run test:mapping
```

`npm run test:module` godtar disse navnene:

`quotes`, `invoicing`, `inventory`, `expenses`, `bi`, `routing`, `auth`,
`rbac`, `payments`, `accounting`, `email`, `push`, `api`, `core`,
`mobile-api`.

Uten `--integration`/`--all` kjører `test:module` enhetstester. Legg til
`--integration` for bare integrasjonstester, eller `--all` for begge.

## Mapping fra endrede filer til tester

`scripts/test-changed.mjs` leser endrede filer fra git og bruker
`scripts/test-mapping.mjs`. Reglene er, i prioritert rekkefølge:

1. **Endret testfil** tas med direkte.
2. **Direkte søskentest**: `src/lib/foo.ts` → `src/lib/foo.test.ts`.
   Kvalifiserte varianter som `foo.export.test.ts` og
   `foo-validation.test.ts` tas også med.
3. **Rute/page-test**: en endret fil under `src/app/...` tar med testene i
   samme rute-/sidemappe, for eksempel `src/app/oppdrag/page.tsx` →
   `src/app/oppdrag/page.test.ts` og andre tester i `src/app/oppdrag/`.
4. **Reverse imports**: alle testfiler leses, og tester som importerer eller
   mocker den endrede modulen tas med. Både `import`, `export ... from`,
   `require`, dynamisk `import()` og `vi.mock()`/`vi.doMock()` dekkes.
   Aliaset `@/` løses til `src/`, relative stier løses fra testfilen, og
   `index.ts` samt `.js` → `.ts` håndteres.
5. **Delt token**: en endret fil og en test som deler et meningsbærende ord
   (for eksempel `job-worker.ts` og `job-queue.test.ts`) kobles sammen. Ord
   som `src`, `app`, `lib`, `page`, `route`, `actions` og `api` ignoreres.
6. **Domenefallback**: når filen ikke har en direkte test, brukes
   domenenøkkelord. `src/server/invoices.ts` mapper for eksempel til
   invoice-, billing- og payment-tester, inkludert integrasjonstester som
   inneholder `invoice`/`payment`. `src/server/expenses.ts` mapper til
   utlegg/expense-tester, og `src/app/faktura/` til faktura/billing.

`core` og `api` er bevisst ikke med i domenefallbacken for enkeltfiler: de er
for brede og ville dratt inn nesten hele suiten. De finnes fortsatt som
`test:module`-navn, og enkeltfiler fanges av søskentest, reverse imports og
delte tokens.

### Hvilken base brukes?

- `--base <ref>` vinner alltid.
- Ellers brukes `origin/<GITHUB_BASE_REF>` i pull requests.
- Ellers `origin/dev`, og `HEAD~1` dersom `origin/dev` peker på samme commit
  som `HEAD` (typisk ved push til dev).
- `--head <ref>` eller `GITHUB_SHA` kan overstyre head.
- Ved lokal kjøring med `HEAD` tas også ulagrede, staged og untracked filer
  med, slik at man kan teste før man committer.

### Ingen treff er ikke grønt

Hvis endret kildekode ikke mapper til noen test, skrives en tydelig advarsel.
Skriptet feiler med mindre man eksplisitt bruker `--allow-empty`:

```bash
npm run test:changed -- --allow-empty
```

Bruk `--allow-empty` bare når endringen bevisst ikke krever en Vitest-test,
for eksempel ren tekst eller dokumentasjon. CI bruker flagget for endrede
integrasjonstester (en UI-endring kan mangle integrasjonstest), men ikke for
endrede enhetstester.

## CI-oppførsel

Workflowen `.github/workflows/ci.yml` skiller mellom release og utvikling:

| Hendelse | Enhetstester | Integrasjon | Dekning |
| --- | --- | --- | --- |
| Push til `master`/`main` | Full `npm test` via coverage | Full | Ja |
| Tag `v*` | Full `npm test` via coverage | Full | Ja |
| Push til `dev` | `npm run test:changed` | `npm run test:changed:integration -- --allow-empty` | Nei |
| Pull request | `npm run test:changed` | `npm run test:changed:integration -- --allow-empty` | Nei |

Checkout bruker `fetch-depth: 0` slik at `origin/<base>` og merge-base finnes.
Typesjekk, lint, i18n, bygg, E2E og sikkerhetsrevisjon kjøres som før.
`npm run test:mapping` kjøres alltid, fordi mapping-skriptet selv er en del av
CI-infrastrukturen. Release-gaten er ikke svekket: full enhetstest, full
integrasjon og dekningskrav gjelder fortsatt på `master`/`main` og tagger.

## Legge til tester for en ny modul

1. Legg enhetstester ved siden av kildefilen, for eksempel
   `src/server/min-modul.test.ts`. Da trenger du ingen registrering.
2. Legg integrasjonstesten i `src/server/integration/` med suffikset
   `.integration.test.ts`.
3. Hvis modulen ikke har en naturlig søskentest, legg nøkkelordene i
   `DOMAIN_KEYWORDS` og en oppføring i `MODULE_TARGETS` i
   `scripts/test-mapping.mjs`. Da virker både `test:changed`,
   `test:module <navn>` og CI uten flere hardkodede lister.
4. Oppdater `npm run test:module`-listen i denne filen og i hjelpeteksten i
   `scripts/test-module.mjs` dersom modulen er ment som et offisielt navn.
5. Kjør `npm run test:mapping`, `npm run test:module -- <navn> --list` og
   `npm run test:changed -- --list` før du committer.

## Begrensninger

- **SQL og skjemaendringer**: `prisma/**`, `*.sql`, testoppsett,
  `package-lock.json`, `tsconfig.json` og Vitest-konfigurasjon gjør at hele
  suiten i valgt modus kjøres. En migrering kan påvirke mange domener, så
  ikke stol på en smal mapping. Kjør alltid `npm run test:integration` ved
  skjemaendringer.
- **Dynamiske imports og runtime-oppslag** kan ikke alltid spores statisk.
  Reverse imports dekker vanlige `import`, `export`, `require` og `vi.mock`,
  men ikke filnavn som bygges som strenger.
- **Indirekte avhengigheter**: hvis A importerer B og testen bare importerer
  A, fanges ikke en endring i B via reverse imports. Domenefallback og delte
  tokens dekker mange slike tilfeller, men ikke alle.
- **UI og E2E**: mappingen gjelder Vitest. Playwright/E2E kjøres fortsatt som
  en egen full gate; endringer i rene sider bør ha en rute-/page-test eller
  en E2E-test.
- **`core` og `api` i `test:module`** er brede med vilje. For enkelte
  endringer i kjernefiler er hele kjerne- eller API-suiten riktig, men det er
  ikke ment som standard for hver lille komponentendring.
- **Miljø**: integrasjonstester krever `TEST_DATABASE_URL` (eller CI-databasen).
  Uten den faller oppsettet tilbake til `DATABASE_URL`; bruk en dedikert
  testdatabase.
- Mapping-skriptet er rent Node 22 og krever verken database eller
  `node_modules` for `--list`; selve kjøringen bruker prosjektets Vitest.
