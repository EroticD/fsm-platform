# Beslutninger og avgrensninger

Denne filen oppsummerer valg som ble tatt under P2/P3-arbeidet, og hva som
bevisst er utsatt. Den er ment som grunnlag for neste planleggingsrunde.

> **Aktuell UI-arbeidskjø ligger i `docs/ui-ux-backlog.md`.** Nye UI-oppgaver
> føres der; denne filen dokumenterer bare beslutninger og avgrensninger.

## Fullført i denne runden

- **P2-B2** – full i18n for hovedflatene. `node scripts/check-i18n.mjs` er
  grønn på paritet: 2 851 nøkler i både nb og en. Hardkodede norske strenger
  rapporteres fortsatt som kjente varsler (PDF-motoren er bevisst unntatt).
- **P2-B3** – axe-scans på innlogging, dashbord, kunder, dokumenter og
  innstillinger; Lighthouse mobil a11y 100/100; fokusfelle, skip-link,
  redusert bevegelse, 44 px trykkflater, toasts, skeletons og sticky
  lagreknapp på mobil.
- **Dekningskrav** – `npm run test:coverage` håndhever terskler for
  forretningslogikken i `src/lib` og `src/server`.
- **P3 – feltoperasjoner**:
  - statisk service worker, IndexedDB-kladder/outbox, offline-banner,
    `capture="environment"`, lokal-first autolagring og replay
  - varsler: in-app, e-postko, preferansematrise, tildeling/dato/kansellering/
    rapport/booking/avtale/forfalt
  - kundeportal: rapporthistorikk, kvittering og forespørsel om
    kontaktinfooppdatering
  - iCal-feed med personlig token, tilbakekalling og kartvisning gruppert per by

## Beslutninger

1. **Kundebestilling uten dato.** Kunden kan fortsatt bare oppgi tittel og
   beskrivelse. Dette følger det tidligere kravet om at kunden ikke skal velge
   dato; kontoret planlegger oppdraget. P3-kortets «preferred date/time» er
   derfor ikke innført.
2. **PDF-etiketter forblir norske.** `ReportDocument` kjører i
   `@react-pdf/renderer` utenfor next-intl-konteksten. En senere endring kan
   sende `locale` og en egen PDF-ordbok inn til komponenten.
3. **Tag og DocumentTag holdes separate.** Det følger det tidligere kravet om
   at dokumenttags og oppdragstags ikke skal blandes, og overstyrer P2-C3-kortets
   forslag om å slå dem sammen.
4. **Kart uten kart-SDK.** Kartvisningen grupperer oppdrag per by og lenker til
   Google Maps. Det krever ingen API-nøkkel eller ekstern karttjeneste.
5. **Offline omfatter kladder, ikke signering.** Skjemaet kan fylles ut og
   lagres lokalt offline, og kladden sendes når nettet er tilbake. Selve
   signeringen og innsendingen krever fortsatt nett, slik at en signert rapport
   alltid er bekreftet av serveren.
6. **Varsler er in-app + e-post.** Push/SMS er ikke innført. E-postkoen ligger i
   `Notification`-tabellen og tømmes av jobbworkeren.
7. **Multi-tenancy er ikke innført.** P5-0 gjelder bare hvis plattformen skal
   bli en SaaS for flere selskaper. For on-prem/single-company er den utsatt.
8. **Felles UI-primitiver.** Sider gjenbruker `PageHeader`, `SectionCard`,
   `EmptyState`, `KpiCard`, `Pagination` og `Skeleton` fra `src/components/`
   i stedet for egne kopier. Det er bevisst ingen egen `src/components/ui/`-
   pakke; nye flater skal bruke primitivene før nye komponenter lages.

## Utsatt: P4 og P5

P4 og P5 krever infrastruktur, eksterne kontoer eller organisatoriske avklaringer
som ikke kan ferdigstilles og verifiseres i denne kjøringen:

| Område | Blokkering | Anbefalt neste steg |
| --- | --- | --- |
| P4-1 objektlagring | S3/MinIO-bøtte og nøkler | Lag `src/lib/storage.ts` med lokal og S3-driver; migrer eksisterende filer med et gjenopptakbart skript |
| P4-2 Redis/BullMQ | Redis-instans | Bytt rate limits og jobbkø til Redis/BullMQ; lasttest to replikaer |
| P4-3 regnskap | Sandbox-konto (Fiken/Visma/Tripletex) | Provider-grensesnitt + én adapter; idempotent synk |
| P4-4 lager | Beslutning om lagerstruktur | Schema for lager, bevegelser og reservasjoner |
| P4-5 API/webhooks | API-token- og webhook-policy | Token-scopes, OpenAPI, HMAC-signerte webhooks med retry |
| P5-1 SSO/SCIM | Test-IdP og kundekrav | OIDC/SAML + SCIM; bryt-glass-admin |
| P5-2 avansert RBAC | Regelverk for godkjenning | Scoped roller, feltnivå, segregering av plikter |
| P5-3 GDPR/oppbevaring | Juridisk avklaring | Eksport/sletting, retention, hash-kjedet audit |
| P5-4 white-label/domener | DNS/TLS og kundedomener | Per-tenant branding og domenevalidering |
| P5-5 fakturering | Betalingsleverandør | Stripe eller lokal faktura; entitlements |
| P5-6 HA/DR | Infrastruktur og RPO/RTO | PITR, failover-test, lasttest, pen-test |

Disse bør planlegges som egne faser med egne akseptansekriterier og
infrastrukturforutsetninger. Inntil da er P3 den siste fullførte fasen.

## Sikkerhetsgjennomgang 24. oktober 2026 (SEC-1–SEC-10)

Sikkerhetsarbeidet er gjennomført på `dev`. Ingenting er merget til `master`.

- **SEC-1** – opplastede filer kan bare knyttes til en entitet av opplasteren
  eller av den eksisterende eieren. Ueide dokumentopplastinger kan bare claimеs
  av den som lastet dem opp.
- **SEC-2/3** – 2FA-endringer øker `sessionVersion`, fornyer bare den aktive
  økten, feiler lukket når hemmeligheten mangler, og krever passord + TOTP.
  2FA-innstillinger er rate-limitet per bruker og IP, og alle feilede forsøk
  audit-logs uten kode eller passord.
- **SEC-4** – kundebestilling er rate-limitet per kunde og IP, har tak på fem
  åpne bestillinger, dedupliserer like bestillinger og varsler bare kontoret i
  destinasjonsavdelingen.
- **SEC-5** – offline-kladder har 2 MB HTTP-grense, 1 MB serialisert grense,
  signaturer lagres som `USER`-eide filer, og kladder ryddes etter sju dager.
- **SEC-6** – iCal-tokens lagres bare som SHA-256-hash, vises én gang, kan
  roteres/tilbakekalles og avgrenses til kundens egne eller montørens tildelte
  oppdrag i riktig avdeling. Plaintext-kolonnen er droppet; eksisterende
  abonnementer må regenereres.
- **SEC-7** – origin-sjekken krever gyldig Bearer-hemmelighet eller
  same-origin/none, `/api/ready` skjuler detaljer uten `READY_SECRET`, cron
  sammenligner i konstant tid, og varsel-e-post prøves fem ganger med backoff.
- **SEC-9** – time-/materialpris ble først satt på serveren. Funksjonen er
  senere fjernet helt fordi systemet ikke skal fakturere eller føre timer.
- **SEC-10** – produksjon krever HTTPS-URL-er, Docker kjører read-only med
  minste privilegier, backup kan krypteres og kopieres eksternt, og CI kjører
  audit, i18n og containerskanning.

### Bevisste valg

1. **Timebruk, materialer og fakturaeksport er fjernet.** Systemet skal bare
   dokumentere arbeidet på et oppdrag, ikke fakturere eller opprette ordrer.
   I stedet har oppdrag fått et valgfritt eksternt `orderNumber`.
2. **Ingen backfill av iCal-tokens.** Gamle tokens var plaintext og er droppet.
   Sikkerhetsmessig er det bedre å kreve regenerering enn å hash-e dem videre.
3. **Myk sletting av oppdrag.** Oppdrag, rapporter, revisjoner og vedlegg
   beholdes til `RETENTION_DAYS` (standard 365) er utløpt. `legalHold` på
   oppdrag eller rapport blokkerer automatisk hard sletting.
4. **Rapportrevisjoner lagres i databasen, men har foreløpig ingen egen
   leservisning.** En admin kan gjenopprette og inspisere via databasen; en
   read-only revisjonsside/PDF er anbefalt neste steg. Revisjonen fryser navn,
   enhetskrav, kvittering, signaturer og enhetene. Siden skjemaet ikke har egne
   kolonner for mal-id, låsemetadata eller PDF-hash, legges disse i
   `ReportRevision.dataJson` under `_revisionMeta` sammen med rapportens
   opprinnelige data.
5. **Ordrenummer er valgfritt, men unikt per avdeling.** Visningsfeltet
   `orderNumber` bevares slik kunden skrev det. `orderNumberNormalized` er
   trimmet, store bokstaver og uten mellomrom/tegnsetting, og brukes til
   duplikatkontroll (`@@unique([departmentId, orderNumberNormalized])`). Ved
   kloning tømmes ordrenummeret bevisst, fordi nummeret hører til det
   opprinnelige oppdraget; kontoret setter et nytt hvis klonen trenger det.
   Endringer logges med før/etter-verdi.
6. **Automatisk utbedringsoppdrag.** Når en rapport inneholder minst ett avvik,
   opprettes nøyaktig ett udatert `OPEN`-oppdrag med `deviationSourceKey =
   report:<rapport-id>`. Oppdraget arver kunde, avdeling og kontaktperson, får
   innsenderen som montør, og beskriver alle avviksenhetene med sjekkpunkter,
   svar og kommentarer. Den unike nøkkelen gjør gjentatt innsending idempotent;
   `submitReport` returnerer `remediationWorkOrderId` slik at UI kan lenke til
   oppdraget.

### HMS-skjemaer

- **HMS er en egen malkategori.** `Template.category` er `SERVICE` eller `HMS`,
  og HMS-maler har `hmsType` (`SJA`, `HOT_WORK`, `INTERNAL_CONTROL`,
  `DEVIATION`, `SAFETY_ROUND`, `WRITTEN_INSTRUCTION` eller `GENERAL`).
  Rapportens kategori og HMS-type fryses ved signering, slik at lister og PDF
  viser riktig historikk selv om malen endres senere.
- **Standardmaler installeres av migrasjonen.** Seks HMS-skjemaer fra
  `/HMS-skjemaer` er lagt inn med stabile id-er og `requiresUnits = false`.
  Migrasjonen overskriver ikke maler som allerede finnes. De kan redigeres i
  maladministrasjonen som vanlige maler.
- **HMS-skjemaer knyttes til oppdrag, ikke til en egen rapporttabell.** Dermed
  gjelder samme låsing, signatur, revisjon, bevaringsplikt, PDF og
  tilgangskontroll som for servicerapporter. Både kundeoppdrag og interne
  oppdrag (`customerId = null`) kan bruke HMS-skjemaer.
- **Egen HMS-inngang.** `/hms` samler malbibliotek, dokumentasjon og en
  koblingsflate. Kobling går gjennom `addTemplate` i oppdragstjenesten, slik at
  avdelingssperre, låste oppdrag og revisjonslogg ikke kan omgås.
- **Internkontroll og øvrige HMS-skjemaer følger samme malmotor.** Risikovurdering,
  avvik, vernerunde og skriftlig instruks er egne `hmsType`-verdier, ikke
  hardkodede tabeller. Skjemaene kan derfor tilpasses uten kodeendringer.

### Bevaringsplikt, retensjon og eksport

- **Bevaringsplikt (legal hold) er en frysebryter, ikke bare en slettesperre.**
  Nye rapporter på et oppdrag med bevaringsplikt arver flagget. Innsending,
  opplåsing, kladd og vedleggssletting avvises når oppdraget eller rapporten er
  under hold.
- **Avslag krever grunn.** Å slå av bevaringsplikt på et oppdrag krever en
  eksplisitt administratorhandling med grunn, og frigjør **ikke** rapportenes
  egne hold i det stille. Rapporter frigjøres enkeltvis med
  `setReportLegalHold(..., false, grunn)`, og hver frigjøring logges med
  rapport-id. Å slå på hold synkroniseres fortsatt til alle rapportene.
- **Retensjon.** `cleanupRetainedWorkOrders` hard-sletter bare mykt slettede
  oppdrag som er eldre enn `RETENTION_DAYS` (standard 365) **og** som ikke har
  noen rapporter. Så snart et oppdrag har en rapport – signert eller ikke –
  beholdes oppdraget, rapporten, revisjonene, kommentarene og filene på ubestemt
  tid. Bevaringsplikt på oppdrag eller rapport stopper også sletting.
- **Eksport.** Det finnes ingen automatisk eksportjobb. Bevis eksporteres trygt
  ved å bruke databasebackupen eller en adminstyrt spørring mot `WorkOrder`,
  `Report`, `ReportRevision` og `AuditLog` for ett oppdrag om gangen. En egen
  admin-eksport med signert pakke og hash-kjede er anbefalt neste steg; den må
  kreve administratorrettighet og logges i `AuditLog`. Rapporter skal ikke
  eksporteres fra klienten eller gjennom en offentlig rute.

### Åpne spørsmål / neste steg

- Skal kunden fortsatt få en egen bekreftelses-e-post ved booking? I dag går
  bookingvarsel til kontoret via varselkøen, og `sendBookingNotification` er
  bare brukt av tester.
- Skal revisjonshistorikken få egen admin-side og PDF-rendering fra en
  `ReportRevision`?
- Skal `legalHold` få en admin-bryter i UI, og hva er riktig oppbevaringsfrist
  per kundetype?
- Rate limits og jobbkø er databasebaserte og deles mellom instanser. Ved
  mange instanser bør Redis/BullMQ vurderes (P4-2).
- `TRUST_PROXY=true` må settes når appen står bak en reverse proxy som
  overskriver `X-Forwarded-*`; ellers brukes ikke IP-nøkler.

## Phase 1 — visiter, tid på dagen og arbeidsstyrke (2026-10-30)

- **Visiten er planleggingsenheten.** `Visit` har absolutte `startsAt`/`endsAt`
  (`timestamptz`), status, notat og montører. `WorkOrder.scheduledFor`/
  `scheduledTo` beholdes som avledede min/maks-datoer for eksisterende lister,
  søk, API og rapporter. De skrives bare i samme transaksjon som visiten.
- **Alle datoer tolkes i Europe/Oslo.** Heldagsvisiter starter ved Oslo-midnatt
  og slutter ved neste Oslo-midnatt; sommertid kan derfor gi 23/25 timers døgn.
  `dateOnlyInOslo` er eneste støttede vei fra instant til kalenderdato.
- **Ingen nye rettighetsnøkler.** Se visitt = `workorders.view`, opprette/
  redigere/slette = `workorders.edit`, flytte/tildele = `workorders.assign`,
  statusflyt = `workorders.update`. Montører kan dermed bruke feltflyten uten
  å få kontorets redigeringsrett.
- **Én standardvisitt per datofestet oppdrag.** Eldre oppdrag er backfilt med
  én heldagsvisitt; nye oppdrag, serviceavtaler, bestillinger og kloner lager
  visitt i samme transaksjon. Udaterte oppdrag har null visiter.
- **Datoflytting på oppdragsnivå er kompatibilitet, ikke ny funksjonalitet.**
  Den kan bare endre null/én visitt. Flere visiter eller en visitt i `EN_ROUTE`/
  `ON_SITE` avvises; videre planlegging skjer på visittnivå.
- **Drag-and-drop tildeler montør, ikke dato.** På dashbordets tavle og i
  ressursoversikten kan et kort dras til en montør. Slippet går gjennom
  `workorders.assign` og `moveTechnician`/`assignTechnician`; kolonner er
  prioritetsbøtter og er bevisst ikke slippmål. Kalender og dispatch har egne,
  eksplisitte dato-/tidsflytter.

## Språk (2026-10-30)

- Plattformen har fire fullstendige kataloger: **norsk, engelsk, polsk og tysk**.
  `messages/pl.json` og `messages/de.json` er komplette oversettelser av den
  flettede engelske katalogen, med samme nøkkelsett som nb/en.
- Språkvelgeren er en native `<select>` i topplinjen. Valget lagres i
  `NEXT_LOCALE`-cookien og bruker `router.refresh()`, uten URL-prefiks.
- Datoer, tall og relativ tid følger språket via `intlLocale` (`nb-NO`,
  `en-GB`, `pl-PL`, `de-DE`). PWA-manifestet har egne navn og beskrivelser for
  alle fire språk.
- Paritetskontrollen `npm run check:i18n` sammenligner nå alle fire kataloger;
  hardkodede norske strenger og ubrukte nøkler rapporteres fortsatt som før.
