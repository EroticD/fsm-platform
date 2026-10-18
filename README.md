# FSM-plattformen

Et feltvennlig service- og vedlikeholdssystem (FSM) bygget med Next.js, Prisma og
PostgreSQL. Plattformen dekker hele flyten fra oppdraget planlegges til den
signerte servicerapporten kan lastes ned som PDF.

## Hva systemet gjør

- **Oppdrag og kalender** – planlegg, fordel og følg opp serviceoppdrag i måneds-,
  ukes- og dispatcher-visning.
- **Servicerapporter** – sjekklister per enhet, kommentarer per sjekkpunkt,
  bilder og signaturer tegnet på skjermen, og ferdig PDF med firmaets logo.
- **Enheter og servicehistorikk** – hver kunde har oversikt over utstyret sitt,
  og hver enhet viser alle tidligere servicer med resultat, kommentarer og bilder.
- **Kunder og kundeportal** – kundekort med kontakter, avtaler og egne
  portalbrukere som bare ser sin egen bedrift.
- **Rapportering** – dashboard med nøkkeltall, globalt søk (⌘K / `/`) og
  aktivitetslogg for alle endringer.
- **Markdown i fritekst** – beskrivelser, notater, kommentarer og fritekstsvar i
  rapporter skrives med en enkel formateringslinje, og vises likt på nettsiden og
  i PDF-en.

## Kom i gang lokalt

Forutsetninger: Node.js 22+, Docker og npm.

```bash
git clone <repo-url> fsm-platform
cd fsm-platform
npm install
cp .env.example .env      # fyll inn DATABASE_URL og NEXTAUTH_SECRET
docker compose up -d postgres
npx prisma migrate deploy # oppretter tabellene
npm run seed              # valgfritt: oppretter en administrator
npm run dev
```

Appen er da tilgjengelig på <http://localhost:3000>.

Ny nyttig kommando:

```bash
npm run seed        # opprett administrator (idempotent)
npm run build       # produksjonsbygg
npm run lint        # eslint
npx tsc --noEmit    # typesjekk
```

## Kjøre med Docker

`docker-compose.yml` setter opp både appen og databasen. Appen kjører
migrasjonene sine selv ved oppstart.

```bash
cp .env.example .env
# Sett minst DATABASE_URL, POSTGRES_PASSWORD, NEXTAUTH_SECRET og
# NEXTAUTH_URL. Vil du at administratoren opprettes automatisk, sett
# SEED_ADMIN_EMAIL og SEED_ADMIN_PASSWORD også.
docker compose up -d --build
```

- Appen svarer på <http://localhost:3000> og har helsesjekk på `/api/health`.
- Opplastede bilder ligger på volumet `fsm_uploads` og overlever nytt bygg.
- Databasen eksponeres bare på `127.0.0.1`.

Ved oppstart utfører containeren følgende: venter på databasen, kjører
`prisma migrate deploy`, kjører seed hvis `SEED_DATABASE=true`, og starter
deretter serveren. Migrasjonene kan hoppes over med `SKIP_MIGRATIONS=true` hvis
de kjøres som et eget steg i produksjon.

## Miljøvariabler

Alle variabler er dokumentert i [`.env.example`](.env.example). De viktigste:

| Variabel | Beskrivelse |
| --- | --- |
| `DATABASE_URL` | Tilkobling til PostgreSQL (påkrevd) |
| `NEXTAUTH_SECRET` | Hemmelighet for økter; lag med `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Appens offentlige adresse (påkrevd i produksjon, må være https) |
| `SMTP_*` | E-post for invitasjoner; uten disse vises delbare lenker |
| `UPLOAD_DIR` | Hvor opplastede filer lagres (standard `./uploads`) |
| `SEED_*` | Styrer den automatiske administratoren ved første oppstart |

## Teknisk oppbygning

- **Next.js 16** (App Router, React 19) med server components der det passer.
- **Prisma 5** mot PostgreSQL; skjemaet ligger i `prisma/schema.prisma` og
  migrasjonene i `prisma/migrations/`.
- **NextAuth** med kodeord-innlogging. Konti opprettes av en administrator og
  aktiveres manuelt; brukeren setter passordet sitt via en invitasjonslenke.
- **@react-pdf/renderer** genererer servicerapporten på serveren, slik at PDF-en
  også virker uten JavaScript i nettleseren.
- **Markdown** (Obsidian-syntaks + GFM) i fritekstfeltene, med felles oppsett i
  `src/lib/markdown.ts`: `MarkdownEditor` i skjemaene, `MarkdownView` på
  nettsiden og `MarkdownPdf` i rapporten. All tekst blir renset i
  `src/lib/sanitize.ts` før den lagres, og Markdown-viseren tolker aldri HTML.
- **Tailwind CSS 4** med et lyst tema.
- Roller: `ADMIN`, `OFFICE`, `TECHNICIAN` og `CUSTOMER`.

### Datamodell i korte trekk

`Customer` har `Product` (utstyr), `Contact` og `WorkOrder`. Hvert oppdrag har
`Report`, som igjen har `ReportUnit` – ett øyeblikksbilde per kontrollert enhet
med svar, kommentarer og status. Historikken endres derfor ikke selv om malen
eller enheten redigeres senere.

## Sikkerhet

- Passord hashes med bcrypt og sendes aldri i URL-er.
- Rapporter låses automatisk når de er fylt ut. Bare en administrator kan låse
  dem opp igjen, og hver opplåsing logges i aktivitetsloggen.
- Kundeportalbrukere begrenses til egen kundedata i `src/proxy.ts` og i hver
  enkelt rute.
- `.env` er ignorert av git. Del aldri filen, og roter passordet om det har vært
  eksponert.
- Alle skjemafelt renses på serveren før de lagres (`src/lib/sanitize.ts`): HTML,
  skript og kontrolltegn fjernes, lengdene begrenses, og e-post, telefon, lenker,
  farger, roller og statuser valideres. Fritekst beholder Markdown, men viseren
  tolker aldri HTML – og e-postmalene escaper verdiene sine.

## Kjente gjeldsposter

- `@typescript-eslint/no-explicit-any` er satt til advarsel i
  `eslint.config.mjs` fordi noen steder bruker `any` der Prisma- og
  Next-typene er tungvinte å uttrykke. Lint kjører grønt, men advarslene bør
  ryddes gradvis.
- Eldre sider under `src/app/maler/` er erstattet av mal-byggeren under
  `src/app/innstillinger/maler/` og kan fjernes.
- `JobComment`-modellen i `schema.prisma` er ikke lenger i bruk (kommentarer
  lagres i `Comment`) og kan fjernes i en egen migrasjon.

## Lisens

Apache License 2.0 – se [LICENSE](LICENSE).
