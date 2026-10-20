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

For OCR av skannede PDF-er trenger du `poppler-utils` lokalt
(`pdftotext`/`pdftoppm`). I Docker-imaget er det allerede installert, sammen med
norsk og engelsk språkdata. Uten språkdata henter tesseract.js dem fra nettet ved
første kjøring.

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

Appen er da tilgjengelig på <http://localhost:3000>.

> **Feilsøking:** `npm install` kan stoppe i `prisma generate` med
> `ENOENT ... .bin/prisma_schema_build_bg.wasm` hvis `node_modules/.bin/prisma`
> er en filkopi i stedet for en lenke – typisk når `node_modules` er kopiert fra
> en annen maskin. Skriptene kaller Prisma via sin virkelige sti, så en fersk
> klone rammes ikke. Har du allerede en slik mappe, slett `node_modules` og kjør
> `npm install` på nytt. På NixOS, se [NixOS](#nixos).

### NixOS

Prisma 5.22 har ikke ferdigbygde motorer for NixOS, så `prisma generate` prøver
å laste ned en motor for `linux-nixos` som ikke finnes. `shell.nix` bruker
`prisma-engines` 5.22.0 fra nixpkgs 24.11 og peker Prisma mot dem i stedet:

```bash
nix-shell
rm -rf node_modules
npm install
npm run db:migrate
npm run dev
```

Shellen bruker Node 22 fra nixpkgs 24.11, som er versjonen Docker-imaget og CI
bruker. Utenfor shellen vil `prisma generate` fortsatt feile på NixOS.

Nyttige kommandoer:

```bash
npm run seed        # opprett administrator (idempotent)
npm test            # enhetstester (vitest)
npm run typecheck   # generer rutetyper og kjør tsc
npm run build       # produksjonsbygg
npm run lint        # eslint
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
- Opplastede bilder ligger på et eget volum og overlever nytt bygg.
- Databasen eksponeres bare på `127.0.0.1`.
- OCR fungerer uten nettverkstilgang: imaget har `poppler-utils` og norsk/engelsk
  språkdata i `/app/tessdata`.

Imaget kan også bygges og kjøres uten Compose. På Linux kan `--network host`
brukes slik at `DATABASE_URL` i `.env` når databasen på vertsmaskinen:

```bash
docker build -t fsm-platform .
docker run --rm --network host --env-file .env \
  -v "$PWD/uploads:/app/uploads" fsm-platform
```

`docker-compose.yml` merker imaget som `fsm-platform:local`.

Ved oppstart utfører containeren følgende: venter på databasen, kjører
`prisma migrate deploy`, kjører seed hvis `SEED_DATABASE=true`, og starter
deretter serveren. Migrasjonene kan hoppes over med `SKIP_MIGRATIONS=true` hvis
de kjøres som et eget steg i produksjon.

### Produksjon

Appen må stå bak en reverse proxy som terminerer TLS. Sett
`NEXTAUTH_URL=https://ditt-domene.no` – ellers blir øktcookien ikke markert som
`Secure`, og innlogging kan oppføre seg feil bak HTTPS.

Eksempel med Caddy:

```caddyfile
fsm.example.com {
    encode gzip
    # Last opp store PDF-er; appen selv tillater 100 MB.
    request_body {
        max_size 110MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

- Begrens body-størrelse i proxyen. Appen tar imot inntil 100 MB per opplasting,
  og uten en grense kan uautentiserte forespørsler bruke mye minne.
- Kjør én app-instans, eller flytt innloggingsbegrensningen til Redis: den ligger
  i minnet i `src/lib/rate-limit.ts`.
- Sett opp sikkerhetskopier (se under) og overvåk `/api/health`.

### Oppgradere en eksisterende database

Hvis databasen allerede har `Tag`/`Document`-tabellene fra før migrasjonen
`20261019182918_tags_og_dokumenter` fantes (for eksempel laget med
`prisma db push`), vil `prisma migrate deploy` prøve å opprette dem på nytt og
feile. Kontroller først at skjemaet stemmer, og marker migrasjonen som kjørt:

```bash
npm run db:status
npx prisma migrate resolve --applied 20261019182918_tags_og_dokumenter
```

En helt ny database trenger ikke dette; der kjøres alle migrasjonene i rekkefølge.

## Sikkerhetskopi og gjenoppretting

`scripts/backup.sh` dumper databasen og opplastingsvolumet til `./backups/`, og
sletter filer eldre enn 30 dager:

```bash
./scripts/backup.sh
# eller med egne verdier:
BACKUP_DIR=/var/backups/fsm UPLOADS_VOLUME=fsm-platform_fsm_uploads ./scripts/backup.sh
```

Gjenoppretting:

```bash
gunzip -c backups/db-20261019-120000.sql.gz | \
  docker compose exec -T postgres psql -U admin -d fsm_db

docker run --rm \
  -v fsm-platform_fsm_uploads:/data \
  -v "$PWD/backups:/backup:ro" \
  postgres:15 \
  tar xzf /backup/uploads-20261019-120000.tar.gz -C /data
```

Kjør sikkerhetskopien fra en cron-jobb eller systemd-timer, og legg kopiene et
annet sted enn maskinen appen kjører på.

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
- Innlogging har hastighetsbegrensning per e-postkonto og per IP
  (`src/lib/rate-limit.ts`). Økten varer i 12 timer, og skrivehandlingene sjekker
  at brukeren fortsatt er aktiv.
- Bare administratorer kan endre roller som berører `ADMIN`, opprette
  administratorer, slette/deaktivere dem eller lage invitasjonslenker til dem.
  En kontorbruker kan ikke gi seg selv full tilgang.
- Rapporter låses automatisk når de er fylt ut. Bare en administrator kan låse
  dem opp igjen, og hver opplåsing logges i aktivitetsloggen.
- Kundeportalbrukere begrenses til egen kundedata i `src/proxy.ts` og i hver
  enkelt rute.
- Opplastede filer under `/uploads` krever en gyldig økt. Merkevarelogoen er en
  ekstern URL, slik at den kan vises på innloggingssiden og i e-post.
- `.env` er ignorert av git. Del aldri filen, og roter passordet om det har vært
  eksponert.
- Alle skjemafelt renses på serveren før de lagres (`src/lib/sanitize.ts`): HTML,
  skript og kontrolltegn fjernes, lengdene begrenses, og e-post, telefon, lenker,
  farger, roller og statuser valideres. Fritekst beholder Markdown, men viseren
  tolker aldri HTML – og e-postmalene escaper verdiene sine.
- Responsene får sikkerhetsheadere (`X-Content-Type-Options`, `X-Frame-Options`,
  CSP for innramming, HSTS) i `next.config.ts`.

## Kjente gjeldsposter

- `@typescript-eslint/no-explicit-any` er satt til advarsel i
  `eslint.config.mjs` fordi noen steder bruker `any` der Prisma- og
  Next-typene er tungvinte å uttrykke. Lint kjører grønt, men advarslene bør
  ryddes gradvis.
- `JobComment`-modellen i `schema.prisma` er ikke lenger i bruk (kommentarer
  lagres i `Comment`) og kan fjernes i en egen migrasjon.
- Tekstuttrekk/OCR kjører i en kø i app-prosessen (`src/lib/pdf-queue.ts`). Ved
  flere app-instanser bør den flyttes til en ekstern jobbkø.

## Lisens

Programmet er tilgjengelig under **Business Source License 1.1 (BSL 1.1)** – en
kildeåpen lisens, ikke en OSI-godkjent åpen kildekodelisens. Se
[LICENSE](LICENSE) for den fullstendige teksten.

| Parameter | Verdi |
| --- | --- |
| Lisensgiver | Kristoffer Garshol |
| Lisensiert verk | FSM-plattformen (fsm-platform), versjon 0.1.0 og senere |
| Ekstra bruksrett | Ingen |
| Endringsdato | 2030-10-19 |
| Endringslisens | Apache License 2.0 |

Uten en ekstra bruksrett krever all produksjonsbruk en egen kommersiell avtale
med lisensgiveren. Fra endringsdatoen gjelder Apache 2.0 for den aktuelle
versjonen av verket. Lisensgiveren kan selv bruke, endre og videreutvikle
programmet uten begrensninger.

Kontakt lisensgiveren for kommersiell lisensiering.
