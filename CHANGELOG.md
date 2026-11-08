# Endringslogg

Alle vesentlige endringer i FSM-plattformen dokumenteres her.
Versjoner følger `package.json` og git-taggene `v<versjon>`.

## Unreleased (dev)

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
  se restrisiko i `docs/remaining-features.md` (PLAT-01/02/06).

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
- Se `docs/remaining-features.md` for gjenstående arbeid (blant annet
  GDPR-sletting og bookingpolicy).

## 0.8.5 — 2026-11-02
- Søkbar og synlig oppdragsreferanse på tvers av kontor, felt og PDF.
- Forbedret bookingflyt med datoforespørsler og standardvisitt.
- Dokumentert arbeidsliste og spesifikasjon for kundeoverføring.

## 0.8.0
- Første samlede plattformutgave med oppdrag, kalender, feltapp/PWA,
  kundeportal, dokumenter, rapporter, utstyr, avtaler, SMS, sporing,
  API v1 og selvdriftsoppsett.
