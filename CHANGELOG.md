# Endringslogg

Alle vesentlige endringer i FSM-plattformen dokumenteres her.
Versjoner følger `package.json` og git-taggene `v<versjon>`.

## Unreleased (dev)

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
