# Plattformanalyse: FSM-plattformen mot markedet

> **Status:** 2026-11-08, `master` og `dev` @ `v0.9.1`, versjon `0.9.1`
> (`v0.9.1`). Analysen beskriver funksjonene som faktisk finnes i denne grenen,
> ikke bare det som er planlagt.
>
> **Metode:** Kode- og dokumentasjonsgjennomgang av dette repoet, offentlig
> produktmateriale og priser fra leverandørene (hentet 2026-08 til 2026-11),
> samt uavhengige oversikter. Competitorpriser er veiledende og endres ofte;
> flere er «quote only». Der kilden er usikker, står det eksplisitt.
>
> **Ikke en benchmark:** Dette er en funksjons- og posisjoneringsanalyse, ikke
> en ytelses-, sikkerhets- eller brukertest av konkurrentene.

---

## 1. Kort konklusjon

FSM-plattformen er en **modulær, selvhostet og bevisorientert FSM for norske
service- og installasjonsbedrifter i små og mellomstore segmenter**. Den dekker
hele kjeden fra kunde og oppdrag til signert servicerapport, avtale/SLA,
kundeportal, tilbud, faktura, lager, utlegg, lønnsomhet og revisjonsbevis – i
én app og én database.

Sammenlignet med **Jobber, Housecall Pro, Zoho FSM og Praxedo** har vi bredere
dybde i servicebevis, utstyrshistorikk, avtaler/SLA, revisjon, GDPR-sletting,
dokumenthåndtering og selvhosting. Betalingslenker (Stripe/Vipps),
ruteoptimalisering med trafikk-ETA og regnskapssynk er levert som v1, men vi
mangler fortsatt deres mest salgbare overflatefunksjoner: finansiering og
refusjon/capture i appen, bankavstemming, markedsføring, moden mobilapp i
butikk, dynamisk omruting/turn-by-turn og et stort integrasjonsøkosystem.

Sammenlignet med **ServiceTitan** har vi lavere kostnad, enklere innføring og
datakontroll, men mangler prisbok med good/better/best, avansert dispatch, AI,
finansiering, provisjon, markedsføring og den kommersielle modenheten.

Sammenlignet med **Salesforce Field Service, Microsoft Dynamics 365 Field
Service, ServiceMax, IFS og Oracle Field Service** har vi langt lavere
kompleksitet og kostnad og en tydeligere FSM-kjerne, men mangler AI-basert
optimalisering, IoT/prediktivt vedlikehold, ERP-dybde og multi-tenant skala.
SAML 2.0 SP, SCIM 2.0 Users+Groups, feltnivå-RBAC, S3/MinIO-lagring,
Redis-varsling/cache med DB-fallback samt HA- og PITR-skript finnes som v1,
men er ikke verifisert eller øvd mot ekte tjenester og mangler
enterprise-driftsbevis.

Sammenlignet med **Fieldly og Next** har vi servicekontrakter, SLA, utstyr,
servicerapporter, portal og revisjon, men mangler deres
bygg-/installasjonsprosjekt, bemanningsregister, EDI og lønnsintegrasjoner.

**Anbefalt posisjon:** «Suveren, revisjonsklar FSM for norske
servicebedrifter som vil eie dataene sine» – ikke en billig Jobber-klone og
ikke en enterprise-suite.

---

## 2. Plattformprofil

| Egenskap | FSM-plattformen |
| --- | --- |
| Produkttype | Modulær monolitt, én app + én PostgreSQL-database per installasjon |
| Stack | Next.js 16, React 19, TypeScript, Prisma 7, PostgreSQL, Tailwind-basert designsystem |
| Kjøring | Docker Compose, Caddy/TLS, Azure-guide, backup/restore-skript |
| Klienter | Responsiv web, PWA og native Android/iOS i eget `fsm-mobile`-repo, med servervalg ved oppstart og 7 døgns offline-cache |
| Språk | Norsk, engelsk, polsk, tysk (nb/en/pl/de) |
| Valuta/format | NOK, norsk MVA og norske adresser; CSV til regnskap/lønn |
| Lisens | BUSL-1.1 (source-available, ikke OSI-open source) |
| Moduler | 22 nøkler: kjerne + 21 av-/påslåbare, med avhengigheter og presets |
| Datamodell | 116 Prisma-modeller, 27 enums, additive migreringer |
| Flater | 91 `page.tsx`, 94 API-ruter |
| Tester | 403 testfiler / 3 269 enhetstester + 41 filer / 224 integrasjonstester mot ekte PostgreSQL, 13 E2E-spesifikasjoner |
| CI | Typesjekk, lint, i18n, enhet, integrasjon, Playwright E2E, axe/Lighthouse, Docker, Trivy |
| Sikkerhet | 2FA, OIDC SSO, SAML 2.0 SP, SCIM 2.0 Users+Groups, feltnivå-RBAC, API-nøkler med scopes, rate limits, hash-kjedet revisjon, legal hold, GDPR-sletting, PDF-sanering, opplastingskvoter |
| Multi-tenant | Nei – én installasjon per kunde/organisasjon; avdelinger gir intern isolasjon |

### 2.1 Arkitektur

Plattformen er bevisst en **modulær monolitt**. Det gir:

- én database og én transaksjonsgrense for oppdrag, rapport, faktura og revisjon;
- enkel selvhosting og datakontroll;
- moduler som kan slås av uten datatap;
- lavere driftskompleksitet enn mikrotjenester.

Prisen er at skala, isolasjon og uavhengig deploy av funksjoner er svakere enn
en multi-tenant SaaS. Kø og rate limits har database som standard og kilde til
sannhet, med valgfri Redis som vekkemekanisme og cache; uten Redis faller alt
tilbake til databasen. Lagring kan kjøre på lokal disk eller S3/MinIO. Det
finnes ingen egen worker-tjeneste – in-process workere er dokumentert trygge
fordi databasen og Redis er delt. `docker-compose.ha.yml`, WAL-arkiv og
PITR-skript finnes, men er ikke øvd mot ekte tjenester.

### 2.2 Modenhet per område

| Område | Modenhet | Kommentar |
| --- | --- | --- |
| Oppdrag, kunder, ansatte, avdelinger | Høy | Kjerne, godt testet, dagens arbeidsflyt |
| Kalender, dispatch, rute/ETA | Middels–høy | FullCalendar 7, dispatch, kapasitet, ruteplan, OSRM + valgfri Google Routes, trafikk-ETA og 2-opt; ikke dynamisk omruting eller turn-by-turn |
| Servicerapporter, sjekklister, signatur, PDF | Høy | Revisjoner, enheter, bilder, signatur, PDF, HMS |
| Utstyr og servicehistorikk | Høy | Enhetskort, målinger, garanti, vedlikeholdsplaner, flytting med historikk |
| Avtaler, SLA, bookinger | Høy | Gjentakende service, SLA-policyer, bookingkø, datoforespørsler |
| Kundeportal | Høy | Bestillinger, rapporter, dokumenter, utstyr, avtaler, faktura, tilbud, sporing, omtaler |
| Tilbud og faktura | Middels–høy | Versjoner, portalgodkjenning, MVA, delbetaling, kreditnota, Stripe/Vipps-betalingslenke, CSV, print |
| Lager og innkjøp | Middels–høy | Beholdning, reservasjon/forbruk, leverandør, innkjøpsordre, varemottak |
| Tid, reise, utlegg, lønn | Middels–høy | Arbeidsdager, reisetid, kjøretur, utlegg, godkjenning, lønn-CSV |
| BI og lønnsomhet | Middels | Estimat + faktisk omsetning, intern kostnadssats for estimert resultat, timer/reise, first-time-fix, CSV; ingen kostnadsdata per oppdrag |
| Dokumenter og søk | Høy | Mapper, tags, versjoner, OCR, fulltekstsøk |
| SMS og varsler | Høy | Toveis SMS, webhook, samtykke, påminnelser, kontorinnboks |
| Sikkerhet og personvern | Høy | 2FA, OIDC/SAML, SCIM Users+Groups, felt-RBAC, audit-kjede, legal hold, GDPR-sletting, API-scopes |
| Integrasjoner | Middels | REST-API v1 (kunder, oppdrag, eksterne ordrer, tilbud, lager, avtaler, utstyr, dokumenter, rapporter, visiter, SLA-policyer, vedlikeholdsplaner, `me`), Stripe/Vipps-betalingslenker, regnskapssynk (Fiken/Tripletex/PowerOffice Go/CSV) og CSV; e-faktura/Peppol og utgående webhooks mangler |
| AI og prediktivt | Ingen | Ingen Copilot, optimalisering, IoT eller prediktivt vedlikehold |
| Skala og HA | Lav–middels | In-process workere, DB-kø med Redis-varsling/cache og DB-fallback, lokal/S3-lagring; HA-/PITR-skript finnes, men er ikke øvd |

---

## 3. Konkurrentlandskapet

### 3.1 Segmenter

| Segment | Typiske leverandører | Kjennetegn |
| --- | --- | --- |
| SMB håndverk/service | Jobber, Housecall Pro, Zoho FSM, Workiz, FieldPulse | Lav pris, rask onboarding, betalinger, markedsføring, mobilapp |
| Mid-market trades | ServiceTitan, Service Fusion, Simpro, Praxedo | Dispatch, prisbok, jobbkost, lager, provisjon, integrasjoner |
| Enterprise FSM | Salesforce Field Service, Microsoft Dynamics 365 FS, ServiceMax, IFS, Oracle Field Service | AI-optimalisering, ERP/CRM, IoT, SLA/entitlements, global skala |
| Nordisk bygg/installasjon | Fieldly, Next, Bygglet, Struqtur | Prosjekt, bemanning, timelister, EDI, lønnsunderlag, ID06/personalliggare |
| Selvhostet/sovereign | FSM-plattformen, noen regionale aktører | Datakontroll, revisjon, tilpasning, ingen per-bruker SaaS |

### 3.2 Leverandørprofiler

#### Jobber

- **Pris (publisert, 2026):** Core fra ca. 29–49 USD/mnd, Connect 99–139,
  Grow 149–199, Plus 399–499; 1–15 brukere, +29 USD per ekstra bruker.
- **Styrker:** Enkel scheduling, innebygd ruteoptimalisering, tilbud/faktura,
  betalinger, kundekommunikasjon, automatiseringer, QuickBooks/Xero, API på
  Plus, AI-resepsjonist.
- **Svakheter:** Grunn lager/innkjøp, lite utstyrslivssyklus, ingen dyp
  servicekontrakt/SLA, ikke enterprise, begrenset selvhosting.
- **Relevant for oss:** Den viktigste SMB-målestokken. Vi slår Jobber på
  servicebevis, utstyr, avtaler/SLA, revisjon, lager og selvhosting; Jobber slår
  oss på betalingsdybde, dynamisk ruteoptimalisering, mobilpolish og økosystem.

#### Housecall Pro

- **Pris (publisert, 2026):** Basic 59–79 USD/mnd, Essentials 149–189,
  Max 299–329; 1–8 brukere, +35 USD per ekstra bruker.
- **Styrker:** Rask onboarding, online booking, betalinger/finansiering,
  prisbok, jobbkost, anmeldelser, GPS, ruteoptimalisering på Max, åpent API.
- **Svakheter:** Ikke dyp enterprise, lager/innkjøp og utstyrslivssyklus er
  begrenset, mange verdifulle funksjoner er add-ons.
- **Relevant for oss:** Sterk på kundereise og betaling. Vi må matche
  betalingsdybde og direkte booking før vi kan vinne prisbevisste SMB-kunder
  som vil ha «alt i ett».

#### Zoho FSM

- **Pris:** Gratis opptil 20 brukere/30 avtaler per måned; betalt fra ca.
  30–55 USD per organisasjon, volume-/avtalebasert.
- **Styrker:** Lav inngangspris, Zoho-økosystem, work orders, dispatch,
  estimates, invoices, mobile, rapporter, API.
- **Svakheter:** Generisk oppsett, mindre dyp FSM, avtaleprising kan bli
  uforutsigbar; mindre egnet for komplekse servicekontrakter.
- **Relevant for oss:** Vi er dyrere i drift, men dypere i servicebevis,
  avtaler/SLA, lager, revisjon og selvhosting.

#### Praxedo

- **Pris (publisert, 2026):** ca. 35–129 GBP/EUR per bruker/mnd, minimum
  5 brukere.
- **Styrker:** Europeisk mid-market, scheduling/dispatch, offline mobil,
  kundeportal, ruteplan, ERP/CRM-konnektorer, ISO 27001, AI i høyere nivåer.
- **Svakheter:** Minimum 5 brukere, ingen gratis prøve, AI og avansert
  scheduling først på høyere nivåer.
- **Relevant for oss:** Nærmeste europeiske funksjonelle sammenligning i
  mid-market. Vi har mer servicebevis/audit og lavere terskel; Praxedo har
  mer moden scheduling, integrasjoner og drift.

#### ServiceTitan

- **Pris:** Quote only; rapportert ca. 245–500 USD per tekniker/mnd +
  implementering 5 000–50 000 USD, 12+ måneders binding.
- **Styrker:** Bransjedybde (HVAC, VVS, elektro), dispatch, prisbok,
  good/better/best, medlemskap, betalinger/finansiering, lager/PO, payroll,
  provisjon, markedsføring, jobbkost, rapporter, AI.
- **Svakheter:** Høy kostnad og implementeringstid, lange kontrakter,
  mindre egnet for små team og ikke-tradisjonelle serviceområder.
- **Relevant for oss:** Vi kan ikke matche dybden i trades-økonomi. Vi kan
  vinne kunder som ikke trenger prisbok/markedsføring, men som trenger
  servicebevis, norsk tilpasning, datakontroll og lav TCO.

#### Salesforce Field Service

- **Pris:** Listepriser fra ca. 25 USD for enkelte FSM-lisenser, men
  dispatcher/technician ca. 175 USD, Field Service Plus ca. 230,
  Agentforce 1 FS ca. 650; implementering og SI kommer i tillegg.
- **Styrker:** CRM-native, AI/Agentforce, scheduling/optimization, SLA,
  kontraktører, offline mobil, AppExchange, global skala.
- **Svakheter:** Høy total kostnad, krevende implementering, FSM er en del av
  en større plattform; offline og portal krever konfigurasjon.
- **Relevant for oss:** Vi konkurrerer ikke på enterprise-skala. Vi kan vinne
  kunder som vil unngå Salesforce-kompleksitet og konsulentkostnad.

#### Microsoft Dynamics 365 Field Service

- **Pris:** ca. 105 USD per bruker/mnd; contractor ca. 50; Resource Scheduling
  Optimization ca. 30 per ressurs/mnd.
- **Styrker:** Microsoft-økosystem, Power Platform, Copilot, IoT/Connected
  Field Service, ERP-integrasjon (Business Central/Finance), inventory/returns,
  agreements, time tracking, offline mobil, enterprise drift.
- **Svakheter:** Kompleksitet, lisens- og partnerkostnad, krevende
  konfigurering; enkelte integrasjoner fases ut/endres.
- **Relevant for oss:** Sterk for Microsoft-kunder. Vi er enklere og billigere,
  men mangler Power Platform-utvidbarhet og ERP-dybde.

#### ServiceMax (PTC)

- **Pris:** Quote only; enterprise.
- **Styrker:** Asset-centric installed base, kontrakter, warranties, RMA,
  depot repair, field service, offline mobil, Salesforce-plattform, AI.
- **Svakheter:** Enterprise-kostnad og kompleksitet; ikke SMB.
- **Relevant for oss:** Vi har en enklere asset-/servicehistorikk, men ikke
  RMA/depot-repair eller installed-base-suite.

#### IFS Field Service Management

- **Pris:** Quote only.
- **Styrker:** Asset-intensive service, scheduling, contracts, spare parts,
  warranties, billing, ERP/CRM-integrasjon, AI, komplekse serviceprosjekter.
- **Svakheter:** Enterprise-implementering, kostnad, mindre egnet for små team.
- **Relevant for oss:** Samme konklusjon som ServiceMax: vi er enklere, men
  grunnere.

#### Oracle Field Service

- **Pris:** Quote only.
- **Styrker:** AI-basert scheduling/routing, capacity/booking, spares,
  preventive maintenance, barcode, tredjepartsressurser, global skala.
- **Svakheter:** Enterprise-kompleksitet og kostnad; Oracle-økosystem.
- **Relevant for oss:** Vi har grunnleggende rute/ETA, men ikke Oracle-nivå
  optimalisering eller spares-planlegging.

#### Fieldly

- **Pris (publisert, 2026):** ca. 219–699 SEK per bruker/mnd, minste antall
  brukere på høyere nivå.
- **Styrker:** Nordisk bygg/installasjon, arbeidsordrer, prosjekt, timelister,
  faktura, sjekklister, byggdagbok, digitale signaturer, lønnsunderlag,
  personalliggare/ID06, EDI, økonomiintegrasjon.
- **Svakheter:** Prosjekt-/byggfokus, ikke dyp servicekontrakt/SLA,
  utstyrslivssyklus eller FSM-dispatch på samme måte.
- **Relevant for oss:** Sterk i bygg og installasjon. Vi bør ikke konkurrere
  på byggdagbok/ID06 uten en egen modul; vi vinner på service og vedlikehold.

#### Next (Next One Technology)

- **Pris:** Fra ca. 2 100 SEK per selskap/mnd; høyere pakker 4 195–6 295.
- **Styrker:** Prosjekt, tid, faktura, ressursplanlegging, dokumenter,
  endringsordrer (ÄTA), entreprenørøkonomi.
- **Svakheter:** Byggprosjekt, ikke felt-service med SLA/utstyr i samme grad.
- **Relevant for oss:** Samme som Fieldly: godt for prosjektbedrifter, men
  ikke en direkte FSM-konkurrent for serviceavtaler.

---

## 4. Funksjonsmatrise

Forklaring: **✅** = innebygd og dokumentert · **◐** = delvis, add-on,
integrasjon eller begrenset · **—** = ikke dokumentert / ikke relevant.

| Kapabilitet | FSM-plattformen | Jobber / Housecall Pro / Zoho | ServiceTitan | Salesforce / Dynamics 365 | ServiceMax / IFS / Oracle | Fieldly / Next |
| --- | --- | --- | --- | --- | --- | --- |
| Oppdrag og statusflyt | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kalender og dispatch | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| Drag-and-drop dispatch | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| Ruteplan og ETA | ✅ | ✅ / ◐ | ✅ | ✅ | ✅ | ◐ |
| Ruteoptimalisering med trafikk | ◐ 2-opt + trafikk-ETA; ikke dynamisk omruting | ✅ Jobber / ◐ HCP | ✅ | ✅ | ✅ | — |
| Kompetanse-/sertifiseringsmatch | ◐ | ◐ | ✅ | ✅ | ✅ | — |
| SLA, avtaler og entitlements | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Forebyggende vedlikehold | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Tilbud og versjoner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Good/better/best og prisbok | — | ◐ | ✅ | ◐ | ◐ | — |
| Tilbudsgodkjenning i portal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Faktura, MVA og kreditnota | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ |
| Kortbetaling/PSP/finansiering | ◐ Stripe/Vipps-lenker; ikke refusjon/capture/void | ✅ | ✅ | ◐ | ◐ | — |
| Regnskap/ERP-integrasjon | ◐ Fiken/Tripletex/PowerOffice Go/CSV; ikke toveis | ✅ QuickBooks/Xero | ✅ | ✅ | ✅ | ✅ |
| E-faktura/Peppol | — | — | ◐ | ◐ | ◐ | ◐ |
| Lager og beholdning | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Innkjøp, leverandør og varemottak | ✅ | — / ◐ | ✅ | ✅ | ✅ | ◐ |
| Utstyrs- og servicehistorikk | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Garanti og installed base | ✅ | ◐ | ✅ | ✅ | ✅ | — |
| RMA/depot-repair | — | — | ◐ | ◐ | ✅ | — |
| Mobilapp i butikk | ◐ Capacitor/PWA | ✅ | ✅ | ✅ | ✅ | ✅ |
| Offline feltarbeid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rapporter, sjekklister og signatur | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Servicerapport som PDF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kundeportal og selvbetjening | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Online booking med direkte slot | — Bevisst datoforespørsel | ✅ | ✅ | ✅ | ✅ | ◐ |
| Toveis SMS og påminnelser | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ |
| Dokumentbibliotek, versjoner og OCR | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ |
| Tid, reise, kjøretur og utlegg | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lønn/provisjon | ◐ CSV | ◐ | ✅ | ◐ | ◐ | ✅ |
| BI, KPI og lønnsomhet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fri rapportbygger | — | ◐ | ✅ | ✅ | ✅ | ◐ |
| AI/Copilot og prediktivt | — | ◐ | ✅ | ✅ | ✅ | — |
| IoT og tilstandsovervåking | — | — | ◐ | ✅ | ✅ | — |
| Anmeldelser og markedsføring | ◐ omtaler | ✅ | ✅ | ◐ | ◐ | — |
| REST-API | ✅ | ✅ / ◐ | ✅ | ✅ | ✅ | ✅ |
| Utgående webhooks | — | ◐ | ✅ | ✅ | ✅ | ◐ |
| SSO/OIDC | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| SAML | ✅ SP; IdP-metadata via env | — | ✅ | ✅ | ✅ | — |
| SCIM-brukerprovisjonering | ✅ | — | ◐ | ✅ | ✅ | — |
| SCIM-grupper | ✅ | — | ◐ | ✅ | ✅ | — |
| Revisjonslogg med kjede/legal hold | ✅ | ◐ | ◐ | ✅ | ✅ | ◐ |
| GDPR-sletting med legal hold | ✅ | ◐ | ◐ | ✅ | ✅ | ◐ |
| Avdelingsisolering | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Multi-tenant/white-label | — | ✅ (SaaS) | ✅ | ✅ | ✅ | ✅ |
| Selvhosting/datakontroll | ✅ | — | — | — | ◐ private cloud | — |
| Modulær av/på uten datatap | ✅ | — | ◐ | ◐ | ◐ | — |
| Flerspråklig UI | ✅ nb/en/pl/de | ◐ | ◐ | ✅ | ✅ | ◐ |
| Norsk MVA/NOK/adresser | ✅ | ◐ | ◐ | ◐ | ◐ | ✅ |

---

## 5. Arkitektur, drift og sikkerhet

### 5.1 Hvor vi er sterkere

- **Datakontroll og selvhosting.** Kunden kan kjøre app og database selv,
  uten amerikansk SaaS-avhengighet. Det er et reelt salgsargument i offentlig
  sektor, helse, forsvar, industri og virksomheter med strenge
  personvernkrav.
- **Beviskjeden.** Signerte rapporter, revisjoner, PDF, hash-kjedet revisjon,
  legal hold, bevis-eksport og GDPR-sletting henger sammen. Jobber/HCP/Zoho
  har ikke samme dybde; enterprise har det, men til en helt annen kostnad.
- **Utstyr og servicehistorikk.** Enheter kan flyttes med hele historikken,
  og rapporter/revisjoner/PDF følger med. Det er en reell forskjell mot
  adressebaserte SMB-verktøy.
- **Modulær prismodell.** Kjerne-only eller full installasjon, uten å droppe
  data. Egnet for kunder som vil starte smått og vokse.
- **Norsk først.** Kartverket/Nominatim/Photon, norske adresser, NOK, MVA,
  SMS-leverandører (Link Mobility, PSWinCom, Twilio), norsk supportflate.
- **Ingeniørkvalitet.** Sterk testdekning, integrasjonstester mot ekte
  PostgreSQL, CI med E2E, tilgjengelighet og Docker-skanning.

### 5.2 Hvor vi er svakere

- **Betalinger og økonomi.** Stripe/Vipps-betalingslenker og regnskapssynk
  (Fiken/Tripletex/PowerOffice Go/CSV, med retry) er levert som v1. Det som
  mangler er dybde: refusjon/capture/void, bankavstemming, kreditnota/refusjon
  til regnskap, leverandørfaktura, toveis synk, konfigurerbar MVA-kartlegging
  og e-faktura/Peppol. Betalinger er foreløpig NOK-only. CSV alene er ikke
  nok for de fleste SMB-kjøpere.
- **AI og optimalisering.** Ingen scheduling-optimering, Copilot, prediktivt
  vedlikehold eller IoT. Dette er bordstake i enterprise og i ferd med å bli
  det i mid-market.
- **Mobil.** Native Android-/iOS-prosjekter i `fsm-mobile` har runtime
  servervalg og sjudøgns offline-cache, men signert butikkbygg, push,
  bakgrunnssynk og enhets-QA gjenstår før de er på Jobber/HCP-nivå.
- **Integrasjoner.** REST-API v1, PSP og regnskapssynk finnes, men ikke
  utgående signerte webhooks, e-faktura/Peppol, CRM-konnektorer eller et
  konnektorbibliotek/markedsføringsverktøy.
- **Skala.** In-process workere, databasekø med valgfri Redis og
  lokal/S3-lagring er på plass, og `docker-compose.ha.yml`, WAL-arkiv og
  PITR-skript finnes.
  Men HA/PITR/restore er ikke øvd mot ekte Postgres/S3/Redis, og Redis er en
  vekkemekanisme med DB-fallback, ikke en egen køtjeneste. Det er greit for
  titalls samtidige brukere, ikke for global SaaS.
- **Enterprise-governance.** SAML 2.0 SP, SCIM 2.0 Users+Groups, OIDC og
  feltnivå-RBAC er levert som v1. Residualene er Entra group overage,
  IdP-metadata bare via miljøvariabler, ingen ekte tenant i CI, ingen
  redigerbar feltmatrise, ingen separation of duties og ingen formelle
  sertifiseringer (ISO 27001/SOC 2) med driftsbevis.
- **Kommersiell modenhet.** BUSL-lisens, ingen offentlig prisliste, ingen
  partnerøkosystem, ingen 24/7 SLA eller implementeringsorganisasjon.

---

## 6. Pris og total kostnad (TCO)

Tallene under er veiledende og hentet fra offentlig materiale i 2026. De er
ikke et tilbud og må verifiseres hos leverandøren.

| Løsning | Publisert pris | Implementering | Merknad |
| --- | --- | --- | --- |
| FSM-plattformen | Ikke publisert; BUSL-lisens + egen drift | Egen/partner | Infra kan kjøres på én liten VM + PostgreSQL; ingen per-bruker SaaS-avgift |
| Jobber | 29–529 USD/mnd etter nivå og brukere | Lav | Rask onboarding, add-ons og betalingsgebyr kommer i tillegg |
| Housecall Pro | 59–329 USD/mnd etter nivå og brukere | Lav | Mange funksjoner er add-ons; betalingsgebyr |
| Zoho FSM | Gratis/30–55 USD per org + volum | Lav–middels | Avtaleprising kan bli uforutsigbar |
| Praxedo | 35–129 EUR/GBP per bruker/mnd, min. 5 | Middels | AI/scheduling først på høyere nivå |
| ServiceTitan | ca. 245–500 USD per tekniker/mnd | 5 000–50 000 USD | 12+ måneders binding; høy TCO |
| Salesforce FS | 25–650 USD per bruker/mnd | Høy (SI) | Reell kostnad avhenger av lisenser, add-ons og partner |
| Dynamics 365 FS | ca. 105 USD per bruker/mnd + RSO 30 | Middels–høy | Power Platform/partnere kommer i tillegg |
| ServiceMax / IFS / Oracle | Quote only | Høy | Enterprise-suite; typisk sekssifret årskostnad |
| Fieldly | ca. 219–699 SEK per bruker/mnd | Lav–middels | Bygg/installasjon; minsteantall på høyere nivå |
| Next | ca. 2 100–6 295 SEK per selskap/mnd | Middels | Prosjekt/bygg; per selskap, ikke per bruker |

**TCO-konklusjon:** For en norsk servicebedrift med 5–30 teknikere er
FSM-plattformen potensielt svært konkurransedyktig på lisens og infrastruktur,
men krever at kunden har (eller kjøper) drift, backup og oppgradering. Jobber
og Housecall Pro er billigere å komme i gang med, men koster per bruker og
mangler dybden. ServiceTitan og enterprise-suitene er en helt annen liga i
både pris og kompleksitet.

---

## 7. Posisjonering: når vinner vi, og når taper vi?

### 7.1 Vi vinner når kunden

- må eie dataene eller kjøre på egne servere (offentlig sektor, industri,
  helse, forsvarsleverandører, konsern med strenge krav);
- har serviceavtaler, SLA, utstyr og dokumentasjonskrav, ikke bare enkle jobs;
- trenger signerte rapporter, revisjonsspor, legal hold og GDPR-sletting;
- vil ha norsk språk, norsk MVA, norske adresser og norske SMS-leverandører;
- vil unngå per-bruker SaaS-kostnad og enterprise-konsulenter;
- vil starte med kjerne (oppdrag, kunder, rapporter) og slå på moduler senere;
- verdsetter én database og enkel arkitektur fremfor et integrasjonssmarkedsplass.

### 7.2 Vi taper når kunden

- forventer full PSP-flyt med refusjon/capture, finansiering, bankavstemming
  og e-faktura/Peppol, ikke bare betalingslenker og regnskapssynk;
- vil ha en ferdig mobilapp med push og butikkdistribusjon;
- trenger dynamisk omruting, turn-by-turn, AI-scheduling eller prediktivt
  vedlikehold;
- er en stor enterprise med ERP, IoT, multi-tenant, separation of duties,
  sertifiseringer og 24/7 SLA;
- driver bygg/installasjonsprosjekt og trenger byggdagbok, ID06,
  bemanningsregister og EDI (Fieldly/Next er bedre);
- trenger markedsføring, lead-gen, anmeldelseskampanjer og prisbok med
  good/better/best i ServiceTitan-klasse;
- ikke vil drifte noe selv og ikke har en partner.

### 7.3 Konkurransekart

```text
Høy fagdybde / enterprise
        ▲
        │   Salesforce FS   Dynamics 365   ServiceMax   IFS   Oracle
        │
        │                 ServiceTitan
        │        Praxedo
        │   FSM-plattformen        Fieldly / Next
        │
        │   Jobber   Housecall Pro   Zoho FSM
        └────────────────────────────────────────────▶
        Lav pris/compleksitet            Høy pris/compleksitet
```

FSM-plattformen ligger bevisst i «middels kompleksitet, høy datakontroll og
servicebevis» – ikke i lavpris-SMB og ikke i enterprise.

---

## 8. Gap-analyse og prioritert veikart

Prioriteringen er basert på hva som faktisk avgjør dealer i målgruppen, ikke
hva som er teknisk morsomt. P3-punkter krever eiergodkjenning.

### P0 – nødvendig for å konkurrere i SMB/mid-market (0–3 måneder)

1. **Produksjonsbevis for betalinger og regnskap**
   - Stripe/Vipps-lenker og Fiken/Tripletex/PowerOffice Go/CSV-synk er levert
     som v1. Verifiser ende-til-ende med ekte PSP- og regnskapskontoer.
   - Utdyp deretter: refusjon/capture/void, bankavstemming, kreditnota/
     refusjon til regnskap og konfigurerbar MVA-kartlegging.
   - Hvorfor: uten produksjonsbevis taper vi fortsatt Jobber/HCP-dealer som
     forventer at betaling og avstemming «bare virker».
2. **Produksjonsbevis for e-post, SMS og push**
   - Durabel e-postutboks er levert og tilbud, faktura, booking og
     arbeidsordre sendes automatisk. Verifiser SMTP, FCM/APNs og
     leverandørfeilmoduser mot ekte tjenester.
3. **Signer og publiser mobilappen**
   - Native prosjekter, servervalg og 7-dagers cache er levert; signering,
     FCM/APNs, butikkinnhold og enhetstest gjenstår.
4. **Verifiser ruting, trafikk og optimalisering**
   - OSRM, valgfri Google Routes, trafikk-ETA, 2-opt, manuell ruterekkefølge
     og overtidsplanlegging er levert. Verifiser mot ekte trafikk-kilde og
     avgrens tydelig at dynamisk omruting og turn-by-turn ikke er levert.
5. **Rapport-/PDF-løft**
   - Fri rapportbygger eller minst flere faste rapporter og PDF-eksport av BI.

### P1 – styrker posisjonen mot mid-market (3–6 måneder)

6. **AI-assistent og scheduling-forslag**
   - Oppsummer oppdrag, foreslå tekniker, flagg risiko, svar på naturlig språk.
7. **Prisbok og good/better/best**
   - Gjenbruk tilbudslinjer, marginer og pakker.
8. **Kundeinitiert booking med valgbar direkte bekreftelse**
   - Dagens datoforespørsel er bevisst; tilby direkte slot som opt-in.
9. **Enterprise-governance: verifiser og gjør redigerbar**
   - SAML 2.0 SP, SCIM 2.0 Users+Groups, OIDC og feltnivå-RBAC er levert v1.
     Lukk residualene: Entra group overage, IdP-metadata via admin-UI, ekte
     IdP i CI, redigerbar feltmatrise og separation of duties.
10. **Driftsmodenhet: øv HA, PITR og restore**
    - `docker-compose.ha.yml`, S3/MinIO, Redis og PITR-skript finnes. Kjør
      restore-/failover-øvelse mot ekte Postgres/S3/Redis, mål RTO/RPO og
      etabler SLO/on-call.
11. **Utgående webhooks og API-dybde**
    - Signerte webhooks med retry/DLQ mangler. Legg til `invoices`/`expenses`
      i API v1 og CRM-konnektorer slik at kunder kan koble systemene sine.

### P2 – langsiktig differensiering (6–12 måneder)

12. **Multi-tenant/white-label**
    - Hvis vi vil selge til tjenesteleverandører eller franchiser.
13. **E-faktura/Peppol, KID/OCR og bankavstemming**
14. **IoT, tilstandsovervåking og prediktivt vedlikehold**
15. **Bygg-/installasjonsmodul** (byggdagbok, ID06, bemanning, EDI)
    - Bare hvis vi vil inn i Fieldly/Next-segmentet.
16. **Markedsplass/partnerøkosystem og sertifiseringer (ISO 27001/SOC 2)**

### Hva vi ikke bør gjøre

- Ikke prøv å matche ServiceTitan på prisbok, markedsføring og
  provisjonslogikk uten en egen trades-strategi.
- Ikke bygg multi-tenant før en konkret kunde eller partner betaler for det.
- Ikke fjern datoforespørsel-modellen; gjør direkte booking til et valg.
- Ikke love enterprise-HA eller compliance-sertifisering før det er levert.

---

## 9. Styrker, svakheter og risiko

### 9.1 Styrker (bevis)

| Styrke | Bevis |
| --- | --- |
| Full servicekjede i én app | Kunde → oppdrag → arbeidsdag/tid → rapport/PDF → avtale/SLA → tilbud → faktura → portal |
| Revisjonsklarhet | Hash-kjedet audit, legal hold, bevis-eksport, GDPR-sletting med blokkering |
| Utstyrsdybde | Enhetskort, målinger, garanti, vedlikeholdsplan, flytting med historikk |
| Selvhosting | Docker, Caddy, backup/restore, Azure-guide, ingen SaaS-avhengighet |
| Modulær | 22 moduler, avhengigheter, `core`/`full`, data bevares |
| Norsk først | NOK, MVA, Kartverket, norske SMS-leverandører, nb/en/pl/de |
| Kvalitet | 3 257 enhetstester, 222 integrasjonstester, 12 E2E-spesifikasjoner, axe/Lighthouse, Trivy |
| Sikkerhet | 2FA, OIDC, SAML 2.0 SP, SCIM 2.0 Users+Groups, feltnivå-RBAC, API-scopes, rate limits, kvoter, PDF-sanering |

### 9.2 Svakheter (risiko)

| Svakhet | Risiko | Tiltak |
| --- | --- | --- |
| PSP/regnskap v1 uten dybde | Taper SMB-dealer ved refusjon og avstemming | P0: produksjonsbevis + refusjon/capture/bankavstemming |
| E-post uten leverandørbevis | Friksjon hvis SMTP/retry feiler | P0: verifiser SMTP, bounce og retry |
| Mobil ikke i butikk | Lavere opplevd kvalitet | P0: signert app + push |
| Ingen AI/optimalisering | Taper mid-market/enterprise | P1: assistent + scheduling |
| SAML/SCIM uten enterprise-bevis | Blokkert i større innkjøp | P1: ekte IdP, overage, metadata-UI, SoD |
| HA/PITR ikke øvd | Skaleringsrisiko | P1/P2: restore-/failover-øvelse med målte RTO/RPO |
| Ingen ISO/SOC | Compliance-krav | P2 |
| BUSL-lisens | Kan skremme noen kjøpere | Tydelig kommersiell modell og støtteavtale |
| Ingen offentlig prisliste | Vanskeligere selvbetjent kjøp | Publiser pakker eller «fra»-pris |
| Én utvikler/organisasjon | Leverandørrisiko | Partner-/driftsavtale, dokumentert runbook |

### 9.3 Konkurranserisiko

- **Jobber/HCP** beveger seg oppover mot mer avansert service og AI. Hvis de
  får dypere utstyr/SLA, blir vårt vindu mindre.
- **ServiceTitan** og **Dynamics/Salesforce** presser AI og automatisering ned
  i pris. Det gjør «ingen AI» stadig vanskeligere å forsvare.
- **Fieldly/Next** eier det nordiske bygg-/installasjonssegmentet. Å gå inn
  der uten prosjekt-, bemannings- og EDI-modul er kostbart.
- **Regionale aktører** (Praxedo, FieldService Danmark, SuperOffice
  FieldService, AddMobile, Lime field) konkurrerer på lokal tilstedeværelse,
  integrasjoner og drift.

---

## 10. Anbefalt go-to-market

1. **Velg en smal idealprofil:** norsk service-/vedlikeholdsbedrift med 5–50
   teknikere, serviceavtaler, utstyr og dokumentasjonskrav. Ikke «alle».
2. **Selg bevis, ikke bare effektivitet:** signert rapport, revisjonsspor,
   legal hold, GDPR, utstyrsflytting og datakontroll.
3. **Publiser en enkel prismodell:** for eksempel kjerne per installasjon,
   modulpakker og supportnivå – ikke per bruker. Det gjør oss forutsigbare
   mot SaaS.
4. **Tilby managed hosting:** fjern driftsbyrden for kunder som vil ha
   selvhosting uten å drifte selv.
5. **Verifiser og utdyp de tre viktigste integrasjonene:** Vipps/Stripe,
   Fiken/Tripletex/PowerOffice og e-post. De er levert som v1; bygg ikke et
   konnektorbibliotek på måfå før produksjonsbeviset er på plass.
6. **Bruk modulene i salget:** start kjerne, slå på tilbud/faktura, deretter
   lager/utlegg/BI. Det senker terskelen og viser verdi trinnvis.
7. **Vær ærlig om grensene:** ikke lov enterprise-HA, AI, Peppol eller full
   regnskapsavstemming før det er levert. Det er et salgsargument at
   dokumentasjonen er presis.

---

## 11. Konklusjon

FSM-plattformen er **funksjonelt bredere enn sin størrelse tilsier**, med en
uvanlig sterk kombinasjon av servicebevis, utstyr, avtaler/SLA, revisjon,
personvern og selvhosting. Den er ikke en fullverdig erstatning for
ServiceTitan, Salesforce Field Service eller Dynamics 365 i enterprise, og
heller ikke en billigere Jobber/Housecall Pro for kunder som først og fremst
vil ha full betalingsflyt, markedsføring og en polert mobilapp.

Det strategiske rommet er tydelig: **norske og europeiske servicebedrifter som
trenger dokumenterbar service, datakontroll og lav TCO – og som er villige til
å bytte bort noe av SMB-polish og enterprise-AI for det.** Neste steg er
produksjonsbevis og utdyping av det som allerede er levert: ekte
PSP-/regnskaps-/SMTP-/SAML-/S3-/Redis-verifisering, restore-/PITR-øvelse,
signert mobilapp, PSP-dybde, e-faktura/Peppol og utgående webhooks. Deretter
P1: AI-assistent, prisbok, direkte booking som opt-in og
enterprise-governance (ekte IdP, redigerbar feltmatrise, separation of
duties). Den samlede køen og akseptansekriteriene er `docs/BACKLOG.md`.

---

## Vedlegg A: Kilder

Hentet 2026-11-08. Priser og funksjoner kan være endret.

- ServiceTitan – priser: <https://www.servicetitan.com/pricing>
- ServiceTitan – funksjoner: <https://www.servicetitan.com/features>
- ServiceTitan – uavhengig prisoversikt: <https://tradesoftwarelab.com/hvac/servicetitan-review/>
- Jobber vs Housecall Pro: <https://www.getjobber.com/comparison/jobber-vs-housecall-pro/>
- Jobber-priser (via uavhengig gjennomgang): <https://tradeaiguide.com/jobber-vs-housecall-pro/>
- Housecall Pro-priser (via uavhengig gjennomgang): <https://www.kumohq.co/blog/jobber-vs-housecall-pro-vs-servicetitan-vs-custom-field-service-app-2026>
- Salesforce Field Service: <https://www.salesforce.com/service/field-service-management/software/>
- Salesforce vs Dynamics: <https://www.erpresearch.com/erp-add-ons/field-service/dynamics-365-field-service-vs-salesforce-field-service>
- Microsoft Dynamics 365 Field Service: <https://learn.microsoft.com/en-us/dynamics365/field-service/overview>
- Dynamics 365-priser/status: <https://zapai.io/dynamics-365-field-service-guide/>
- ServiceMax: <https://www.servicemax.com/platform>
- IFS – markedsoverblikk: <https://blog.ifs.com/top-6-field-service-management-platforms-for-2026/>
- Oracle Field Service: <https://www.oracle.com/cx/service/field-service-management/>
- Zoho FSM: <https://www.zoho.com/fsm/>
- Zoho FSM-priser: <https://www.capterra.com/p/10014004/Zoho-FSM/pricing>
- Fieldly – priser: <https://no.fieldly.com/pricing>
- Fieldly – produkt: <https://en.fieldly.com/>
- Praxedo – priser: <https://www.praxedo.com/pricing>
- Capterra – FSM-priser 2026: <https://www.capterra.com/resources/field-service-management-software-pricing-models/>
- FSM-news – markedsoverblikk 2026: <https://fsm-news.com/news/best-field-service-management-software>
- Interne kilder: `README.md`, `docs/MODULES.md`, `docs/BACKLOG.md`,
  `docs/OPERATIONS.md`, `docs/REV.md`, `docs/INVENTORY.md`,
  `docs/PAYROLL_EXPORT.md`, `docs/BI.md`, `docs/privacy-erasure.md`,
  `prisma/schema.prisma`, `src/lib/modules.ts`.

## Vedlegg B: Forbehold

- Konkurrentenes funksjoner er vurdert fra offentlig produktmateriale, ikke
  fra en felles testlab. «✅» betyr at leverandøren dokumenterer funksjonen,
  ikke at den er like dyp eller god som vår.
- Priser er listepriser i USD/EUR/GBP/SEK der de er publisert; norske priser,
  rabatter, bindingsperioder og implementeringskostnader varierer.
- Vår egen vurdering er basert på koden i `master`/`dev` per 2026-11-08.
  v1-funksjoner med dokumenterte residualer og P3-punkter regnes ikke som
  fullt leverte.
- Analysen er ikke juridisk rådgivning om BUSL-lisensen eller GDPR.
