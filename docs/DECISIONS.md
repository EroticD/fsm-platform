# Beslutninger og avgrensninger

Denne filen oppsummerer valg som ble tatt under P2/P3-arbeidet, og hva som
bevisst er utsatt. Den er ment som grunnlag for neste planleggingsrunde.

## Fullført i denne runden

- **P2-B2** – full i18n for hovedflatene. `npm run check:i18n -- --strict` er
  grønn: 1 884 nøkler i både nb og en, og ingen hardkodede norske tekstnoder i
  JSX (PDF-motoren er bevisst unntatt).
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
  - tid og materialer med timer, summer, CSV-eksport
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
