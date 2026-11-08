# Gjenstående arbeid etter 0.8.10

> **Status snapshot 0.8.10:** 2026-11-07, `master` @ `f5ba5b1`.
> `package.json` er 0.8.10. Taggen `v0.8.10` peker på `de4be00`; `f5ba5b1`
> inneholder i tillegg det som står under «Unreleased» i
> [`CHANGELOG.md`](../CHANGELOG.md): FullCalendar 7, arbeidsdager/tid/reise og
> live feltstatus.
>
> **Dette er den reelle gjenstående køen.** Leverte ting står under
> [«Levert»](#levert-ikke-dupliser) og skal ikke gjenåpnes som nye oppgaver.
> Ikke marker noe som ferdig uten akseptansekriteriene og portene nederst.

| Felt | Verdi |
| --- | --- |
| Dato | 2026-11-07 |
| Kodegren | `master` @ `f5ba5b1` |
| Versjon | 0.8.10 (`v0.8.10` = `de4be00`, 30 commits bak `f5ba5b1`) |
| Denne doc-endringen | `feat/backlog-0810` |
| Verifisert mot | `CHANGELOG.md`, git-historikk, [`DECISIONS.md`](DECISIONS.md), [`OPERATIONS.md`](OPERATIONS.md), [`AZURE.md`](AZURE.md), [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md), [`backlog-customer-export-import.md`](backlog-customer-export-import.md), [`manual/nb`](manual/nb), og faktisk kode der status var uklar |
| P0 | Ingen åpne P0 funnet på denne commiten |

**Kort status:** P1 er tom: DATA-01 og DOC-01 er levert. P2 er levert som v1 (ARCH-01, REV-01/02, OPS-05, FLD-01, BI-01, CUST-EXPORT-02), med konkrete restrisiko-/gjeldsposter igjen. P3 er plattform- og skaleringsarbeid som krever eiergodkjenning.

---

## Levert (ikke dupliser)

### Kjerne, sikkerhet, data og drift

- **CORE-01–04** — bemanning/kompetanse/kapasitet, portaldelegering,
  kundesteder og planlegging av datoforespørsler i bookingkøen.
- **SEC-01–05** — krypterte offline-kladder med PIN, PDF-sanering, strømmende
  opplasting med kvoter, API-nøkkel-scopes/rotasjon og påkrevd 2FA.
- **DATA-02/03** — hash-kjedet revisjonslogg med oppbevaring/legal hold,
  revisjonseksport og signert bevis-eksport per oppdrag.
- **DATA-01 — GDPR-sletting og anonymisering.** Admin-only forhåndsvisning,
  navnebekreftelse, legal-hold-blokkering og transaksjonell anonymisering av
  kunde, kontakter, steder, portalbrukere, oppdrag, rapporter/revisjoner,
  kommentarer, meldinger, bestillinger og filmetadata. Kundens egne vedlegg
  slettes; oppdrag, rapporter, signerte rapport-PDF-er og revisjonsloggen
  bevares. Idempotent og revisjonslogget. Se
  [`privacy-erasure.md`](privacy-erasure.md).
- **OPS-01–04** — automatiserte backuper med ferskhetskontroll, metrics/
  varsler, trusted proxy og separate runtime-/migrasjonsroller.
- **OPS-06 — automatisk SLA-opprydding.** Scheduleren kjører
  `cancelUncontractedSlaClocks` ved oppstart og med
  `SLA_CLEANUP_INTERVAL_HOURS` (standard 6 timer; `SLA_CLEANUP_ENABLED=false`
  slår av). Kjøringen er idempotent, advisory-låst, transaksjonsbasert og
  revisjonslogget, og lagres i `SlaCleanupRun` for metrics. Prometheus
  eksponerer siste kjøring, kansellert antall, feilede kjøringer og stale-signal
  med tilhørende alarmer. CLI-en `npm run sla:cleanup` med `--apply` består som
  diagnoseverktøy. Tester dekker scheduler-kallet, avslått konfigurasjon,
  feilende kjøring, metrics og idempotent/samtidig kjøring mot reell
  PostgreSQL. Se [`OPERATIONS.md`](OPERATIONS.md).
- **DOC-01 — booking/overlapp avstemt.** Den direkte slotbekreftelsen i
  `createBooking` er fjernet; alle nye bestillinger er datoforespørsler som
  kontoret planlegger og bekrefter. Overlappende visiter er en
  opptatt-markering, ikke en hard sperre, og `BookingHold` brukes bare i den
  eldre ombookingsflyten. Manual (nb/en), ordlisten, `DECISIONS.md` Phase 5A,
  sikkerhetsrevisjonen og testene forteller samme historie.
- **UX-01–07** — vedlikeholdsplaner, utstyrsfilter, dispatch-innstillinger,
  omtaler, booking-e-post, iCal og PDF-sidesøk.
- **QA-01/02** — utvidet a11y/E2E og API-/OpenAPI-kontrakttest.
- **CUST-EXPORT-01 v1** — admin-only eksport/import av kundepakker med
  manifest, sjekksum, dry-run, id-remapping, filhåndtering og reell
  PostgreSQL-test (`e83f38c`). Kjente v1-begrensninger er dokumentert i
  [`backlog-customer-export-import.md`](backlog-customer-export-import.md) og
  er løftet til **CUST-EXPORT-02** nedenfor.

### Kommunikasjon, identitet og felt

- **Toveis SMS og påminnelser** — innkommende webhook med signatur,
  idempotens, leveringsstatus og STOP/START; kontorinnboks med svar;
  konfigurerbare SMS-/e-postpåminnelser via durabel worker (`ab66155`).
- **SSO og SCIM-brukere** — OIDC for Entra ID, Keycloak, Authentik og Zitadel,
  verifisert e-post-kobling, rolle-/gruppemapping; SCIM 2.0 Users med
  hash-lagrede token og admin-fane (`334a700`). SAML, SCIM Groups og Entra
  group overage gjenstår, se **PLAT-04**.
- **Feltapp, navigasjon og strekkode** — `/skann` med BarcodeDetector/ZXing og
  manuell fallback, Apple/Google Maps-dypelenker, kopier adresse/ring,
  PWA-forbedringer og Capacitor-skall (`9f290ac`). Kunders eksisterende
  QR-koder på utstyr støttes med globalt unike verdier (`b79ed94`).
- **Rute og ETA** — ruteplanlegger med nærmeste nabo + 2-opt, valgfri OSRM og
  lokal fallback, «Bruk rekkefølge» med overlapp-/fraværssjekk, og sanntids
  ETA i sporingen (`978ceee`). Trafikkdata, dynamisk omruting og
  turn-by-turn gjenstår, se **SCH-02**.

### Kalender, arbeidsdag og rettelser

- **PDF-bilder/signaturer og PDF-visning** — bilder og signaturer bygges inn i
  rapport- og revisjons-PDF-er (`136365c`), og PDF-er kan vises trygt i appen
  med `?inline=1` etter sanitering (`89c8024`).
- **Opplastingskvote** — standardkvotene regnes nå i MB/bytes riktig
  (2 GiB per bruker, 10 GiB per kunde), med tydelige feilmeldinger
  (`870f13e`). Kappløpet mellom kontroll og skriving gjenstår som **SEC-06**.
- **Kundeoverføring** — eksport dedupliseres per utvalg, feil lagres på jobben
  og vises i UI, og første forsøk blokkeres ikke av gamle tellere; grensen er
  10 starter/time (`28e82cb`). Selve overføringen er fortsatt synkron og
  in-memory, se **CUST-EXPORT-02**.
- **Kundeadskillelse og søk** — steds- og enhetsvelgere henter bare data for
  valgt kunde, og kundekortet har søkbare lister (`abe9445`).
- **Flytt enhet med historikk** — hele enheten med underenheter, oppdrag,
  rapporter/revisjoner/PDF, målinger, planer, dokumenter, vedlegg og QR-koder
  flyttes; aktive kontraktslinjer blokkerer (`002ffa5`).
- **FullCalendar 7** — migrert til `fullcalendar` 7.1.4 med
  `temporal-polyfill`, v7-plugins og offentlige klassehooks (`6c057cc`), med
  oppfølgingsfikser for høyder og ukenummer (`a2bd4cd`). Visuelle
  kanttilfeller gjenstår som **UX-08**.
- **Arbeidsdager, tid og reise** — én intern økt per kalenderdag, faktisk
  start/slutt/varighet i kalenderen, tidsregistrering per dag og reisetid
  som lukkes av neste `EN_ROUTE` eller «Avslutt kjøring» (`b8ea453`,
  `67bf9d8`). Backfill og automatisk lukking av siste kjøring gjenstår som
  **DATA-04** og **FLD-02**.
- **SLA med aktiv avtale** — SLA starter bare med aktiv, datogyldig avtale og
  aktiv policy; ingen fallback til avdeling/global policy. Oppryddingen av
  gamle klokker uten dekning kjører automatisk og revisjonslogges
  (`96a8180`, se **OPS-06** over).
- **Dashbord med live feltstatus og kart** — dagens montørstatus, aktive
  visiter og kartmarkører fra ferske posisjonspinger (`17f758d`). Kartet
  krever at avdelingen har sporing på og at montøren deler posisjon, se
  **UX-09**.
- **ARCH-01 · Modulær plattform** — modulkatalog med kjerneskille,
  avhengighetsvalidering, `ModuleState`-migrering, admin-fane, presets
  (`full`/`core`), gating av navigasjon, innstillinger, sider, actions, API,
  søk og arbeidsjobber. Data beholdes når en modul slås av. Se
  [`MODULES.md`](MODULES.md) og `src/lib/modules.ts`.

---

## Åpne prioriteringer

**Legende:** **P1** = må lukkes før mer produktflate · **P2** = viktig manglende
kapasitet · **P3** = produktvalg/skala, krever godkjenning · **S/M/L/XL** =
størrelse.

### P1 — lukk disse først

Ingen åpne P1-oppgaver per 2026-11-07. DATA-01 og DOC-01 er levert og flyttet til «Levert».

---

### P2 — nye prioriterte arbeidsoppgaver

| ID | Prioritet | Størrelse | Avhengigheter | Status | Akseptanse |
| --- | --- | --- | --- | --- | --- |
| **REV-01** · Tilbud og estimater | P2 | L | ARCH-01 | **Levert v1.** Tilbud, linjer, versjoner, portal-token, godkjenning/avslag, konvertering til oppdrag og utskriftsvisning. Residual: utskrift/PDF er nettleserens print-til-PDF (ingen server-generert PDF eller e-postutsending), og det finnes ingen avansert god/bedre/best-mal. | Tilbudsbygger med linjer, mengder, rabatt og versjonering; gode/bedre/beste-varianter; godkjenning i kundeportalen med sporbar signatur/kvittering; konvertering til oppdrag uten å miste historikk; avviste/utløpte tilbud håndteres; alt revideres og tilgangstestes. |
| **REV-02** · Fakturering og betaling | P2 | L | REV-01 | **Levert v1.** Faktura, MVA, delbetaling, kreditnota, forfalt-sveip, CSV og portalvisning. Residual: ingen PSP/kortbetaling eller regnskapsintegrasjon. | Faktura fra fullført oppdrag/rapport med linjer, MVA, kreditnota og betalingsstatus; betalingslenke og avstemming; regnskapseksport med idempotent synk; delvis betaling/avskrivning håndteres; tester dekker MVA, kreditnota og dobbeltsynk. |
| **OPS-05** · Lager, deler og innkjøp | P2 | L | ARCH-01 | **Levert v1.** Lager/bil, beholdning, atomiske bevegelser, reservasjon/forbruk, kjøpsforslag. Residual: ingen innkjøpsordrer/leverandørfaktura. | Saldo per lager/bil; reservasjon mot oppdrag og visit; forbruk trekkes ved fullført arbeid; innkjøpsforslag ved minimumsnivå; sporbarhet på del/serie/lot der relevant; justeringer og tellinger revideres; tester dekker reservasjon, negativ saldo og samtidige uttak. |
| **FLD-01** · Kjøring, utlegg og lønnseksport | P2 | M | Arbeidsdager/tid | **Levert v1.** Kjøretur, utlegg med kvittering, godkjenning og idempotent CSV-eksport. Residual: ingen direkte lønnssystemintegrasjon. | Kjøretur kan logges per dag/montør med start/stopp/avstand og formål; kvittering/utlegg festes til oppdrag med beløp, MVA og kategori; godkjenning/avvisning; lønnseksport i avtalt format med periode, timer, reise og utlegg; eksporten er idempotent og revideres; tester dekker avrunding, MVA og avviste utlegg. |
| **BI-01** · Lønnsomhet og rapportbygger | P2 | M | Arbeidsdager/tid; REV-02 for faktisk omsetning | **Levert v1.** KPI-er, timer/reise, first-time-fix, estimert inntekt, per montør/kunde/oppdrag og CSV. Residual: faktisk omsetning og fri rapportbygger. | Inntekt per oppdrag/kunde/tekniker; first-time-fix; utnyttelse fra arbeidstid; kostnadsgrunnlag merkes tydelig når faktisk omsetning mangler; filter per periode/avdeling/kunde; eksport til CSV/PDF; tallene stemmer med underliggende poster i tester. |
| **CUST-EXPORT-02** · Herding av kundeoverføring | P2 | L | CUST-EXPORT-01 v1 | **Levert v1.** Durable kø, progress, HMAC-signatur, AES-GCM-kryptering, 1.0→1.1, avstemming og retensjon. Residual: ZIP i minnet, HMAC ikke Ed25519, passfrase kun CLI/API. | Durabel asynkron worker med fremdrift, gjenopptakelse etter restart og idempotente steg; signerte og krypterte pakker med dokumentert nøkkelrotasjon; eksplisitte kryssversjon-migratorer med tester; avstemmingsjobb for endelige `/uploads`-filer; juridisk beslutning for signaturbilder/HMS dokumentert; test av krasj/restart, feil sjekksum, feil versjon og avvist signatur. |

**Merknader til P2:**

- **ARCH-01 er levert** (se [`MODULES.md`](MODULES.md)). Nye produktmoduler
  (REV-, OPS-05- og BI) skal legges inn i modulkatalogen, ikke hardkodes i
  navigasjon, actions eller worker. Kjernen kan fortsatt kjøre
  kunde/oppdrag/dispatch/rapport alene med `MODULE_PRESET=core`.
- **REV-01 → REV-02** er quote-to-cash-løpet. Ikke start REV-02 uten avklart
  MVA- og regnskapsmodell.
- **OPS-05** flytter det gamle PLAT-08-innholdet inn i produktkøen. PLAT-08
  beholdes som referanse i P3-tabellen, men er ikke en egen åpen oppgave.
- **FLD-01** bygger på levert tidsregistrering; ikke dupliser `Visit`-tid.
- **BI-01** må merke estimert vs. faktisk omsetning til REV-02 er levert.
- **CUST-EXPORT-02** er herding av v1, ikke en ny eksportfunksjon.

---

## Teknisk gjeld og restrisiko

Disse er konkrete oppgaver, ikke nye produktmoduler. De lukker kjente hull i
det som allerede er levert.

| ID | Prioritet | Størrelse | Status | Akseptanse |
| --- | --- | --- | --- | --- |
| **DATA-04** · Backfill for eldre tidsstyrte visiter | P2 | M | **Delvis:** `npm run visits:backfill:daily` splitter bare flerdagers heldagsvisiter; eldre tidsstyrte enkeltdagsvisiter blir ikke normalisert. | Skript/tørrkjøring som oppdager og rapporterer legacy tidsstyrte enkeltdagsvisiter; trygg splitting eller eksplisitt manuell rapport; tidsstempler dupliseres aldri; integrasjonstest mot reell PostgreSQL; `OPERATIONS.md` oppdatert. |
| **FLD-02** · Automatisk lukking av siste kjøring | P2 | S | **Manuell i dag:** siste jobb på dagen må bruke «Avslutt kjøring». | Definer policy for auto-lukking (tidspunkt/avstand) som aldri gjetter ulønnet reise; handlingen revideres og kan korrigeres; felt-UI viser hvorfor reisen ble lukket; tester dekker neste `EN_ROUTE`, siste jobb og overnatting. |
| **SEC-06** · Atomisk opplastingskvote | P2 | M | **Kjent kappløp:** kontrollen er lesning før skriving; samtidige opplastinger kan overskride kvoten med noen MB (`src/lib/upload-quota.ts`). | Kvoten reserveres/oppdateres atomisk (ledger, radlås eller tilsvarende); samtidig test viser at grensen ikke overskrides; 507 gir tydelig feil; ingen orphan-filer ved avvisning; eksisterende kvoter og opprydding bevares. |
| **UX-08** · FullCalendar 7 visuell QA | P3 | S | **Kjente kanttilfeller:** to-ukersvisningens andre uke har en egen workaround for kolonneoverskrifter; timegrid skal åpne 07:00 (`scrollTime`), men mangler visuell test mot 00:00; korte tidsstyrte kort kan klippe tekst. | To-ukersvisning viser riktig dato/ukenummer i begge uker i nb/en/pl/de og smale bredder; timegrid åpner på arbeidsdagen og ikke 00:00 ved visningsbytte; korte hendelser er lesbare uten klipping; visuell/E2E-test eller skjermbildekontroll fanger regresjoner. |
| **UX-09** · Tydelige forutsetninger for live-kart | P3 | S | **Dokumentert forutsetning:** dashbordkartet krever `Department.trackingEnabled` og at montøren deler posisjon; ellers vises tom/flagg-tilstand. | Tomtilstand forklarer begge forutsetningene og lenker til riktig sted (innstillinger for sporing, feltflate for deling); ingen markører fra gamle/avsluttede visiter; test dekker sporing av, ingen deling og fersk posisjon. |

---

## P3 — plattform og skala (krever godkjenning)

P3 starter ikke uten produkt-/eiergodkjenning og en konkret kunde- eller
driftsbegrunnelse. Status er verifisert mot kode og dokumentasjon på
`f5ba5b1`.

| ID | Status | Det som gjenstår |
| --- | --- | --- |
| **PLAT-01** · S3/objektlagring | **Åpen.** Appen bruker lokal disk; Azure-guiden sier uttrykkelig at S3-driver ikke finnes. | Storage-abstraksjon med lokal og S3/MinIO-driver, gjenopptakbar migrering av eksisterende filer, ingen lokal-disk-kobling i tjenestelaget. |
| **PLAT-02** · Redis/BullMQ | **Åpen.** Jobbkø og rate limits er databasebaserte; Azure-guiden nevner in-process workers og Redis som skaleringsvei. | Redis/BullMQ bak samme grensesnitt, DB-fallback, lasttest med to replikaer, dokumentert drift. |
| **PLAT-03** · Utgående signerte webhooks | **Åpen.** Bare innkommende SMS-webhook finnes. | Retry, idempotens, dead letter, HMAC-signering, abonnements-/innstillings-UI og tester. |
| **PLAT-04** · SSO/OIDC/SAML + SCIM | **Delvis.** OIDC (Entra ID, Keycloak, Authentik, Zitadel), SCIM 2.0 Users og break-glass er levert. | SAML; SCIM Groups; Entra group overage via Graph eller dokumentert begrensning; tester for provisioning/deaktivering; se [`manual/nb/31-sso-scim.md`](manual/nb/31-sso-scim.md) og [`OPERATIONS.md`](OPERATIONS.md). |
| **PLAT-05** · Avansert RBAC/field-level + separation of duties | **Åpen.** Roller/rettigheter finnes, men ikke feltnivå eller pliktsegregering. | Scoped roller, feltnivåregler, godkjenningsflyt som krever to personer, tester for hver rolle. |
| **PLAT-06** · HA/DR/PITR | **Åpen.** Backup/restore og Azure-guide finnes, men ikke HA, failover-drill eller PITR. | RPO/RTO, PITR, failover-test, lasttest, dokumentert restore-drill; se [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md) og [`AZURE.md`](AZURE.md). |
| **PLAT-07** · White-label/custom domains | **Åpen.** Én deployment med Caddy/TLS; ingen tenant-host-mapping. | Host-mapping, per-tenant branding, TLS/DNS-validering, feilhåndtering for ukjent vert. |
| **PLAT-08** · Lager/stock-modul | **Flyttet til OPS-05 (P2).** | Beholdes bare som historisk referanse; ikke start som egen P3-oppgave. |
| **PLAT-09** · Nøkkelrotasjon | **Delvis.** API-nøkler kan roteres; infrastrukturhemmeligheter (`NEXTAUTH_SECRET`, DB/SMTP/SMS, age-mottakere, gamle backuper) er manuelle. | Dokumentert rotasjonsplan, overlappsvindu, re-encryption av backuper, test av gammel/ny nøkkel. |
| **PLAT-10** · Supply chain | **Delvis.** Trivy, SHA-pinnede actions og digest-skanning av publisert image finnes; base image er tagget, ikke digest-pinnet; SBOM/SAST/secret-scanning mangler. | Digest-pinning av base image/Prisma CLI, SBOM, SAST/secret-scanning, signert provenance og policy for oppdateringer. |
| **PLAT-11** · Maintenance mode + request-ID + health | **Delvis.** Request-ID er implementert; maintenance mode mangler; `/api/health` eksponerer fortsatt `uptimeSeconds`. | Maintenance mode med kontrollert 503 og unntak for helse/metrics; fjern eller begrens uptime; test av proxy/helse. |
| **PLAT-12** · Performance-budsjett, skjermbilde-manifest og masseoperasjoner | **Delvis.** Lighthouse a11y-terskel er i CI; performance-budsjett, skjermbilde-manifest i CI og bulk-operasjoner for kunder/utstyr mangler. | Konkrete budsjett-test er i CI; skjermbildemanifest verifiseres; bulkoperasjoner med tilgangskontroll, revisjon og tester. |

**Andre P3-kandidater (ikke startet):**

- **NATIVE-01 · Signert native app og push** — Capacitor-skallet finnes, men
  signerte butikkbygg, FCM/APNs, butikkoppføring og enhetstester gjenstår; se
  [`NATIVE.md`](NATIVE.md). Ingen push i dag.
- **SCH-02 · Trafikk, dynamisk omruting og turn-by-turn** — ruteplan og ETA er
  levert; trafikkdata, omruting underveis og turn-by-turn i feltappen mangler.
- **AI-01 · Copilot, IoT, prediktivt vedlikehold og AR** — verken
  AI-assistent, stemmeintake, IoT-inntak, prediktiv analyse eller AR er
  implementert. Krever egen produktbeslutning, datagrunnlag og
  personvernsvurdering.
- **INT-01 · Regnskap/CRM/betaling og utgående webhooks** — API v1 med
  scopes/OpenAPI finnes; konnektorer og utgående webhooks mangler. Se også
  REV-02 og PLAT-03.

---

## Forslag til worker-bølger

Rekkefølgen er et forslag; bølger kan kjøres parallelt når avhengighetene
tillater det.

1. **P1 og plattform:** DATA-01, DOC-01 og ARCH-01 er levert. Nye moduler
   registreres i `src/lib/modules.ts` og gates med
   `requireModule`/`requireModulePage`.
2. **Plattformmuliggjører videre:** bruk modulkatalogen før nye produktmoduler
   bygges; ikke hardkod nye flater inn i navigasjon, actions eller workers.
3. **Quote-to-cash:** REV-01 (L) → REV-02 (L). BI-01 (M) etter at
   omsetningsdata finnes.
4. **Felt og logistikk:** FLD-01 (M), OPS-05 (L). CUST-EXPORT-02 (L) kan gå
   parallelt som egen data-/plattformstrøm.
5. **Teknisk gjeld P2:** DATA-04, FLD-02, SEC-06. Disse er små nok til å tas
   mellom større bølger.
6. **P3:** PLAT-01–12, NATIVE-01, SCH-02, AI-01 og INT-01. **Krever
   godkjenning** og en konkret kunde-/driftsbegrunnelse per oppgave.

---

## Vedlikeholdsregler for denne listen

- **Kilde til sannhet:** Denne filen er køen, ikke en leveransebeskrivelse.
  Verifiser alltid mot kode, `CHANGELOG.md`, `DECISIONS.md`, manualen og
  `OPERATIONS.md` før du endrer status.
- **Når noe leveres:** Flytt oppgaven til «Levert (ikke dupliser)» i samme
  PR/commit, fjern den fra åpen tabell, og oppdater `CHANGELOG.md`,
  `DECISIONS.md`, manualen, `OPERATIONS.md`, OpenAPI og skjermbilder der
  oppførselen er endret. Legg ved commit, testkjøring og eventuelle kjente
  begrensninger.
- **Akseptansegater:** `npm run typecheck`, `npm test`, `npm run lint`,
  `npm run check:i18n:strict` og `npm run build` skal være grønne.
  Server-/dataendringer krever i tillegg `npm run test:integration` mot reell
  PostgreSQL. Sikkerhets- og GDPR-endringer krever egne negative tester
  (403, avvist sletting, hold-bevis).
- **Docs-only endringer:** `git diff --check` og lokal lenkesjekk er nok; ikke
  kjør apptester bare for tekst. Rapporter hva som er verifisert.
- **Ingen duplikater:** Ikke gjenåpne CORE/SEC/DATA-02/03/OPS-01–04/UX/QA,
  SMS, SSO-brukere, feltapp, QR, rute/ETA, PDF, kvote, eksportfiks,
  kundeadskillelse, enhetsflytting, FullCalendar 7, arbeidsdager, SLA-opprydding
  eller dashbord-live som nye oppgaver.
- **P3 krever godkjenning:** Ikke start PLAT-, NATIVE-, SCH-02-, AI- eller
  INT-arbeid uten eiergodkjenning og en dokumentert begrunnelse.
- **Hold listen ærlig:** Ikke skriv «levert» uten akseptansekriteriene og
  bevis. Ikke skjul kjente begrensninger; løft dem til egne ID-er i stedet.
- **Lenker:** Interne lenker skal peke på eksisterende filer i `docs/`.
  Oppdater lenkene når dokumenter flyttes eller splittes.
