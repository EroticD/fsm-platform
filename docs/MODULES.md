# Moduler (ARCH-01)

FSM-plattformen er en **modulær monolitt**: én app, én database og én
deployment. Kjernen er alltid på. Andre kapabiliteter er
installasjonsnivåmoduler som administrator kan slå av og på.

Å slå av en modul **sletter ingenting**. Den stenger sider, navigasjon,
server actions, API-ruter og bakgrunnsjobber. Dataene blir liggende i de samme
tabellene, og når modulen slås på igjen er de tilbake.

## Kjerne og moduler

Kjernen kan ikke slås av:

- innlogging, brukere, roller og avdelinger
- kunder, kontakter og kundesteder
- oppdrag, visiter og arbeidsdager/tid
- revisjonslogg, innstillinger og merkevare
- varsler og sanntidsoppdateringer

| Modul | Nøkkel | Avhenger av | Innhold |
| --- | --- | --- | --- |
| Kjerne | `core` | – | Auth, brukere, avdelinger, kunder, oppdrag, arbeidsdager/tid, revisjon, innstillinger |
| Kalender og dispatch | `calendar` | – | `/kalender/**`, dispatch, ruteplan, kapasitet, iCal-feed |
| Rapporter og HMS | `reports` | – | `/rapporter/**`, `/hms`, maler/sjekklister, PDF, statistikk, rapportsøk |
| Utstyr | `equipment` | – | `/enheter/**`, `/skann`, QR, målinger, vedlikeholdsplaner, utstyrs-API |
| Serviceavtaler og SLA | `contracts` | – | `/avtaler`, SLA-policyer, åpningstider, prislister, avtale-PDF |
| Kundeportal | `portal` | – | `/kundeportal/**` og portalhandlinger |
| Bestillinger | `booking` | `portal`, `calendar` | `/bookinger`, bookingforespørsler og hold-rydding |
| Dokumenter | `documents` | – | `/dokumenter/**`, dokument-API, PDF-tekst/OCR, kladderydding |
| SMS og påminnelser | `sms` | – | `/meldinger`, SMS-webhook, SMS-kø og påminnelsesworker |
| Kart | `map` | – | `/kart`, kartinnstillinger, dashbordkart |
| Sporing og ETA | `tracking` | `calendar` | `/sporing/**`, `/api/tracking/**`, posisjonsping-rydding |
| Omtaler | `reviews` | – | `/anmeldelser`, offentlig omtaleside og dashbordaggregat |
| Kundeoverføring | `transfer` | `equipment`, `documents` | Eksport/import av kundepakker og transfer-rydding |
| Revisjons- og bevisEksport | `auditExport` | – | Revisjonsarkiv og bevispakker |
| REST-API | `api` | – | `/api/v1/**` og OpenAPI |
| SSO og SCIM | `sso` | – | OIDC-knapper, SSO-innstillinger, `/api/scim/**` |
| Offline felt | `offline` | – | Offline-kladder, utbokskø, sesjonsvakt og service worker |
| Tilbud | `quotes` | – | Levert v1: `/tilbud`, portalgodkjenning, konvertering |
| Fakturering | `invoicing` | – | Levert v1: `/faktura`, betaling/kreditnota, CSV |
| Lager | `inventory` | – | Levert v1: `/lager`, reservasjon/forbruk, leverandør og innkjøpsordre |
| Kjøring/utlegg | `fieldExpenses` | – | Levert v1: `/utlegg`, godkjenning, lønn-CSV |
| Lønnsomhet | `bi` | – | Levert v1: `/lonnsomhet`, estimert inntekt og CSV |

Katalogen ligger i [`src/lib/modules.ts`](../src/lib/modules.ts). Nye moduler
skal legges der med navn, beskrivelse, avhengigheter, ruter, API-prefikser og
worker-navn – ikke hardkodes i navigasjon eller actions.

## Avhengighetsgraf

```text
booking ──▶ portal
        └─▶ calendar ◀── tracking
transfer ──▶ equipment
         └─▶ documents
# P2-modulene har ingen modulavhengigheter i katalogen; de kan slås av og på
# uavhengig av hverandre. Funksjonell integrasjon (faktura fra oppdrag, BI fra
# fakturaer) håndteres i tjenestelaget, ikke som en hard modulavhengighet.
```

Reglene håndheves i begge retninger:

- en modul kan ikke slås på før alle avhengighetene er på;
- en modul kan ikke slås av mens en modul som bruker den er på.

Kjernen (`core`) kan aldri slås av, og katalogen valideres for ukjente
avhengigheter og sirkler i tester.

## Presets

| Preset | Innhold | Bruk |
| --- | --- | --- |
| `full` | Alle leverte moduler på | Standard for eksisterende installasjoner |
| `core` | Bare kjerne | Kjerne-only installasjon og testing |

Første oppstart uten modulrader initialiseres fra `MODULE_PRESET`:

```dotenv
# full (standard) eller core
MODULE_PRESET=full
```

- **Eksisterende installasjoner** som oppgraderer får `full` når variabelen
  ikke er satt. Alle dagens funksjoner er dermed på etter migreringen, uten
  datatap eller manuelle steg.
- **Nye installasjoner** som skal starte kjerne-only setter
  `MODULE_PRESET=core` før første forespørsel eller seed.
- Etter at radene finnes, er databasen kilden til sannhet. Endringer gjøres i
  **Innstillinger → Moduler** og revideres.

Migreringen `20261107130000_module_states` er additiv: den oppretter bare
`ModuleState`. Ingen eksisterende tabell, kolonne eller rad endres.

## Oppførsel når en modul er av

| Flate | Oppførsel |
| --- | --- |
| Navigasjon | Elementet skjules i toppmeny, hamburgermeny og mobil bunnlinje |
| Innstillinger | Fanen skjules; direkte `?tab=` faller tilbake til første tillatte fane |
| Sider | Direkte URL gir `404` (`requireModulePage`) |
| Server actions | Avvises med `forbidden`/redirect før tjenestekallet |
| API | `404` for modulens ruter; `/api/v1` svarer `404` når `api` er av |
| Søk | Gruppen og databasespørringen utelates helt |
| Arbeidsjobber | PDF/OCR, SMS, påminnelser, booking-, sporing-, transfer- og dokumentrydding startes ikke |
| Cron | `/api/cron/recurring` og `/api/cron/cleanup` avviser avslåtte moduler |
| Kundeoverføring | Eksporten filtrerer bort avslåtte moduler; import avviser pakker som inneholder dem |
| Dashboard | Modulens widgets, hurtiglenker og unntakskort skjules; spørringene hoppes over der det er praktisk |
| Data | Beholdes uendret. Ingen tabell droppes og ingen rad slettes |

Sperren er ikke en sikkerhetsgrense for dataene – den er en
funksjons-/lisensgrense. Autorisasjon og avdelingssperrer gjelder fortsatt
uendret på innsiden.

## Drift og oppgradering

1. Ta vanlig backup før oppgradering (`scripts/backup.sh`).
2. Kjør migreringene (`npm run db:migrate` eller via Docker-entrypointen).
3. Første lesing oppretter `ModuleState`-radene. Uten `MODULE_PRESET` blir alle
   leverte moduler på.
4. Verifiser i **Innstillinger → Moduler** at forventede moduler er på.
5. Ved kjerne-only: sett `MODULE_PRESET=core` før første oppstart, eller slå av
   modulene manuelt etterpå. Manuell avslåing krever at avhengige moduler slås
   av først.

Cache: modultilstanden caches i inntil 10 sekunder per prosess
(`MODULE_CACHE_TTL_MS`). En endring invaliderer cachen lokalt med en gang;
andre replikaer ser den innen få sekunder. Endringen revideres i
aktivitetsloggen som `ModuleState`.

Tilbakestilling til et preset gjøres med tjenestefunksjonen
`applyModulePreset("core" | "full")` fra en administrativ jobb. Den brukes av
integrasjonstester og kan kalles fra en fremtidig CLI.

## Kjente begrensninger

- Noen sekundære tjenestefunksjoner i `src/server/*` har fortsatt ikke egen
  modulsjekk; de nås gjennom de gatede sidene, handlingene og API-rutene.
  Direkte import fra ny kode må selv kalle `requireModule`/`assertModule`.
- En eksportert ZIP som allerede er lastet ned før en modul ble slått av, kan
  ikke trekkes tilbake. Nye eksporter og importkontrollen følger gjeldende
  modultilstand, og eksportens fingeravtrykk inneholder modulsnapshotet slik at
  gamle jobber ikke gjenbrukes.
- `/sok/analyse` viser aggregert søkestatistikk (populære søk og nulltreff),
  ikke entitetsdata fra avslåtte moduler.
- P2-modulene (`quotes`, `invoicing`, `inventory`, `fieldExpenses`, `bi`) er
  leverte v1-moduler med egne sider, handlinger og tester. De har bevisst ingen
  harde modulavhengigheter; faktura fra oppdrag og BI fra fakturaer slås
  funksjonelt på når begge modulene er aktive.
- Kundeoverføring bruker HMAC eller Ed25519. Ed25519 er én felles
  deploy-identitet, ikke per-bruker ikke-fornektelse.

## Tester

- `src/lib/modules.test.ts` – katalog, avhengigheter, presets, sti-mapping.
- `src/server/modules.test.ts` – lesing, cache, toggle, revisjon, vakter.
- `src/lib/module-filtering.test.ts` – navigasjon og innstillingsfaner.
- `src/lib/search-modules.test.ts` – søk utelater avslåtte moduler.
- `src/lib/api-auth-modules.test.ts` – API avviser avslått `api`-modul.
- `src/lib/scheduler.test.ts` – planlagte jobber respekterer moduler.
- `src/lib/module-guards.test.ts` – direkte URL gir 404.
- `src/server/integration/modules.integration.test.ts` – ekte PostgreSQL:
  preset-initialisering, toggle + revisjon, avhengigheter og databevaring.
