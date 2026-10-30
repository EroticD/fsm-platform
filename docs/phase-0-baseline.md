# Phase 0 – preflight-baseline

Dato: 2026-10-30  
Grunnlag: `master` @ `2dba37a5ab96808b8385263f5904b560c71f6dea`, tag `v0.8.0`  
Arbeidsgren: `phase-0-preflight` (worktree `p0-preflight`)

## P0-01 – grønn base

| Sjekk | Resultat |
| --- | --- |
| Commit | `2dba37a5ab96808b8385263f5904b560c71f6dea` |
| Appversjon | `0.8.0` (`package.json`, tag `v0.8.0`) |
| CI for v0.8.0 | [run 41098513992](https://github.com/EroticD/fsm-platform/actions/runs/41098513992): success. Også grønn for `master` ([41098509559](https://github.com/EroticD/fsm-platform/actions/runs/41098509559)) og `dev` ([41097089450](https://github.com/EroticD/fsm-platform/actions/runs/41097089450)) |
| Enhetstester | 162 filer / 1 522 tester passert i CI (`test:coverage`); samme antall lokalt med `npm test` |
| Integrasjonstester | 8 filer / 9 tester passert |
| E2E | 52 grønne / 2 skipped. Playwrights oppsummering i CI: `51 passed`, `1 flaky` (grønn etter retry) og `2 skipped` |
| Typesjekk | Grønn (`npm run typecheck` og CI `npx tsc --noEmit`) |
| Lint | Grønn, 0 errors / 36 warnings lokalt; grønn i CI |
| i18n (vanlig) | Grønn: 3 177 nøkler i paritet. 314 hardkodede strenger og 494 ubrukte nøkler rapporteres som varsel |
| Bygg | Grønn i CI (`npm run build`). Lokalt bygg er blokkert av symlinket `node_modules`, se avvik |
| Docker-publisering | [run 41099671669](https://github.com/EroticD/fsm-platform/actions/runs/41099671669): success |
| Image | `ghcr.io/eroticd/fsm-platform:v0.8.0`, digest `sha256:32d909339c00b0cb4b8c04b86f2b05d8c4406ef5410db5b055be02fd4ab39c3a` |
| Node | CI og Docker: Node 22. Lokal: v26.8.1, npm 11.19.0 |
| Next.js | 16.4.2 |
| Prisma | 7.10.1 (`@prisma/client` 7.10.1) |
| React / next-intl | 19.3.1 / 4.14.9 |
| PostgreSQL | 15 (`fsm-platform-postgres-1`, image `postgres:15`) |

E2E-tallet er hentet fra CI-loggen, ikke kjørt lokalt: den eksisterende
produksjonsserveren på `:3100` skal ikke restartes i denne fasen. Den ene
flaky testen var `mobile-layout.spec.ts` (timeout ved 320 px) og passerte på
nytt forsøk.

## P0-02 – `dev`-grenen

`dev` finnes både lokalt og som `origin/dev`, og peker på samme commit som
basen:

```text
2dba37a5ab96808b8385263f5904b560c71f6dea
```

Ingen gren ble opprettet eller endret.

## P0-03 – streng i18n-sjekk

`package.json` har fått scriptet:

```json
"check:i18n:strict": "node scripts/check-i18n.mjs --strict"
```

Første kjøring er rød med exit 1, som forventet før Phase 2:

```text
✓ i18n: 3177 nøkler i begge språk
⚠ i18n: 314 hardkodede norske strenger
⚠ i18n: 494 nøkler uten kjente brukere
```

Vanlig `npm run check:i18n` er fortsatt grønn (exit 0) med de samme varslene.

## P0-04 – OpenAPI-snapshot

Snapshottet er hentet fra den kjørende produksjonsbyggen på
`http://127.0.0.1:3100/api/v1/openapi.json` og lagret som
`docs/openapi-baseline-0.8.0.json`.

- HTTP 200, 25 926 bytes
- Gyldig JSON med `"openapi": "3.1.0"`
- 10 stier: `/me`, `/work-orders`, `/work-orders/{id}`, `/customers`,
  `/customers/{id}`, `/reports`, `/reports/{id}`, `/reports/{id}/pdf`,
  `/documents`, `/documents/{id}`
- SHA-256: `cca7355f1a30e5b223a78f0d59c263c65643df6e30b1591620a5b7885fdcd0c8`

## P0-05 – ren database og driftssjekk

Midlertidig database `fsm_phase0_gate` ble opprettet i den eksisterende
Postgres-containeren. Alle 44 migrasjonene ble anvendt, og
`prisma migrate diff --exit-code` fant ingen forskjell mellom databasen og
`prisma/schema.prisma`. Databasen ble slettet etterpå.

```text
44 migrations found in prisma/migrations
All migrations have been successfully applied.

No difference detected.

Database schema is up to date!
```

## Kjøring

Alle kommandoene under ble kjørt 2026-10-30 fra
`/home/garshol/.local/share/opencode/worktree/f36104/p0-preflight`.

### Gren og versjoner

```bash
git rev-parse --verify dev
# 2dba37a5ab96808b8385263f5904b560c71f6dea

git describe --tags --always
# v0.8.0

node -v
# v26.8.1

node -p "require('./node_modules/next/package.json').version"
# 16.4.2

node -p "require('./node_modules/prisma/package.json').version"
# 7.10.1
```

### Kvalitetsporten

```bash
npm run typecheck
# exit 0
# ✓ Types generated successfully

npm run lint
# exit 0
# ✖ 36 problems (0 errors, 36 warnings)

npm test
# exit 0
# Test Files  162 passed (162)
# Tests  1522 passed (1522)

npm run test:integration
# exit 0
# Test Files  8 passed (8)
# Tests  9 passed (9)

npm run check:i18n
# exit 0
# ✓ i18n: 3177 nøkler i begge språk
# ⚠ i18n: 314 hardkodede norske strenger
# ⚠ i18n: 494 nøkler uten kjente brukere

npm run check:i18n:strict
# exit 1 (forventet før Phase 2)
# ✓ i18n: 3177 nøkler i begge språk
# ⚠ i18n: 314 hardkodede norske strenger
# ⚠ i18n: 494 nøkler uten kjente brukere
```

Enhetstestene og integrasjonstestene ble kjørt mot den midlertidige databasen
med `DATABASE_URL` og `TEST_DATABASE_URL` satt til `fsm_phase0_gate`.

### OpenAPI

```bash
curl -sS http://127.0.0.1:3100/api/v1/openapi.json \
  -o /tmp/openapi-baseline.json
# HTTP 200, 25926 bytes

node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/openapi-baseline.json","utf8")); console.log("openapi:",j.openapi,"paths:",Object.keys(j.paths).length)'
# openapi: 3.1.0 paths: 10

cp /tmp/openapi-baseline.json docs/openapi-baseline-0.8.0.json
cmp /tmp/openapi-baseline.json docs/openapi-baseline-0.8.0.json
# copied identical
```

### Database

```bash
docker exec fsm-platform-postgres-1 psql -U admin -d postgres \
  -c 'DROP DATABASE IF EXISTS fsm_phase0_gate;'
# NOTICE: database "fsm_phase0_gate" does not exist, skipping
# DROP DATABASE

docker exec fsm-platform-postgres-1 psql -U admin -d postgres \
  -c 'CREATE DATABASE fsm_phase0_gate;'
# CREATE DATABASE

DATABASE_URL='postgresql://admin:<lokal-dev-passord>@localhost:5432/fsm_phase0_gate?schema=public' \
  npx prisma migrate deploy
# exit 0
# 44 migrations found in prisma/migrations
# All migrations have been successfully applied.

DATABASE_URL='postgresql://admin:<lokal-dev-passord>@localhost:5432/fsm_phase0_gate?schema=public' \
  npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code
# exit 0
# No difference detected.

DATABASE_URL='postgresql://admin:<lokal-dev-passord>@localhost:5432/fsm_phase0_gate?schema=public' \
  npx prisma migrate status
# exit 0
# Database schema is up to date!

docker exec fsm-platform-postgres-1 psql -U admin -d postgres \
  -c 'DROP DATABASE IF EXISTS fsm_phase0_gate;'
# DROP DATABASE
```

Passordet er bevisst utelatt fra denne filen; det hentes fra den lokale
`.env`-filen og er ikke en del av repoet.

### Avvik

- **Lokal `npm run build` går ikke i worktreen.** `node_modules` er et
  symbolsk lenke til hovedrepoet, og Turbopack nekter å resolvere utenfor
  worktreens rot: `Error: Could not find the Next.js package
  (next/package.json)`. Bygget er derfor verifisert i CI, der
  `npm run build` er grønn for samme commit. Et forsøk med
  `npx next build --webpack` kompilerte, men stoppet på typesjekk av
  `.next/types/app/page.ts` fordi `src/app/page.tsx` eksporterer
  `buildPriorityQueue` for testene. Det er en webpack-spesifikk
  typegenerering, ikke en produktregresjon, og CI bruker Turbopack.
- **`check:i18n:strict` er rød** (exit 1). Det er forventet; 314 hardkodede
  strenger og 494 ubrukte nøkler skal ryddes i Phase 2.
- **E2E er ikke kjørt lokalt.** `:3100` brukes av en eksisterende
  produksjonsserver som ikke skal startes eller stoppes i denne fasen.
  Tallene kommer fra den grønne CI-kjøringen for `v0.8.0`.
