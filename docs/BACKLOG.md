# Backlog og gjenstående arbeid

> **Dette er den eneste køen for gjenstående arbeid.** Dokumentet erstatter de
> tidligere backlog- og baseline-dokumentene, som er fjernet fra `docs/`.
>
> Leverte ting skal ikke gjenåpnes som nye prosjekter. Når noe leveres, flytt
> det til [«Levert»](#levert-ikke-dupliser), fjern det fra åpen tabell, og
> oppdater `CHANGELOG.md`, relevante fagdocs og manualen i samme commit.

| Felt | Verdi |
| --- | --- |
| Dato | 2026-11-11 |
| Kodegren | `master` og `dev` @ `v0.9.2` |
| Versjon | 0.9.2 (`v0.9.2`) |
| Repository | 116 Prisma-modeller, 27 enums, 91 `page.tsx`, 94 API-ruter, 22 moduler |
| Tester | 405 testfiler, 3 346 enhetstester, 41 integrasjonsfiler / 226 tester, 14 E2E-spesifikasjoner |
| P0 | Ingen åpne P0 |
| P1 | 7 produksjons-/governanceoppgaver |
| P2 | 17 produkt-/integrasjons-/plattformoppgaver |
| P3 | 5 strategiske valg som krever eiergodkjenning |

**Kort status.** Kjerne, sikkerhet, GDPR, revisjon, arbeidsdager, SMS,
SSO/SAML/SCIM, felt-RBAC, feltapp, ruting, P2 v1 (tilbud, faktura/betaling,
lager/innkjøp, utlegg/lønn, lønnsomhet, kundeoverføring), API v1 for tilbud,
eksterne ordrer og lager, konfigurerbare oppdragsstatuser og
kunde-/kontaktisolasjon er levert. Det som gjenstår er i hovedsak
**produksjonsbevis, driftsmodenhet, governance, integrasjonsdybde og noen
bevisste produktvalg** – ikke manglende kjernefunksjonalitet.

---

## Levert (ikke dupliser)

### Kjerne, sikkerhet og data

- **Kjerne:** kunder, kontakter, kundesteder, oppdrag, arbeidsdager/visiter,
  bemanning, kompetanse, kapasitet, dispatch, rapporter, PDF, signaturer,
  avtaler/SLA, utstyr, vedlikeholdsplaner, dokumenter, søk, varsler og
  revisjonslogg.
- **Sikkerhet:** 2FA, API-nøkler med scopes/rotasjon, kunde-/kontaktisolasjon,
  feltnivå-RBAC for kundekontakt, fakturabeløp, rapportsignaturer og
  lønnsbeløp, atomisk opplastingskvote, PDF-sanering og krypterte
  offline-kladder.
- **Data og personvern:** GDPR-sletting/anonymisering med legal hold,
  hash-kjedet revisjonslogg, oppbevaring, revisjonseksport og signert
  bevis-eksport.
- **Drift:** automatiserte backuper med ferskhetskontroll, metrics/varsler,
  trusted proxy, separate runtime-/migrasjonsroller, SLA-opprydding og
  backfill for eldre visiter.

### Kommunikasjon, identitet og felt

- **Kommunikasjon:** durabel e-postutboks, SMS toveis med STOP/START,
  påminnelser, pushvarsler med FCM/APNs-utboks.
- **Identitet:** OIDC (Entra ID, Keycloak, Authentik, Zitadel), SAML 2.0 SP
  med signert assertion/replay-vakt, SCIM 2.0 Users og Groups, gruppe- og
  rollemping, break-glass.
- **Felt:** PWA/Capacitor-skall, skann/QR, offline-cache, dypelenker til
  kart, tidsregistrering per dag, kjøring/utlegg og lønnseksport (CSV).

### Ruting, kalender og produktmoduler

- **Ruting:** nærmeste nabo + 2-opt, OSRM med lokal fallback, valgfri Google
  Routes ETA, trafikkbevisst ETA, manuell ruterekkefølge og
  overtidsplanlegging.
- **Kalender:** FullCalendar 7, arbeidsdager, faktisk tid, reisetid og
  live feltstatus/kart.
- **UX-08 · FullCalendar 7 visuell QA:** to-ukersvisningen viser ukedag i
  overskriften og riktig kompakt dato + ISO-ukenummer i begge ukeradene,
  også på 390 px. Timegrid åpner på 07:00 i en faktisk rullbar beholder, og
  korte hendelser (< 30 min) skjuler adresse/status men beholder tid og
  tittel. E2E-dekning i `e2e/calendar-visual.spec.ts`.
- **UX-09 · Live-kartets forutsetninger:** tomtilstandene forklarer både
  avdelingens sporing og montørens «Del posisjon», med lenker til
  `/innstillinger?tab=avdelinger` og `/mine-oppdrag`. Negative tester dekker
  gamle pinger, avsluttede visiter og avdeling med sporing av.
- **Designkonsolidering:** `PageShell`, `PageHeader`, `Card`, `Button`,
  `Field`, `StatusBadge`, `EmptyState` og `ErrorBanner` er felles primitiver
  på tvers av kontorflatene. 12 px tekstgulv, `--field-line`, `.office-page`,
  `.office-table` og `buttonClassName` er tatt i bruk; gamle
  `min-h-screen`-skall, 10/11 px tekst og rå felt-hex er fjernet.
- **P2 v1:** tilbud og versjoner, faktura/MVA/delbetaling/kreditnota,
  Stripe/Vipps-betalingslenker, regnskapssynk (Fiken/Tripletex/PowerOffice
  Go/CSV), lager/beholdning/innkjøp/varemottak, utlegg/godkjenning,
  lønnsomhet med estimert og faktisk omsetning, og herdet kundeoverføring med
  durabel kø, signatur, kryptering, versjonsmigrering og avstemming.
- **Integrasjon:** API v1 for kunder, oppdrag, tilbud, lager, eksterne ordrer,
  avtaler, utstyr, dokumenter, rapporter, visiter og SLA-policyer, med
  scopes, modulgating, paginering, felt-RBAC og OpenAPI-kontrakttest.
- **Konfigurerbare oppdragsstatuser:** hver status kan merkes åpen, planlagt
  eller lukket, aktiveres/deaktiveres og sorteres. Nye oppdrag starter som
  `PENDING` (åpen, venter på planlegging).

---

## Åpne oppgaver

**Legende:** **P1** = må lukkes før produksjonskrav kan sies å være oppfylt ·
**P2** = viktig manglende kapasitet eller dybde · **P3** = strategisk valg som
krever eiergodkjenning. **S/M/L/XL** = størrelse.

### P1 — produksjonsbevis og governance

Disse er ikke kodehull i kjerneflyten. De er bevis på at det som er bygget
faktisk virker mot ekte leverandører, og at driften og styringen er moden nok
for kunder med reelle krav.

| ID | Oppgave | Status | Størrelse | Akseptanse |
| --- | --- | --- | --- | --- |
| **PRV-01** · Verifiser ekte leverandører | Kode og adaptere finnes, men PSP (Stripe/Vipps), regnskap (Fiken/Tripletex/PowerOffice), trafikk/Google Routes, SAML-IdP, S3/MinIO, Redis, SMTP og FCM/APNs er ikke verifisert ende-til-ende med ekte legitimasjon. | **Åpen** | M | Datert pass/fail-record per leverandør med request-ID-er og feilmoduser; ingen hemmeligheter i repoet; hver uverifiserte leverandør merkes «ikke produksjonsklar». |
| **PRV-02** · Restore-, PITR- og failover-øvelse | `docker-compose.ha.yml`, WAL-arkiv og `restore-pitr.sh` finnes, men RTO/RPO er mål, ikke målte verdier. Compose har ingen automatisk DB-failover. | **Åpen** | M | Reell restore + PITR til ny instans + failover mot ekte Postgres/S3/Redis; målte RTO/RPO, datatapsgrense, operatørlogg og oppdatert runbook. |
| **PRV-03** · Signert native utgivelse | Android-/iOS-prosjekter, signerings-CI og pushflyt finnes i `fsm-mobile`, men ekte nøkler, butikkoppføring, personvernstekst og fysisk enhetsmatrise gjenstår. | **Åpen** | M | Signert AAB/IPA fra CI; butikkoppføring og personvernstekst; fysisk test av push (forgrunn/bakgrunn/kaldstart), dypelenker, kamera/QR, opplasting og offline-gjenopptak. |
| **GOV-01** · ISO 27001/SOC 2-driftsbevis | Readiness-pakken finnes, men `compliance/GAP-ANALYSIS.md` har 6 P0 og 7 P1 åpne punkter. SoA rapporterer 29 implementert / 50 delvis / 11 planlagt av 93 kontroller. | **Åpen** | L | P0 lukket; to kvartaler med bevis; internrevisjon og ledelsesgjennomgang; CPA-avtale. Ingen sertifiseringspåstand før sertifikat/rapport foreligger. |
| **GOV-02** · Pliktsegregering (to-personers godkjenning) | Ingen serverhåndhevet to-personers regel for destruktive/finansielle handlinger (GDPR-sletting, kreditnota, rolletildeling, modulbrytere). | **Åpen** | M | To-personers godkjenning håndhevet på serveren med requester/approver-separasjon, revisjonsspor, negative tester og dokumentert kompenserende policy. |
| **GOV-03** · Operativ nøkkelrotasjon | API-nøkler kan roteres. `NEXTAUTH_SECRET`, DB-/SMTP-/SMS-hemmeligheter, age-identitet og gamle backuper har ingen dokumentert rotasjonsplan med overlappsvindu. | **Åpen** | S | Runbook med overlappsvindu, re-kryptering av gamle backuper, test av gammel/ny nøkkel og gjennomført rotasjonsøvelse. |
| **GOV-04** · SLO, beredskap og support-SLA | Varsler finnes, men ingen publiserte SLO-er, error budget, on-call-rotasjon eller supportnivåer med responstider. | **Åpen** | M | Publiserte interne SLO-er og error budget; dashbord-/varselkobling; on-call-rotasjon; supportnivåer med responstider; test av varselkjeden. |

### P2 — produkt, integrasjon og plattformdybde

| ID | Oppgave | Status | Størrelse | Akseptanse |
| --- | --- | --- | --- | --- |
| **INT-01** · Utgående signerte webhooks | **Mangler.** Bare innkommende webhooks for SMS, betaling og SCIM finnes. Ingen abonnementsmodell, levering, retry, dead letter eller HMAC-signering. | **Åpen** | L | Abonnements-/admin-UI, HMAC per hendelse, retry med backoff, DLQ/replay, idempotens, revisjon og tester for 2xx/4xx/5xx/timeout. |
| **INT-02** · E-faktura, Peppol/EHF, KID/OCR og bankavstemming | **Mangler.** Ingen Peppol-kode, EHF-generering, KID/OCR-referanse eller bankavstemming. | **Åpen** | XL | Gyldig EHF/Peppol-testfaktura, KID/OCR, avstemming mot innbetalinger, revisjonsspor og feilhåndtering. Krever kommersiell beslutning/access point. |
| **INT-03** · Regnskapsdybde | v1 synkroniserer per faktura med manuell retry av feilede synker. Det finnes ingen kontinuerlig bakgrunnssynk eller automatisk retry-jobb, og kreditnota/refusjon, leverandørfaktura, toveis avstemming og konfigurerbare MVA-koder mangler. | **Åpen** | L | Bakgrunnsretry, kredit-/refusjonssynk, leverandørfaktura, MVA-kodekartlegging, toveis lesing/avstemming og idempotens­tester. |
| **INT-04** · PSP-dybde | Betalingslenker finnes, men ingen refusjon/capture/void i appen, én betaling per lenke, ingen automatisk portallenke og ingen bankavstemming. | **Åpen** | M | Refusjon/void/capture, policy for automatisk portallenke, avstemming og leverandørkontrakttester. |
| **INT-05** · CRM-konnektorer | API v1, betaling og regnskap finnes. CRM-konnektorer mangler. | **Åpen** | M | Minst én CRM-integrasjon med mapping, idempotens, feilhåndtering og kontrakttest – eller dokumentert beslutning om at det ikke skal bygges. |
| **API-01** · Faktura- og utleggs-API v1 | Tilbud, lager og eksterne ordrer er levert. `invoices` og `expenses` mangler i `/api/v1`, med scopes og OpenAPI. | **Åpen** | M | Versjonerte endepunkter, scopes, modulgating, paginering, felt-RBAC, OpenAPI-kontrakttest og oppdatert baseline. |
| **INV-01** · Innkjøpsdybde | Lager og varemottak finnes. Leverandørfaktura, retur/kredit, ordreutsending/EDI, serie-/lotsporbarhet og automatisk etterfylling mangler. | **Åpen** | L | Leverandørfaktura-matching, retur/kredit, ordreutsending, serie-/lotsporbarhet, automatisk reorder og samtidighetstester. |
| **BI-01** · Rapportbygger og BI-PDF | Lønnsomhet finnes med CSV. Fri rapportbygger og PDF-eksport mangler. | **Åpen** | M | Bygger for rapportseksjoner/metrikker, lagrede definisjoner, tilgangskontroll, PDF/CSV-eksport og tester mot kildetallene. |
| **REV-03** · Prisbok og god/bedre/best | `PriceList` brukes til avtalerater, ikke som salgbar prisbok med marginer/pakker. Ingen god/bedre/best-mal. | **Åpen** | M | Prisbok med varer/pakker, kost/margin, gjenbruk i tilbud, gode/bedre/beste-varianter og tester for tilbud-til-faktura-konsistens. |
| **RBAC-01** · Redigerbar feltmatrise og granulering | Feltnivå-RBAC er rollebasert og skrivebeskyttet i UI. Ingen eksplisitte per-felt-tilganger, aggregert maskering eller avklart tekniker-/kundesegmentering av signaturer. | **Åpen** | M | Redigerbar adminmatrise, eksplisitte per-felt-tilganger, maskering i eksport/PDF der det kreves, policy for aggregater og tester per rolle. |
| **FLD-02** · Automatisk lukking av siste kjøring | Siste jobb på dagen må i dag lukkes manuelt med «Avslutt kjøring». | **Åpen** | S | Policy for auto-lukking (tidspunkt/avstand) som aldri gjetter ulønnet reise; handlingen revideres og kan korrigeres; felt-UI forklarer hvorfor; tester for neste `EN_ROUTE`, siste jobb og overnatting. |
| **OPS-07** · Masseoperasjoner | Bare dokumentopplasting har masseoperasjoner. Kunder, utstyr og oppdrag mangler masse-redigering/arkivering/tildeling. | **Åpen** | M | Massehandlinger med scope-sjekk, forhåndsvisning, resultat per rad, revisjon og rollback-/gjenopprettingssemantikk. |
| **SSO-01** · SAML/SCIM-enterpriserester | Entra group overage via Graph, IdP-metadata redigeres bare med miljøvariabler, og SAML er testet med én selvsignert test-IdP – ikke en ekte tenant i CI. | **Åpen** | M | Overage-håndtering eller dokumentert begrensning, metadata-admin-UI, minst én ekte IdP-røyktest og migrerings-/rollback-dokumentasjon. |
| **XFER-01** · Kundeoverføringsresidualer | ZIP bygges i minnet, eksportkryptering er CLI-only, automatisk nøkkeldistribusjon mangler, og Ed25519 er én deploy-identitet. Den durabelige workeren er en polling-løkke i app-prosessen, ikke en egen køtjeneste; en deployment uten app-prosesser har ingen worker. | **Åpen** | M | Strømmende ZIP, kryptering i vanlig adminflyt, nøkkeldistribusjon/rotasjon, verifisering per jobb og en worker som ikke avhenger av én app-prosess. |
| **PLAT-10** · Supply chain | Trivy, SHA-pinnede actions og digest-skanning finnes. Base image er tagget, ikke digest-pinnet; SBOM, SAST og secret-scanning mangler. | **Åpen** | M | Digest-pinning av base image/Prisma CLI, SBOM, SAST/secret-scanning, signert provenance og policy for oppdateringer. |
| **PLAT-11** · Maintenance mode og helseflate | Request-ID finnes. Maintenance mode mangler, og `/api/health` eksponerer `uptimeSeconds`. | **Åpen** | S | Maintenance mode med kontrollert 503 og unntak for helse/metrics; fjern eller begrens uptime; test av proxy/helse. |
| **PLAT-12** · Performance-budsjett og skjermbildemanifest | Lighthouse a11y-terskel er i CI. Performance-budsjett og skjermbildemanifest i CI mangler. | **Åpen** | S | Konkrete budsjettester i CI; skjermbildemanifest verifiseres; regresjoner fanges. |

### P3 — strategiske valg (krever eiergodkjenning)

P3 starter ikke uten en konkret kunde- eller driftsbegrunnelse, budsjett og en
personvern-/kommersiell vurdering.

| ID | Oppgave | Status | Størrelse | Det som må avgjøres |
| --- | --- | --- | --- | --- |
| **BOOK-01** · Direkte kundebestilling | **Bevisst utsatt.** Alle bestillinger er datoforespørsler som kontoret planlegger og bekrefter. | **Beslutning** | M | Beholde datoforespørsler, eller innføre opt-in direkte slots med kapasitetssjekk, bekreftelsespolitikk, avbestillingsvindu og overlappstester. |
| **MKT-01** · Markedsføring, leads og omtale-kampanjer | Manuell omtale-forespørsel finnes. Ingen kampanjescheduling, leadinntak eller omdømmeflyt. | **Åpen** | L | Kampanje-/trigger-modell, samtykke, leadkilde, automatisert omtale-forespørsel, metrics og unsubscribe/STOP. |
| **PLAT-07** · White-label og egne domener | Én deployment med Caddy/TLS. Ingen tenant-host-mapping eller per-tenant branding. | **Åpen** | L | Host-mapping, per-tenant branding, TLS/DNS-validering, feilhåndtering for ukjent vert og isolasjonstester. |
| **SCH-02** · Dynamisk omruting og turn-by-turn | Ruteplan, ETA og trafikkbevisst ETA finnes. Omruting underveis og turn-by-turn i feltappen mangler. | **Åpen** | L | Omruting ved avvik/trafikkhendelse, turn-by-turn-navigasjon, ETA-oppdatering og felttester. Krever personvernavklaring for kontinuerlig posisjon. |
| **AI-01** · AI, IoT, prediktivt vedlikehold og AR | Ingenting er implementert. | **Åpen** | XL | Eiergodkjent use case, datagrunnlag, personvernvurdering, målbar kvalitet og human-in-the-loop. |

---

## Beslutninger som må tas av eier

Disse blokkerer eller avgrenser oppgavene over. De er ikke kodearbeid.

1. **Markedssegment og forretningsmodell:** norsk service/vedlikehold i
   mellommarkedet, eller SMB-funksjoner som betaling/markedsføring/mobil?
2. **PSP- og regnskapssertifisering:** hvilke Stripe/Vipps-kontoer og hvilke
   Fiken/Tripletex/PowerOffice-sandboxer må være sertifisert før «produksjon»?
3. **E-faktura/Peppol:** bygge selv, partnere med access point, eller bevisst
   utsette? Dette er et norsk markedskrav, ikke bare «nice to have».
4. **Direkte bestilling:** beholde datoforespørsler, eller levere opt-in
   direkte slots?
5. **Multi-tenant/white-label:** finnes en betalende partner/franchise, eller
   er dette ikke et mål før det?
6. **AI/IoT:** hvilket konkret use case og datasett rettferdiggjør personvern-
   og kvalitetsarbeidet?
7. **Pliktsegregering og felt-RBAC:** hvilke handlinger krever to personer, og
   hvor granulær må maskeringen være for første enterprise-kunde?
8. **Lønn:** er CSV den permanente kontrakten, eller kreves en
   lønnssystemkonnektor (Tripletex/Visma/annet)?
9. **Support/SLA:** hvilke responstider og tilgjengelighetsløfter kan selges
   med dagens kontortidsmodell?
10. **ISO/SOC:** budsjett, revisor/CPA, omfang (managed service vs. selvhostet)
    og datoen fra da «sertifisert» ikke kan brukes.
11. **Native distribusjon:** offentlige butikker, MDM/Managed Google Play/Apple
    Business Manager, eller begge?
12. **Turn-by-turn/GPS:** er kontinuerlig posisjon og tredjeparts trafikkruting
    akseptabelt under personvernpolicy og arbeidsrådsregler?
13. **Leverandørfaktura/innkjøp:** trenger første kunde
    leverandørfaktura-matching, eller er varemottak nok for v1?
14. **BUSL og offentlig prising:** beholde source-available-lisens og
    tilbudsbasert salg, eller publisere pakker/«fra»-priser?

---

## Anbefalte arbeidsbølger

Rekkefølgen er avhengighetsstyrt, ikke en kontrakt. Bølger kan kjøres parallelt
når de ikke rører samme filer.

1. **Produksjonsbevis først:** PRV-01 og PRV-02. Uten dem er ikke v1Integrasjonene
   produksjonsklare, uansett hvor mange funksjoner som finnes.
2. **Governance som blokkerer salg:** GOV-02, GOV-03 og GOV-04. Deretter
   GOV-01 når P0-punktene i compliance er lukket.
3. **Integrasjonsflate:** INT-01, API-01 og INT-05. Deretter INT-03 og INT-04
   som dybde i eksisterende leverandørflyt.
4. **Produktdybde:** REV-03, BI-01, INV-01, RBAC-01 og OPS-07.
5. **Feltkvalitet:** FLD-02.
6. **Plattformhygiene:** PLAT-10, PLAT-11, PLAT-12 og XFER-01.
7. **Strategisk:** BOOK-01, MKT-01, PLAT-07, SCH-02 og AI-01 – bare etter
   eiergodkjenning.

---

## Vedlikeholdsregler

- **Kilde til sannhet:** denne filen er køen. Verifiser alltid mot kode,
  `CHANGELOG.md`, `DECISIONS.md`, manualen og `OPERATIONS.md` før status endres.
- **Når noe leveres:** flytt oppgaven til «Levert», fjern den fra åpen tabell,
  oppdater `CHANGELOG.md` og fagdokumentasjonen, og legg ved commit, testkjøring
  og kjente begrensninger.
- **Akseptansegater:** `npm run typecheck`, `npm test`, `npm run lint`,
  `npm run check:i18n:strict` og `npm run build` skal være grønne.
  Server-/dataendringer krever i tillegg `npm run test:integration` mot reell
  PostgreSQL. Sikkerhets- og GDPR-endringer krever negative tester (403,
  avvist sletting, hold-bevis).
- **Docs-only endringer:** `git diff --check`, `npm run compliance:links` og en
  lokal lenkesjekk er nok; ikke kjør apptester bare for tekst. Rapporter hva
  som er verifisert.
- **Ingen duplikater:** ikke gjenåpne levert kjerne, sikkerhet, GDPR, revisjon,
  SMS, SSO-brukere, feltapp, QR, rute/ETA, PDF, kvote, kundeoverføring v1,
  kundeadskillelse, enhetsflytting, FullCalendar 7, arbeidsdager,
  SLA-opprydding, dashbord-live eller P2 v1 som nye prosjekter.
- **P3 krever godkjenning:** ikke start BOOK-, MKT-, PLAT-07-, SCH-02- eller
  AI-arbeid uten eiergodkjenning og dokumentert begrunnelse.
- **Hold listen ærlig:** ikke skriv «levert» uten akseptansekriteriene og bevis.
  Ikke skjul kjente begrensninger; løft dem til egne ID-er.
- **Lenker:** interne lenker skal peke på eksisterende filer i `docs/`.
