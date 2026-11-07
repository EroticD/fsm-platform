# Endringslogg

Alle vesentlige endringer i FSM-plattformen dokumenteres her.
Versjoner følger `package.json` og git-taggene `v<versjon>`.

## Unreleased (dev)

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
