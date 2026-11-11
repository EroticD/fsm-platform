# Endringslogg

Alle vesentlige endringer i FSM-plattformen dokumenteres her.
Versjoner følger `package.json` og git-taggene `v<versjon>`.

## Unreleased (dev)

### Revisjonslogg
- Alle 22 direkte skrivinger til `AuditLog` går nå gjennom `audit()` eller
  `auditStandalone()`. Rader fra innlogging, 2FA, SSO, SAML, SCIM, roller,
  avdelinger og break-glass ligger dermed i hash-kjeden; `audit:verify` er
  grønn og `audit-write-paths.test.ts` hindrer tilbakefall.
- Nye felter på `AuditLog`: `ip`, `userAgent`, `requestId`, `outcome`,
  `actionCode`, `retentionClass` og `targetUserId`. Avviste og feilede
  handlinger logges med `outcome: DENIED`.
- Nye hendelser: feilet innlogging, låst/inaktiv konto, feil TOTP og
  gjenopprettingskode, avvist SSO, SCIM-authfeil, utlogging og sesjonsutløp.
- Utlevering logges: filer via `/uploads`, rapport-/avtale-PDF, faktura-CSV,
  portalens CSV-eksport og kundeoverføring (bygg, nedlasting og dekryptering).
  Lesing og eksport av revisjonsloggen logges også.
- Forretningsdata logges med før/etter: kunde, utstyr, avtale, rolle,
  rettigheter, faktureringsinnstillinger og lager. Serviceavtaler bruker nå
  `entityType: "Contract"` i stedet for `"Customer"`.
- Retensjonsklasser: `ACCOUNTING_5Y` (fem år), `SECURITY_1Y`, `OPS_90D`.
  Global verdi er gulv, ikke tak.
- `audit:backfill -- --rebuild` regner kjeden på nytt når en rad har laget
  forgrening; kjørt på utviklingsdatabasen og verifisert.

### Feilrettinger
- **Lukking av oppdrag rydder hele livssyklusen.** Rapporter som fullfører
  oppdraget på stedet, knytter nå på samme rydding som manuell statusendring:
  pågående visiter lukkes, returkjøring avsluttes, offentlige sporingslenker
  tilbakekalles og SLA-klokken løses – i samme transaksjon. Tidligere ble
  oppdraget stående som aktivt i lister, kalender og sporing.
- **Kansellering fra bookingkøen og kundeportalen** bruker samme rydding.
  Før ble bare én visitt kansellert, og sporingslenke og SLA-klokke ble stående.
- **Gjenåpning gir oppdraget en aktiv visitt igjen.** Lukkingen markerer
  hvilke visiter den selv lukket (`Visit.autoClosedAt`). Ved gjenåpning settes
  bare disse tilbake – til `ASSIGNED` når de hadde montør, ellers `PLANNED`.
  Reise- og tilstedetidspunktene nullstilles og bevares i revisjonsloggen, så
  en manuelt kansellert visitt ikke vekkes og en gammel retur ikke henger igjen.
- **SLA-oppryddingen erstatter feil klokke** i stedet for bare å kansellere den.
  Erstatningsklokken beholder opprinnelig start- og responstidspunkt og får
  tilstanden regnet fra fristene, så et forfalt oppdrag ikke blir seende friskt
  ut. Oppdrag som allerede er lukket hoppes over.
- **Feltappens hjemlenke peker på feltflaten.** `BrandedHeader` bruker
  mobilvarianten av hjemplanen for montører, så logo og brødsmuler ikke lenger
  sender montøren til kontordashbordet.
- Ryddingen er samlet i `closeWorkOrderState` / `reopenWorkOrderState` og brukes
  av alle veier som lukker eller gjenåpner et oppdrag.
- Nytt idempotent skript `npm run repair:closed-work-orders` retter rader som
  allerede henger. Tørrkjøring er standard; `--apply` skriver. Lukkestatusene
  leses fra `WorkOrderStatusSetting`.
- Ingen datamigreringer er nødvendige.

## 0.9.2 — 2026-11-11

**Utgivelsessammendrag:** 0.9.2 retter innloggingsredirecten, stopper
enroute, returkjøring og offentlig sporing når et oppdrag fullføres eller
lukkes, gir teknikeren kontordashbord på datamaskin og «I dag» på mobil, og
innfører feltspesifikke skjemafeil med oppsummering, fokus og inline-melding.
Ingen datamigreringer er nødvendige.

### Skjemafeil
- Ny felles skjemavalidator viser en oppsummering øverst med antall feil,
  hvilket felt som er feil og hva som må rettes. Første feil får fokus, og
  meldingen vises også rett under feltet.
- Validatoren er tatt i bruk på oppdrag (kontor og felt), kunde, utstyr,
  faktura, tilbud, booking, bookinger og de viktigste innstillingsskjemaene.
- Serverfeil for faktura og tilbud viser nå den konkrete årsaken (låst,
  ikke kladd, beløp over utestående, duplikatnummer, utløpt lenke osv.) i
  stedet for en generisk «Handlingen kunne ikke fullføres».
- Duplikat ordrenummer og ugyldig sluttdato vises direkte på riktig felt i
  oppdragsskjemaet.

### Feilrettinger
- Innlogging havner ikke lenger tilbake på `/logg-inn` når NextAuth eller en
  beskyttet side sender en `callbackUrl` som peker på login- eller
  auth-endepunktet. Slike mål avvises, og brukeren sendes til rollens hjem.
- Montører får kontordashbordet på datamaskin og `/mine-oppdrag` på mobil.
  En eksplisitt, trygg `callbackUrl` overstyrer fortsatt enhetsvalget.
- Når et oppdrag fullføres eller lukkes, avsluttes aktive visiter og
  returkjøring i samme transaksjon. Offentlige sporingslenker tilbakekalles,
  og dashbord, kart og sporing ignorerer gamle «på vei»-rader på lukkede
  oppdrag.

## 0.9.1 — 2026-11-08

**Utgivelsessammendrag:** 0.9.1 samler designsystemet på tvers av alle
kontorsider, fullfører UX-08 (FullCalendar 7 visuell QA) og UX-09
(live-kartets forutsetninger), og gjør `docs/BACKLOG.md` til eneste
arbeidskø. Utgivelsen inneholder også oppdatert plattformanalyse,
fagdokumentasjon, skjermbilder og PDF-manualer. Ingen funksjoner er fjernet
og ingen datamigreringer er nødvendige.

### Design, UX og tilgjengelighet
- Ny felles kontorramme `PageShell` og oppdatert `PageHeader` med
  `type-title-1`, brytbar tittel og eyebrow. Alle kontorsider bruker samme
  maksbredde, luft og vertikale rytme.
- `Card`, `Button`/`buttonClassName`, `Field`, `StatusBadge`, `EmptyState` og
  `ErrorBanner` er konsolidert. Knapper har variantene primær, sekundær,
  ghost, fare og fare-outline; skjemafelt får synlig `required`-markør og
  `aria-required`.
- 12 px tekstgulv innført (`text-2xs`), rå felt-hex erstattet med
  `--field-line`, og gamle `min-h-screen`-sidemaler og Command Center-hex
  fjernet fra kontorflatene.
- `docs/DESIGN.md` dokumenterer de nye primitivene og `--field-line`,
  statusflatene og typografiklassene.
- **UX-08:** FullCalendar 7 viser riktig dato og ISO-ukenummer i begge
  ukeradene i to-ukersvisningen, også på mobil. Timegrid åpner på 07:00 i en
  rullbar beholder, og korte hendelser beholder tid/tittel uten å klippe.
  Ny E2E-dekning i `e2e/calendar-visual.spec.ts`.
- **UX-09:** live-kartets tomtilstander forklarer både avdelingens sporing og
  montørens «Del posisjon», med lenker til innstillinger og feltflaten.
  Negative tester dekker gamle pinger, avsluttede visiter og avdeling med
  sporing av.

### Dokumentasjon og backlog
- Ny `docs/BACKLOG.md` er eneste kilde til gjenstående arbeid: leverte ting,
  åpne P1/P2/P3-oppgaver, avhengigheter, akseptansekriterier og
  eierbeslutninger.
- Fjernet utdaterte backlog-, baseline- og overføringsdokumenter, samt den
  gamle OpenAPI-baselinen fra 0.8.0. Innholdet er migrert til den nye køen.
- `PLATFORM-ANALYSIS.md` er oppdatert med faktiske tall og status for 0.9.0,
  inkludert P2 v1, API v1, SAML/SCIM, felt-RBAC, S3/Redis/HA/PITR og
  konfigurerbare oppdragsstatuser.
- Fagdocs for tilbud, regnskap, push, lønn, lager og BI er rettet mot faktisk
  kode, og manualens kundeoverføringstekst beskriver den durabelige
  bakgrunnsjobben. PDF-manualene er bygget på nytt.

## 0.9.0 — 2026-11-08

**Utgivelsessammendrag:** 0.9.0 samler dev-arbeidet til en modulær
plattform med P2 v1 (tilbud, fakturering, lager, utlegg, lønnsomhet og
kundeoverføring), betalinger og regnskapssynk, vedvarende e-postutboks og
pushvarsler, ruting på OpenStreetMap/OSRM med valgfri Google Routes API og
overtidsplanlegging, manuell ruterekkefølge, SAML 2.0/SCIM-grupper og
feltnivå-RBAC, S3/Redis/HA/PITR, API v1 for tilbud, ordrer og lager,
konfigurerbare oppdragsstatuser og kunde-/kontaktisolasjon. Manualen og
skjermbildene er oppdatert for utgivelsen.

### Konfigurerbare oppdragsstatuser
- Ny adminfane **Oppdragsstatus** der hver innebygde status kan merkes som
  åpen, planlagt eller lukket, aktiveres/deaktiveres og sorteres.
- Standardoppsettet er uendret: OPEN/PENDING er åpne, PLANNED/WAITING/
  IN_PROGRESS er planlagte, og COMPLETED/CANCELLED er lukkede.
- Nye oppdrag starter som **PENDING** (åpen, venter på planlegging). Standard
  status kan endres i samme fane, men kan ikke være en lukket status.
- Lister, søk, rapporter, portal, varsler, ruting og låsing bruker den
  konfigurerte lukkefunksjonen i stedet for hardkodede COMPLETED/CANCELLED.
- Endringer revideres, og minst én åpen og én lukket status må være aktiv.

### Kunde- og kontaktisolasjon
- Tilbuds- og fakturaskjemaene viser ikke kontaktfeltet før en kunde er valgt.
- Kontaktene hentes per valgt kunde fra et serveravgrenset endepunkt og
  filtreres på nytt i klienten; kontakter fra andre kunder kan ikke vises
  eller sendes inn.
- Innstillinger for nye kundeportalbrukere bruker samme kunde-først-velger.
- Serveren avviser fortsatt kontakt som ikke tilhører kunden, og fakturakladder
  kan nå også fjerne en kontakt.

### Manuell rute og rekkefølge
- Ruteplanleggeren har nummerfelt per stopp (1/2/3/4). Lagring normaliserer
  rekkefølgen, lagrer `Visit.routeSequence` og flytter tidspunktene med samme
  revisjonssporede tjenestelag som «Bruk rekkefølge».
- Oppdragsdetaljen har tilsvarende rekkefølgenummer per arbeidsdag under
  «Dager og tid». Nummeret lagres uten å flytte tid; ruteplanleggeren bruker
  det ved neste visning.
- Automatisk optimalisering brukes fortsatt når ingen manuell rekkefølge er
  satt. Manuell rekkefølge respekterer overtid, tidsvinduer, overlapp og
  fravær, og alle endringer revideres.

### API, testing og P2-titler
- API v1 har fått tilbud, eksterne ordrer og lager: `/api/v1/quotes`,
  `/api/v1/orders` og `/api/v1/inventory/**`, med egne scopes, idempotente
  ordremottak, `Idempotency-Key`, OpenAPI og avdelings-/kundeisolasjon.
  Eksterne ordresystemer kan sende ordrer med `source` + `externalId` og få
  samme ordre tilbake ved replay. Se `docs/API.md`.
- Ny modulbasert testflyt: `npm run test:changed` og
  `npm run test:module -- <modul>` mapper endrede filer til berørte tester.
  PR-er og `dev` kjører bare berørte tester; full dekning og integrasjon
  kjøres fortsatt på `master` og release-tagger. Se `docs/TESTING.md`.
- P2-titler er fullført i navigasjon og modulinnstillinger på nb/en/pl/de.
  Stale «(P2)»/«ikke levert»-tekster er fjernet, og modulbeskrivelsene
  beskriver levert funksjonalitet.
- Ruting bruker nå OpenStreetMap/OSRM og valgfri Google Routes API for
  trafikkbevisst ETA. TomTom/HERE er fjernet. Planlegging kan legge oppdrag
  utenfor tidsvindu/arbeidstid som overtid i stedet for å la dem stå
  ufordelte; overtiden vises per stopp og i rutesammendraget.
- `docs/BACKLOG.md` samler åpne gap med prioritering, evidens og anbefalt
  neste arbeid.

### Betalinger, e-post, push og ruting
- Faktura kan få betalingslenke via Stripe Checkout eller Vipps MobilePay.
  Webhooker signaturverifiseres, er idempotente og registrerer delbetalinger
  gjennom den eksisterende betalingsflyten. Kundeportalen viser «Betal» når
  leverandøren er konfigurert. Se `docs/PAYMENTS.md`.
- Regnskapssynk v1 for Fiken, Tripletex og PowerOffice Go, med CSV som
  eksplisitt eksportfallback. Synken er manuell, idempotent og revideres. Se
  `docs/ACCOUNTING.md`.
- Transaksjons-e-post går gjennom en vedvarende utboks med retry/backoff for
  tilbud, faktura, betaling, booking og tildeling. Admin kan slå av/på hver
  hendelse, velge avsender/reply-to og sende test. Se `docs/EMAIL.md`.
- Server-side pushvarsler via FCM HTTP v1 og APNs, med enhetsregistrering,
  token-opprydding, durabel utboks og dype lenker. Mobilappen registrerer
  tokens og håndterer varseltrykk. Se `docs/PUSH.md`.
- Ruteoptimalisering med tidssoner, kompetanse, prioritet og arbeidstid.
  Visiter som ikke rekker tidsvinduet eller arbeidstiden planlegges med
  overtid i stedet for å bli ufordelte, med konfigurerbar grense. Ruting er
  OpenStreetMap/OSRM, og trafikkbevisst ETA kan hentes fra Google Routes API
  med OSRM/haversine-fallback. Endelig rekkefølge brukes først etter
  eksplisitt, revidert handling. Se `docs/ROUTING.md`.
### SAML 2.0, SCIM-grupper og feltnivå-RBAC v1
- SAML 2.0-tjenesteleverandør med `@node-saml/node-saml`: per-leverandør
  konfigurasjon, SP-metadata, ACS og innloggingsrute, signert assertion,
  audience/recipient/tidsvindu, databasebasert replay-vakt og eksplisitt
  gruppe→rolle/avdeling. OIDC-oppsettet er urørt.
- SCIM 2.0 Groups med list/get/create/replace/patch/delete, RFC 7644-filter,
  paginering, SCIM-feilformat, samme bearer-token som Users, revisjon og
  gruppekrav på brukerressursen. Medlemskap gir bare tilgang gjennom
  `SCIM_GROUP_ROLE_MAP`/`SCIM_GROUP_DEPARTMENT_MAP`; ADMIN krever fortsatt
  `SCIM_ALLOW_ADMIN=true`.
- Feltnivå-RBAC v1 for kundekontakt, faktura-/betalingsbeløp,
  rapportsignaturer og lønns-/utleggsbeløp. Serveren maskerer før API, søk,
  eksport og UI; ADMIN/OFFICE beholder dagens tilgang, montører og
  kundeportalen får minste privilegium. Se `docs/RBAC.md`.
- Additiv migrering `20261109094000_saml_scim_groups_rbac` for SCIM-grupper og
  SAML-cache.
### Infrastruktur: S3, Redis og HA/PITR
- Opplastinger går gjennom et felles `StorageDriver`-grensesnitt med lokal
  disk (standard) og S3/MinIO. `/uploads/<filnavn>` og lagrede nøkler er
  uendret. `npm run storage:migrate` kopierer og verifiserer eksisterende
  filer. Se `docs/STORAGE.md`.
- PDF-køen kan varsles via Redis (`QUEUE_DRIVER=redis`), og rate limits/cache
  kan bruke Redis. Databasen er fortsatt standard og fallback; ingen jobb
  avhenger av at Redis er oppe.
- Ny HA-profil `docker-compose.ha.yml` med app-replikaer, Caddy, Redis,
  delt S3 og Postgres WAL-arkivering. Verifisert base-backup og
  `restore-pitr.sh` med RPO/RTO og øvelsessjekkliste i
  `docs/BACKUP-RESTORE.md` og `docs/SCALING.md`.
- `DATABASE_POOL_MAX` styrer DB-tilkoblinger per appprosess.
- Ekte S3, Redis og PITR-restore er ikke verifisert uten legitimasjon/miljø;
  se restrisiko i `docs/BACKLOG.md` (PLAT-01/02/06).

### Native Android- og iOS-app flyttet til eget repo
- Android- og iOS-appen ligger nå i det egne repoet `fsm-mobile`. Plattformen
  inneholder ikke lenger Capacitor-prosjekter, skall eller signeringsfiler.
- Appen starter på en lokal oppsettside der brukeren skriver inn
  FSM-serverens URL; adressen lagres native og er ikke bygget inn.
- Serveradressen kan endres fra tannhjulet i appen.
- Plattformens service worker cacher nå alle samme-opprinnelse GET-sider,
  API-GET og filer under `/uploads/` i **7 døgn** per bruker. Cacheene slettes
  ved utlogging, utløpt økt og «Bytt server», og appen ber om persistent
  lagring.
- Bygg og signering er dokumentert i `fsm-mobile`-repoet.

### Residualer etter P2 v1
- Lønnsomhet viser nå faktisk omsetning fra fakturaer side om side med
  estimatet når `invoicing` er på. Netto fakturert beløp uten MVA, kreditnotaer
  trekkes fra, kladder telles ikke, og CSV/audit merker om faktisk tall finnes.
- Tilbud har fått utskriftsvisning `/tilbud/[id]/skriv` med samme print-til-PDF-
  flyt som fakturaene.
- Kundeoverføring støtter Ed25519-signaturer i tillegg til HMAC, med
  modusvalg, nøkkelrotasjon og stabile feilkoder. Importpanelet har
  passfrasefelt for krypterte `.fsmenc`-pakker.
- Lager har fått leverandørregister, innkjøpsordrer og varemottak. Delvis og
  fullt mottak øker beholdningen atomisk, overmottak avvises, og alle
  overganger revideres.
- Opplastingskvoten reserveres atomisk, slik at samtidige opplastinger ikke
  lenger kan overskride grensen. Avviste opplastinger frigjør kvoten og etterlater
  ingen filer.
- Eldre tidsstyrte enkeltdagsvisiter kan normaliseres med et tørrkjørings-først-
  skript; tvetydige rader rapporteres uten å endres.
- P2-fragmentene for tilbud, fakturering, lager, utlegg og lønnsomhet er
  oversatt til polsk og tysk.

### Modulær plattform, personvern og P2 v1
- Ny modulkatalog med kjerne og av-/påslåbare moduler, `ModuleState`,
  admin-fane, avhengighetsvalidering, audit, `MODULE_PRESET`, gating av
  navigasjon, innstillinger, sider, actions, API, søk, eksport/import og
  bakgrunnsjobber. Kjernen (kunder, oppdrag, arbeidsdager/tid, revisjon,
  innstillinger) kan kjøres uten valgfrie moduler.
- Ny `docs/MODULES.md` med katalog, avhengigheter, presets og
  oppgraderingsløp. Eksisterende installasjoner får alle leverte moduler på.
- GDPR-sletting/anonymisering (DATA-01): admin-only forhåndsvisning,
  legal-hold-blokkering, transaksjonell anonymisering, idempotens og
  revisjonsspor.
- DOC-01 er avstemt: nye bookinger er datoforespørsler, direkte
  slotbekreftelse er fjernet for nye bestillinger, og overlapp er en
  opptatt-markering.
- P2 v1: tilbud (`/tilbud`), fakturering (`/faktura`), lager (`/lager`),
  kjøring/utlegg (`/utlegg`), lønnsomhet (`/lonnsomhet`) og herdet
  kundeoverføring med durable jobber, signatur, valgfri AES-GCM-kryptering,
  versjonsmigrering og filavstemming. Funksjonene er modulgatede og har
  dokumenterte residualer (bl.a. ingen PSP/regnskapsintegrasjon, ingen
  leverandørfaktura og ingen ekstern lønnstjeneste).

## 0.8.11 — 2026-11-08

### Arbeidsdager, tid og SLA
- Oppdrag planlegges nå som rene datoer: **Dato for utførelse** og eventuell
  **Til dato**. Hver dato blir én arbeidsdag med egen intern økt, også når
  oppdraget strekker seg over flere dager. Kontoret oppretter, flytter eller
  sletter ikke enkeltdager; datoperioden avstemmes automatisk, og dager med
  startet eller registrert tid gir en tydelig konflikt i stedet for sletting.
- Kontorsiden har fått skrivebeskyttet **Dager og tid** med én rad per
  arbeidsdag, status, tidsstempler og summer for arbeid, kjøring til, kjøring
  fra og totalt. Den gamle visittplanleggingen er fjernet fra oppdragsdetaljen.
- Feltkortet følger **På vei → På stedet → Ferdig**, deretter **Avslutt
  kjøring**. Tiden registreres per dag. Neste dags økt kan startes selv om en
  tidligere dag venter på avsluttet kjøring; neste `EN_ROUTE` lukker forrige
  reisesegment, slik at flere jobber samme dag deler reisetid uten dobbelttelling.
- Summeringen inkluderer all reisetid. Kalenderen tegner hver arbeidsdag som
  egen hendelse med faktisk start, slutt og varighet når tid er registrert.
- SLA starter bare når oppdraget har en aktiv, datogyldig avtale med en aktiv
  SLA-policy. Det er ikke lenger fallback til avdelingens standardpolicy eller
  en global policy. Respons registreres på `EN_ROUTE`/`ON_SITE`, løsning på
  `DONE`; returkjøring flytter ikke klokken.
- Ny opprydding `npm run sla:cleanup` (tørrkjøring som standard, `--apply` for
  å skrive) kansellerer ikke-kansellerte SLA-klokker uten gyldig avtaledekning
  eller med en annen policy enn avtalen gir. Hver endring revisjonslogges, og
  kansellerte klokker ignoreres av sveiping, dispatch og SLA-panelet.
- Oppryddingen kjører nå automatisk fra scheduleren (standard hvert sjette
  døgn, `SLA_CLEANUP_INTERVAL_HOURS`; `SLA_CLEANUP_ENABLED=false` slår av).
  Kjøringen er advisory-låst og idempotent, lagres i `SlaCleanupRun`, og
  eksponerer siste kjøring, kansellert antall, feil og stale-signal i
  `/api/metrics` med Prometheus-alarmer. CLI-en består som diagnoseverktøy.
- Kundebestillinger er nå dokumentert og implementert som rene
  datoforespørsler: den ikke-nåbare direkte slotbekreftelsen er fjernet, alle
  ventende forespørsler planlegges og bekreftes av kontoret, overlapp er en
  opptatt-markering, og `BookingHold` brukes bare ved ombooking av en allerede
  bekreftet avtale.
- Engangsbackfill `npm run visits:backfill:daily` splitter eldre flerdagers
  heldagsvisiter til én økt per dag uten å kopiere tidsstempler.

### Kalender: FullCalendar 7
- Kalenderen bruker nå `fullcalendar` 7.1.4 og `temporal-polyfill` i stedet for
  de fire `@fullcalendar/*` v6-pakkene. Klassisk tema registreres som
  v7-plugin, og skeleton-, tema- og palett-CSS importeres én gang i
  `globals.css`.
- Verktøylinjen bruker v7s `start`/`center`/`end` og `buttons` (tekst, hint og
  klasse) i stedet for `buttonText`/`buttonHints`. Hendelser og dager styles
  gjennom v7s offentlige klassehooks (`eventClass`, `rowEventClass`,
  `dayCellClass`, `dayLaneClass` …) og `--fc-classic-*`-variabler. Gamle
  v6-selektorer som `.fc-daygrid-*` og `.fc-toolbar-*` er fjernet.
- Hendelsesfarger bruker `color`/`contrastColor` og statusprikk i tillegg til
  farge. Dato- og ukenummerformatering er flyttet til `calendar-format.ts`
  fordi v7 kollapser overskrifter på smale kolonner og sender feil dato til
  `dayHeaderContent` i to-ukersvisningen.
- E2E-testene bruker `data-testid="calendar-event"` og `.kal-day-cell[data-date]`
  i stedet for v6-klasser, og dra-og-slipp venter til v7s første `datesSet` er
  ferdig. Uke- og to-ukersvisningene beholder høyde og ukenumre også etter
  v7s `min-height: 0 !important` på dagnettet.

## 0.8.10 — 2026-11-04

### Geokoding
- Geokoding bruker nå en leverandørkjede: Nominatim → Kartverket → Photon.
  Blokkert eller utilgjengelig Nominatim gjør ikke lenger at alle adresser
  feiler stille.
- Kartverket brukes med gate, postnummer og kommune for autoritative norske
  adresser; Photon er siste fallback.
- Knappen på kartet viser nå hvorfor geokoding feilet (ingen treff, timeout,
  utilgjengelig eller deaktivert) i stedet for «0 adresser».
- Geokoding ved oppretting/redigering av oppdrag bruker samme fallback og
  logger en stabil feilkode uten adresse/PII.

## 0.8.9 — 2026-11-04

### Kundeadskillelse og enhetsflytting
- Steds- og enhetsvelgere henter bare data for valgt kunde; all informasjon
  lastes server-side og valideres på nytt ved lagring. Ingen andre kunders
  steder eller enheter sendes til nettleseren.
- Kundekortet har søkbare lister for steder og enheter.
- Ny flytteflyt for enhet: hele enheten (og eventuell underenhet) flyttes med
  oppdrag, rapporter/revisjoner/PDF, målinger, vedlikeholdsplaner, dokumenter,
  vedlegg og QR-koder. Aktive kontraktslinjer blokkerer flytting, og alle
  handlinger revideres.

### Kamera og QR
- Kamera blokkeres ikke lenger av `Permissions-Policy`; iOS/Android får
  kameraforhåndsspørsel på `/skann`.
- BarcodeDetector brukes når den finnes, med ZXing som fallback på Safari og
  andre nettlesere som mangler API-et. Tydelige feil for HTTPS, nekting,
  manglende kamera og dekodingsfeil.

### Rettelser
- Opplasting: standardkvotene ble feilaktig regnet i byte i stedet for MB, så
  reelle bilder/PDF-er fikk 507. Standard er nå 2 GiB per bruker og 10 GiB per
  kunde, med tydelige proxy-/serverfeil i klienten.
- PDF: rapporter og revisjoner kan vises trygt i appen (`?inline=1`) etter
  sanitering, med nedlasting som eget valg. Direkte nedlasting er fortsatt
  standard for ukjente klienter.
- Kundeoverføring: eksport dedupliseres per kundeutvalg/valg, feil lagres på
  jobben og vises i UI, og første forsøk blokkeres ikke av gamle tellere.
  Grensen er 10 starter/time med versjonert nøkkel.
- Feltapp: navnet på featured-oppdraget og korttitlene åpner oppdraget.

### Dokumentasjon og skjermbilder
- README er forenklet med Docker quick start, Caddy, flytting av database og
  datavolum, og oppdatering til ny versjon.
- Brukermanualene (nb/en) er oppdatert med nye funksjoner og regenererte PDF-er.
- Skjermbilder er regenerert for alle sider i desktop/mobil, nye sider er lagt
  til, og utdaterte eksperimentmapper er fjernet.

## 0.8.8 — 2026-11-03

### Toveis SMS og påminnelser
- Innkommende SMS med leverandørsignatur, idempotens, leveringsstatus,
  STOP/START-samtykke og kobling mot kunde/kontakt/tråd.
- Kontorinnboks kan lese og svare på tråder med avdelings-/kundescope.
- Konfigurerbare påminnelsesregler per avdeling (SMS/e-post, 24 t/2 t,
  stille timer, maks per besøk) med durabel utsending, dedupe og historikk.

### SSO og SCIM
- OIDC SSO med Entra ID, Keycloak, Authentik og Zitadel; discovery, PKCE,
  state/nonce, verifisert e-post-kobling og eksplisitt rolle-/gruppemapping.
- SCIM 2.0 for brukerprovisjonering med hash-lagrede token, rotasjon,
  filtrering/paginering, deaktivering og SCIM-feilformat.
- Admin-fane for SSO/SCIM, break-glass innlogging og revisjon.

### Feltapp, navigasjon og strekkode
- `/skann` med BarcodeDetector/kamera og manuell fallback; QR-token og
  oppdragsreferanse løses med vanlig tilgangskontroll.
- Naviger til Apple Maps/Google Maps/geo, kopier adresse og ring kunde.
- PWA-forbedringer, installasjons-/oppdateringsflyt og Capacitor-skalldokumentasjon
  for Android/iOS.

### Eksisterende QR-koder på utstyr
- Kunder kan registrere QR-verdier som allerede sitter på porter, dører og
  maskiner, med valgfri etikett og flere koder per enhet.
- Feltappens skanner slår opp egne token/referanser først, deretter de
  registrerte eksterne kodene, og autoriserer alltid enheten på nytt.
- Kodeverdier er globalt unike, kan slettes eksplisitt og følger med i
  kundeoverføringspakken.

### PDF-rapporter
- Rettet feil der bilder og signaturer manglet i ferdige PDF-er: PDF-byggeren
  tolket arbeidsoppdraget feil og hoppet over bildeforberedelsen.
- Data-URL-bilder og lokalt opplastede bilder bygges nå inn, også i
  revisjons-PDF-er. Cached PDF-er regenereres automatisk.
- Manglende bilder gir en synlig advarsel i PDF-en og en stabil
  driftslogg-hendelse i stedet for stille utelatelse.

### Rute og sanntids ETA
- Ruteplanlegger `/kalender/rute` med nearest-neighbour + 2-opt, kjøretid,
  distanse, ventetid og ETA per stopp; valgfri OSRM med lokal fallback.
- «Bruk rekkefølge» flytter bare flyttbare besøk, med overlapp-/fraværssjekk
  og revisjon.
- Offentlig ETA i sporingen basert på siste posisjonsping, med eksplisitt
  ferskhet og planlagt tid når sanntidsdata mangler.

## 0.8.6 — 2026-11-03

### Kundeoverføring (CUST-EXPORT-01 v1)
- Admin-only eksport og import av kundepakker som ZIP med `manifest.json`,
  sjekksummer, deterministiske JSON-filer og innholdsadresserte filer.
- Dry-run med konfliktanalyse før skriving; import i én databasetransaksjon
  med nye ID-er, id-remapping, filstaging og rollback.
- Dekker kunde, kontakter, steder, portaldelegering, utstyr, målinger,
  vedlikeholdsplaner, kontrakter, oppdrag, besøk, rapporter/revisjoner/PDF,
  dokumenter/versjoner og vedlegg.
- Avviser blant annet path traversal, MIME-spoofing, sjekksumavvik,
  zip-bomber og ugyldige krysskundereferanser. Ingen passord, hasher, 2FA-,
  sesjons- eller API-hemmeligheter følger pakken.

### Sikkerhet
- Krypterte offline-kladder og outbox med AES-GCM og PIN-beskyttet nøkkel,
  inkludert låsing etter omstart/idle og migrering av eldre kladder.
- PDF-er leveres som vedlegg og saneres for aktivt innhold.
- Strømmende opplasting med harde grenser og per-bruker/kunde-kvoter.
- API-nøkler med scopes, skrivebeskyttelse, levetid, rotasjon og audit.
- Påkrevd 2FA kan slås på for `ADMIN`/`OFFICE` med dokumentert break-glass.
- Same-origin-sjekken godtar samme-origin `Referer` når `Origin` mangler.

### Drift og data
- Hash-kjedet revisjonslogg med oppbevaringsregler, legal hold, verifisering
  og admin-eksport.
- Signert bevis-eksport per oppdrag med manifest og SHA-256.
- Automatiserte backuper med sjekksum, ferskhetskontroll og varsling.
- `/api/metrics`, varselregler og trusted proxy-konfigurasjon.
- Separate runtime- og migrasjonsroller for PostgreSQL; readiness nekter
  DDL-kapabel runtime-rolle i produksjon.

### Produkt og UX
- Bemanning/kompetanse, arbeidstid, fravær og kapasitetsplaner.
- Portaldelegering per kontakt og administrerbare kundesteder.
- Planlegg og bekreft datoforespørsler direkte i bookingkøen.
- Vedlikeholdsplaner kan redigeres/slettes; utstyrsfilter bevares.
- Full dispatch-innstillinger, omtaler for ansatte, bookingbekreftelse på
  e-post, iCal med én hendelse per besøk og PDF-sidesøk.
- Utvidet a11y/E2E-dekning og API-/OpenAPI-kontrakttest.

### Kvalitet
- 2 360 enhetstester, 74 integrasjonstester mot ekte PostgreSQL og
  86 E2E-tester (2 skipped) verifisert.
- Strict i18n for nb/en/pl/de, typecheck, lint og produksjonsbygg grønt.
- Ny fragmentvakt sikrer at alle i18n-fragmenter faktisk flettes inn.

### Kjente begrensninger
- Kundeoverføring er synkron/in-memory (500 MiB pakke, 50 MiB per fil) og
  har ingen pakkekryptering/signatur eller bakgrunnsrekonciliering.
- Signaturbilder i kundepakker er opt-in; kilde-audit er kun proveniens.
- Se `docs/BACKLOG.md` for gjenstående arbeid (blant annet
  GDPR-sletting og bookingpolicy).

## 0.8.5 — 2026-11-02
- Søkbar og synlig oppdragsreferanse på tvers av kontor, felt og PDF.
- Forbedret bookingflyt med datoforespørsler og standardvisitt.
- Dokumentert arbeidsliste og spesifikasjon for kundeoverføring.

## 0.8.0
- Første samlede plattformutgave med oppdrag, kalender, feltapp/PWA,
  kundeportal, dokumenter, rapporter, utstyr, avtaler, SMS, sporing,
  API v1 og selvdriftsoppsett.
