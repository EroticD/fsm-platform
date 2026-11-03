# Remaining feature worklist

> **Status snapshot:** `dev` @ `e83f38c` + merge (app 0.8.6), 2026-11-03.
> This is a queue for workers, not a description of shipped behaviour.
> Do not mark an item done without the acceptance criteria and the gates below.

## Status etter 0.8.6 (2026-11-03)

Levert og verifisert i 0.8.6:

- **CORE-01–04** — bemanning/kompetanse/kapasitet, portaldelegering,
  kundesteder og planlegging av datoforespørsler i bookingkøen.
- **SEC-01–05** — krypterte offline-kladder med PIN, PDF-sanering,
  strømmende opplasting med kvoter, API-nøkkel-scopes/rotasjon og påkrevd 2FA.
- **DATA-02/03** — hash-kjedet revisjonslogg med oppbevaring/legal hold,
  revisjonseksport og signert bevis-eksport per oppdrag.
- **OPS-01–04** — automatiserte backuper med ferskhetskontroll, metrics/
  varsler, trusted proxy og separate runtime-/migrasjonsroller.
- **UX-01–07** — vedlikeholdsplaner, utstyrsfilter, dispatch-innstillinger,
  omtaler, booking-e-post, iCal og PDF-sidesøk.
- **QA-01/02** — utvidet a11y/E2E og API-/OpenAPI-kontrakttest.
- **CUST-EXPORT-01 v1** — admin-only eksport/import av kundepakker med
  manifest, sjekksum, dry-run, id-remapping, filhåndtering og reell
  PostgreSQL-test. Se kjente begrensninger i
  [`docs/backlog-customer-export-import.md`](backlog-customer-export-import.md).

Fortsatt åpne fra denne listen: **DATA-01** (GDPR-sletting/anonymisering)
og **DOC-01** (dokumentasjon/overlappspolicy), samt P3.


## How to work this list

- One branch/worktree per item, named `feat/<id>-<short-name>`.
- Read the evidence before changing code. Some “missing” features already have a
  service but no UI; do not duplicate the service.
- Keep `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration`,
  `npm run lint`, `npm run check:i18n:strict` and `npm run build` green.
- Re-authorise every server action. A hidden button is not access control.
- Preserve Norwegian-first UI and complete nb/en/pl/de catalogs.
- Do not add a migration unless the item explicitly says so. Never alter an
  existing migration.
- Do not touch untracked design-lab files.

Legend: **P1** blocked/incorrect core workflow · **P2** significant missing
capability · **P3** polish/product decision · **S/M/L** size.

---

## P0

No open P0 defect was found at the audited HEAD. Keep it that way: the P1 items
below include data-loss/privacy risks that must not be deferred indefinitely.

---

## P1 — fix before adding more product surface

### CORE-01 · Workforce and planning administration (L)

**Gap:** Skills, user skills, weekly availability, absences and capacity plans
exist in services/schema but have no production UI. Work-order skill
requirements have no writer at all, so `SKILLS` dispatch mode is inert.

**Evidence:** `src/server/workforce.ts:161-1118`,
`src/server/dispatch.ts:230-450`, `src/lib/settings-tabs.ts`,
`src/components/settings/DispatchSettingsTab.tsx`,
`src/app/kalender/kapasitet/page.tsx`, `prisma/schema.prisma`.

**Workers:**
1. Skills catalogue + per-user skills CRUD.
2. Weekly availability editor and absence CRUD.
3. Capacity-plan upsert/delete (department and per technician).
4. Work-order skill requirements on create/edit/detail, persisted in the same
   transaction as the work order.

**Acceptance:** An admin can create/assign/edit all of the above. Dispatch and
booking exclude absent/unavailable/unqualified technicians, show why, and use
real skill requirements. Overlapping availability windows and exact duplicate
absences are rejected. All mutations are audited and permission-tested.

### CORE-02 · Portal delegation editor (M)

**Gap:** `PortalDelegation` can restrict booking/documents/contracts/equipment,
but there is no write service or UI. Contacts without a row retain backward-
compatible full access.

**Evidence:** `src/server/portal-access.ts:102-122`,
`prisma/schema.prisma:316-331`, customer portal tab,
`docs/manual/nb/30-administrator.md:119`.

**Worker task:** add per-contact delegation controls on the customer card:
active, booking, documents, contracts and equipment. Persist and audit changes.

**Acceptance:** Restrictions take effect on the next request; disabled
capabilities return 403 on pages, PDFs and `/uploads`; tests cover each
capability and inactive contacts.

### CORE-03 · Booking queue can plan date-only requests (M)

**Gap:** New portal bookings are date-only requests. `/bookinger` hides the
confirm form when no time window exists and `confirmBooking` returns
`needs_planning`. The office must leave the queue and plan manually.

**Evidence:** `src/server/bookings.ts:126-132,241-243`,
`src/app/bookinger/page.tsx:194-227`,
`src/app/kundeportal/BookingForm.tsx:388-407`,
`docs/manual/nb/10-kontor.md:399-412`.

**Worker task:** add an inline “plan and confirm” flow that collects
date/start/end/technician, or link to the work-order visit planner with a safe
return path. Handle `needs_planning` explicitly.

**Acceptance:** Every PENDING request can be confirmed from `/bookinger`;
date-only requests never show “no technician” merely because a time is absent;
legacy timed requests still work.

### CORE-04 · Customer sites are manageable and linked (L)

**Gap:** `CustomerSite` is referenced by work orders, equipment and bookings, but
there is no office CRUD and no site selector on work orders/equipment. New site
input from date-only bookings is copied as text but no reusable site is created.

**Evidence:** `prisma/schema.prisma:261-285`,
`src/server/portal-expansion.ts:680-725`,
`src/server/portal.ts:595-610,740-791`,
`src/app/oppdrag/ny/page.tsx`, `src/app/enheter/ny/page.tsx`.

**Workers:** site CRUD (office and portal), primary-site rules, site selector on
work-order create/edit and equipment create/edit, creation during date-only
booking, and site display in detail/list/PDF.

**Acceptance:** New booking sites appear on the customer card and are linked to
the order; office can manage sites; equipment/orders can select them; all reads
and writes are customer-scoped; tests cover address fallback.

### DATA-01 · GDPR erasure/anonymisation, legal-hold aware (L)

**Gap:** Soft delete is retention, not erasure. PII in customers, contacts,
orders, reports, revisions, uploads and audit logs is retained indefinitely and
cannot be erased through the app.

**Evidence:** `docs/security-audit-2026-10-29.md:164-166`,
`src/server/customers.ts`, `src/lib/job-worker.ts:540-618`,
`prisma/schema.prisma`.

**Worker task:** add an admin-only erasure workflow with reason, retention
matrix, legal-hold block, identifier anonymisation and audit trail.

**Acceptance:** Direct identifiers are irreversibly anonymised while statutory
records/legal holds remain; the operation is audited; tests prove identity
fields and document metadata are removed and held evidence is preserved.

### SEC-01 · Encrypt offline drafts and outbox at rest (M)

**Gap:** IndexedDB stores customer names, addresses, report notes, photos and
signatures in plaintext for up to seven days. TTL/cache clearing exist; at-rest
encryption/PIN does not.

**Evidence:** `src/lib/offline/db.ts:20-26,71-103`,
`src/lib/offline/draft-outbox.ts`, `public/offline.js`.

**Worker task:** AES-GCM with a per-user key protected by PIN/WebAuthn; lock
after restart/idle; attempt limits; migration for existing drafts.

**Acceptance:** No plaintext PII remains in IndexedDB/localStorage; wrong
PIN/other browser profile cannot read drafts; unlocking restores the exact
draft; tests cover lockout and cleanup.

### OPS-01 · Automated, monitored backups (M)

**Gap:** Encrypted backup/restore scripts exist, but scheduling, freshness
checks, remote checksum verification and failure alerting are manual.

**Evidence:** `scripts/backup.sh`, `scripts/restore-test.sh`,
`docs/OPERATIONS.md:413-430`.

**Worker task:** ship a systemd timer or Compose job, freshness probe, checksum
verification and alert on failure. Document RPO/RTO and key recovery.

**Acceptance:** Daily backup and weekly restore test run without human action;
a missed/stale/failed backup alerts; restore drill passes against a real
database; remote copy is verified.

### OPS-02 · Monitoring and alerting (M)

**Gap:** Only JSON logs and Docker healthchecks exist. No metrics, alert rules or
continuous readiness probe.

**Evidence:** `src/lib/logger.ts`, `docker-compose.prod.yml`,
`docs/OPERATIONS.md:456-458`.

**Worker task:** protected metrics endpoint (or external probes) for readiness,
restarts, disk, backup age, failed document jobs, SMS dead letters and failed
notification e-mails; alert rules plus test alert.

**Acceptance:** A test alert reaches the chosen channel; dashboards/probes cover
the listed signals; runbook describes response.

### OPS-03 · Trusted proxy configuration (S/M)

**Gap:** Production defaults `TRUST_PROXY=false`, silently disabling IP rate
limits behind the documented proxy; multi-hop trusted proxies are unsupported.

**Evidence:** `docker-compose.prod.yml:71`, `src/lib/client-ip.ts:12-29`,
`src/lib/config.ts:36-69`.

**Worker task:** add `TRUST_PROXY_HOPS` or trusted CIDRs, fail/warn on ambiguous
production config, ship a Caddy/nginx example, and test spoofed
`X-Forwarded-For`.

**Acceptance:** A client-supplied header cannot change the rate-limit key;
production refuses an unsafe ambiguous proxy setup; deployment docs/config
match.

### DOC-01 · Resolve booking and overlap policy drift (S)

**Gap:** Documents/manual still promise direct slot booking and blocked
overlaps, while new bookings are date-only and overlapping visits are allowed.
Dead confirmed-booking code remains.

**Evidence:** `docs/DECISIONS.md` Phase 5A, `docs/manual/nb/10-kontor.md:407-410`,
`src/server/portal.ts:326-328,529-738`, `src/server/visits.ts`,
`src/app/api/v1/visits/[id]/route.ts`.

**Worker task:** product-owner decision: (a) restore real slot booking with
holds/atomic confirmation, or remove the dead branch and update all docs; and
(b) either block overlaps with warnings or make “busy only” explicit everywhere.

**Acceptance:** Service, UI, manual, DECISIONS and OpenAPI tell one story; no
unreachable branch; tests cover the chosen behaviour.

---

## P2 — major missing capability

### CUST-EXPORT-01 · Admin customer export/import (L) — **LEVERT (v1)**

**Gap (historisk):** No admin customer transfer package.

**Status:** **IMPLEMENTED v1 in 0.8.6.** Full specification and current
limitations:
[`docs/backlog-customer-export-import.md`](backlog-customer-export-import.md).

**Levert:** admin-only guard (ADMIN + `settings.manage`), ZIP med manifest/
sjekksum/content-addressed filer, deterministisk eksport av kunde, kontakter,
steder, delegering, utstyr, målinger, vedlikeholdsplaner, kontrakter, oppdrag,
besøk, rapporter/revisjoner/PDF, dokumenter/versjoner og vedlegg, dry-run med
konfliktanalyse, id-remapping, transaksjonell import med filstaging/rollback,
audit og innstillinger-fane. Verifisert med eksport → import i ren PostgreSQL,
inkludert avvisning av traversal/sjekksum-/MIME-feil og 403 for ikke-admin.

**Gjenstående (dokumentert, ikke påstått levert):** asynkron jobbworker/
gjenopptakelse, pakkesignatur/kryptering, kryssversjon-migratorer,
rekonciliering av final-filer etter krasj, og juridisk avklaring for
signaturbilder/HMS.


### DATA-02 · Audit retention, legal hold and export (M)

**Gap:** `AuditLog` has no retention/hold field, hash chain, export or purge job.

**Evidence:** `prisma/schema.prisma` `AuditLog`, `src/lib/job-worker.ts`,
`src/server/settings.ts`.

**Worker task:** configurable retention with legal-hold override, admin export
with manifest/hash chain, runtime DB role denied update/delete on audit rows.

**Acceptance:** Purge respects hold and retention; export verifies hashes;
tampering is detectable; tests cover boundaries.

### DATA-03 · Evidence export with hash chain (M)

**Gap:** No signed archive for one work order/report/revisions/attachments/audit
rows. Only a customer CSV exists.

**Evidence:** `docs/DECISIONS.md:177-182`,
`src/app/api/kundeportal/export/route.ts`.

**Worker task:** admin-only signed ZIP with hashes of reports, revisions,
attachments and audit rows; audit the export itself.

**Acceptance:** Archive validates offline; a changed file breaks verification;
unauthorised users get 403; tests cover one complete order and one missing file.

### SEC-02 · PDF active-content handling (S)

**Gap:** Report/revision PDFs default to inline and are not scanned/stripped.

**Evidence:** `src/app/api/rapporter/[id]/pdf/route.ts:52`,
revision PDF route, `src/lib/report-pdf-store.ts`.

**Worker task:** default `attachment`, reject/strip `/JavaScript`, `/Launch`,
`/EmbeddedFile` (qpdf or equivalent) and log the result.

**Acceptance:** JS-bearing test PDF is neutralised; browser does not render
active content inline; download still works.

### SEC-03 · Stream uploads and enforce quotas (M)

**Gap:** Upload route buffers the whole multipart body; no per-user/customer
quota.

**Evidence:** `src/app/api/upload/route.ts:88-125`, `src/lib/upload-slot.ts`,
`docs/OPERATIONS.md:439-443`.

**Worker task:** stream parts to temp files under a hard cap; per-user/customer
byte quota; cleanup; 413/507 responses.

**Acceptance:** Four concurrent large uploads stay within the memory budget; a
quota-exceeded account receives a clear error; no orphan temp files.

### SEC-04 · API key scopes and audit (M)

**Gap:** API keys inherit all owner permissions, have optional expiry and no
audit for create/revoke/rotate.

**Evidence:** `prisma/schema.prisma` `ApiKey`, `src/server/api-keys.ts`,
`src/lib/api-auth.ts`, settings API tab.

**Worker task:** scopes/read-only keys, default/max lifetime, audit rows,
last-used/expiry UI, rotation.

**Acceptance:** Out-of-scope calls 403; create/revoke/rotate are attributable in
audit; expired/revoked keys fail; tests cover every documented endpoint.

### SEC-05 · Mandatory 2FA for ADMIN/OFFICE (M)

**Gap:** Optional only.

**Worker task:** policy flag, enrollment gate, break-glass procedure, audit and
tests; update SECURITY/OPERATIONS.

**Acceptance:** Privileged users cannot complete login without 2FA once enabled;
break-glass is documented and audited; legacy accounts have an explicit grace
path.

### OPS-04 · Separate runtime and migration DB roles (M)

**Gap:** Production defaults to a superuser connection; documented roles are not
enforced.

**Worker task:** provisioning SQL/script, Compose defaults, readiness check that
runtime role cannot DDL, upgrade path for existing installs.

**Acceptance:** Runtime role is DML-only; migration role is separate; existing
deployments have a tested upgrade; audit tables are protected from app role
mutation.

### UX-01 · Maintenance-plan edit/delete (S)

**Gap:** UI only creates/pauses; service supports update/delete.

**Evidence:** `src/server/maintenance.ts:393-542`,
`src/app/enheter/[id]/page.tsx:487-582`.

**Acceptance:** All editable fields can be changed; delete blocks plans with
occurrences; confirmation and audit; tests.

### UX-02 · Equipment customer filter persistence (S)

**Gap:** `?kunde=` works only on first load; search/pagination/hierarchy drops
it.

**Evidence:** `src/app/enheter/page.tsx:123-169,206-289`.

**Acceptance:** Filter persists through search, pagination and hierarchy (or
hierarchy is disabled with explanation); counter matches; reset clears.

### UX-03 · Dispatch settings full CRUD (S/M)

**Gap:** Only first policy editable; territories cannot be edited.

**Evidence:** `src/components/settings/DispatchSettingsTab.tsx:50,188-201`,
`src/server/dispatch.ts`.

**Acceptance:** Multiple policies create/edit/deactivate; territory fields
editable; department scope; no duplicates; audit and tests.

### UX-04 · Reviews visible to staff (S/M)

**Gap:** Reviews are write-only for staff; aggregate service unused.

**Evidence:** `src/server/reviews.ts:259-279`.

**Decision/task:** either wire scoped dashboard/list or remove the aggregate.
If shown, enforce department/customer scope and avoid unnecessary reviewer PII.

### UX-05 · Booking confirmation e-mail (S)

**Gap:** `sendBookingNotification` exists but no production caller.

**Evidence:** `src/lib/email.ts:320-424`; `src/server/portal.ts:857-874`.

**Acceptance:** Exactly one localized confirmation per booking when the contact
has e-mail; SMTP failure never rolls back the booking; duplicate calls
idempotent.

### UX-06 · iCal exports visits (S)

**Gap:** Feed emits work-order date all-day events, not visit times/multiple
visits.

**Evidence:** `src/server/calendar-feed.ts:268-347`.

**Acceptance:** One VEVENT per active visit with stable UID and correct
Europe/Oslo/DST times; all-day fallback only for orders without visits.

### UX-07 · Search links to matching PDF page (S/M)

**Gap:** `pageTexts` is indexed but result links do not include the page.

**Evidence:** `README.md:25-26`, `src/lib/search.ts:1121-1126`,
`src/lib/job-worker.ts:259`.

**Acceptance:** Hit includes page and opens `#page=N`; integration test matches
indexed text to page number.

### QA-01 · Expand a11y/E2E to detail, dialogs, offline and booking (M)

**Gap:** A11y matrix omits equipment, contracts, messages, report/revision
detail and many settings tabs; E2E does not submit a booking, drag a visit, or
replay an offline draft.

**Evidence:** `e2e/a11y.spec.ts:25-52`, `e2e/booking.spec.ts`,
`e2e/visits.spec.ts`, `docs/ui-ux-backlog.md`.

**Acceptance:** Axe covers one detail page per area plus open dialog/toast and
WCAG 2.1/2.2 A tags; E2E covers booking submit→queue, drag assignment, and
offline outbox replay; regressions fail CI.

### QA-02 · API/OpenAPI contract test (S/M)

**Gap:** No automated check that routes, `docs/API.md` and OpenAPI agree; docs
already stale (q does not mention reference/order number).

**Evidence:** `src/app/api/v1/openapi.json/route.ts`, `docs/API.md:244`.

**Acceptance:** CI fails on route/spec drift; every path/parameter/status is
documented; baseline updated.

---

## P3 — product decisions or scale work (do not start without approval)

- **PLAT-01 · S3/object storage driver** (`docs/DECISIONS.md:63`): storage
  abstraction, migration, no local-disk coupling.
- **PLAT-02 · Redis/BullMQ** (`docs/OPERATIONS.md`): only needed for
  multi-replica/scale; keep DB fallback.
- **PLAT-03 · Outbound signed webhooks** (`docs/DECISIONS.md:67`): retries,
  idempotency, dead letter, settings UI.
- **PLAT-04 · SSO/OIDC/SAML + SCIM** (`docs/DECISIONS.md:68`): enterprise
  provisioning with break-glass admin.
- **PLAT-05 · Advanced RBAC/field-level permissions + separation of duties**
  (`docs/DECISIONS.md:69`).
- **PLAT-06 · HA/DR/PITR** (`docs/DECISIONS.md:73`): RPO/RTO, failover drill,
  PITR; infrastructure work.
- **PLAT-07 · White-label custom domains** (`docs/DECISIONS.md:71`): host
  mapping, TLS, tenant resolution.
- **PLAT-08 · Inventory/stock module** (`docs/DECISIONS.md:66`): stock items,
  movements, reservations; separate product area.
- **PLAT-09 · Key rotation** (`SECURITY.md`): `NEXTAUTH_SECRET`, DB/SMTP/SMS,
  age recipients, old-backup re-encryption.
- **PLAT-10 · Base image/Prisma CLI digest pinning and CI SAST/secret/
  dependency/SBOM checks** (`Dockerfile`, `.github/workflows/ci.yml`).
- **PLAT-11 · Maintenance mode + request-ID hardening + health uptime removal**
  (`src/proxy.ts`, `src/lib/logger.ts`, `/api/health`).
- **PLAT-12 · Performance budgets, screenshot-manifest CI, bulk customer/
  equipment operations** (only if product wants them).

---

## Sammenligning med ledende FSM-systemer (2026)

Grunnlag: offentlige funksjonsoversikter for ServiceTitan, Salesforce Field
Service, Microsoft Dynamics 365 Field Service, Jobber/Housecall Pro,
ServiceMax og IFS. Plattformen vår er sterk på nordisk serviceoperasjon,
feltdokumentasjon, offline, revisjonsspor og selvdrift. De største
kommersielle hullene er **quote-to-cash** (tilbud → faktura → betaling) og
**feltlogistikk** (lager/deler, rute, tid/mileage).

| Område | Ledende systemer (2026) | Status i 0.8.6 | Vurdering |
| --- | --- | --- | --- |
| Dispatch og bemanning | Drag-og-slipp, kompetanse, arbeidstid, fravær, territorier, kapasitet, auto-tildeling | ✅ Levert (CORE-01/03, UX-03) | Bra. Mangler reiseavhengig sekvensering og sanntids re-planlegging. |
| Rute- og reiseoptimalisering | Flerstoppsruter etter kjøretid, tidsvinduer, dynamisk omruting | ❌ Ikke implementert | Kart/territorier finnes, men ikke ruteoptimalisering. P3. |
| Kundeportal og booking | Sanntids ledige tider, bekreftelse, ombooking, betaling | 🟡 Datoforespørsel + kontorplanlegging + e-postbekreftelse | Bevisst produktvalg (DOC-01). Sanntids slot-booking er neste modenhetssteg. |
| Tilbud og estimater | Gode/bedre/beste-tilbud, godkjenning, konvertering til oppdrag | ❌ Ikke implementert | Største kommersielle gap. P2. |
| Fakturering og betaling | Faktura fra fullført oppdrag, MVA, betalingslenker, finansiering | ❌ Ikke implementert (prislister/SLA finnes) | Største omsetningsgap. P2. |
| Lager og deler | Lagersaldo, reservasjoner, innkjøp, bilager | ❌ Ikke implementert | P2/P3 avhengig av kundebehov. |
| Mobil feltapp | Native app, offline, navigasjon, strekkode, tid/mileage, push | 🟡 PWA med offline skjema, bilder, signatur, QR | Sterk offline-kjerne; native app/navigasjon/tid/mileage mangler. P3. |
| Tid, kjøring og utlegg | Stempling, lønnseksport, kjørebok, utlegg | ❌ Ikke implementert | P2 for entreprenørmarkedet. |
| Serviceavtaler og vedlikehold | Gjentakende planer, varsler, fornyelse, fakturering | ✅ Planer/forekomster, kontrakter, SLA, iCal | Mangler automatisert fornyelse/fakturering og forbruksbaserte avtaler. |
| Kunde kommunikasjon | SMS/e-post, påminnelser, toveis innboks, ETA-lenker | 🟡 Varsler, SMS, e-post, portal, sporing, omtaler | Mangler toveis SMS-innboks og automatiserte påminnelsesløp. P2/P3. |
| Rapportering/BI | Inntjening, utnyttelse, first-time-fix, egendefinerte rapporter | 🟡 Dashbord/statistikk og revisjonseksport | Mangler omsetnings-/lønnsomhetsanalyse og rapportbygger. P2. |
| AI/Copilot | Planleggingsforslag, sammendrag, stemmeintake, prediktivt vedlikehold | ❌ Ikke implementert | P3, men raskt økende bordstake. |
| Integrasjoner | Regnskap (QuickBooks/Xero/Fiken), CRM, betaling, webhooks | 🟡 API v1 med scopes/OpenAPI | Mangler regnskaps-/CRM-/betalingskonnektorer og utgående webhooks. P3. |
| Enterprise-plattform | SSO/SCIM, avansert RBAC, multi-tenant, HA/PITR, objektlagring | 🟡 RBAC, revisjon, separate DB-roller | SSO, multi-tenant, S3/Redis/HA er allerede P3. |
| Compliance og bevis | Revisjonskjede, legal hold, signert bevis-eksport, GDPR | ✅ Hash-kjede, legal hold, bevis- og kundeoverføring | Mangler GDPR-sletting (DATA-01) og eventuell DPA/HIPAA-malverk. |
| Utstyr og IoT | Asset hierarchy, målere, QR, garanti, IoT/prediktivt | ✅ Hierarki, målere, QR, garanti, planer | Mangler IoT-inntak, prediktiv analyse og AR/fjernhjelp. P3. |
| Skjema og dokumentasjon | Egendefinerte skjema, revisjoner, signatur, PDF | ✅ Maler, rapporter, revisjoner, signatur, PDF | Modent. |

### Nye kandidater etter sammenligningen

- **REV-01 · Tilbud og estimater (P2, L):** tilbudsbygger, gode/bedre/beste,
  godkjenning i portal, konvertering til oppdrag, versjonering og audit.
- **REV-02 · Fakturering og betaling (P2, L):** faktura fra oppdrag/rapport,
  MVA, kreditnota, betalingslenke, avstemming og regnskapseksport.
- **OPS-05 · Lager, deler og innkjøp (P2/P3, L):** lagersaldo per lager/bil,
  reservasjon mot oppdrag, innkjøpsforslag og sporbarhet.
- **FLD-01 · Tid, kjøring og utlegg (P2, M):** stempling, kjørebok,
  kvitteringer og lønnseksport.
- **FL-02 · Native feltapp og navigasjon (P3, L):** native shell, offline,
  turn-by-turn, strekkodeskanning og push.
- **SCH-01 · Rute- og reiseoptimalisering (P3, L):** kjøretid, tidsvinduer,
  dynamisk omruting og sanntids ETA.
- **COM-01 · Toveis SMS og påminnelsesløp (P2/P3, M):** felles innboks,
  maler, automatiske påminnelser og samtykkestyring.
- **BI-01 · Lønnsomhet og rapportbygger (P2, M):** omsetning per oppdrag/
  kunde/tekniker, first-time-fix, utnyttelse og eksport.
- **INT-01 · Regnskap/CRM/betaling og utgående webhooks (P3, L).**
- **AI-01 · Copilot, stemmeintake og prediktivt vedlikehold (P3, XL).**

---

## Already implemented — do not duplicate

- Searchable work-order `reference` and external order number; office/field
  display and search (`src/lib/work-order-reference.ts`, work-order pages).
- Calendar visits, drag/resize, dispatch board drag-to-assign, dry-run
  auto-assign, territories, SLA, capacity read view.
- Equipment categories/hierarchy/meters/QR/warranty, customer/contracts/
  documents/reports/portal/SMS/tracking/reviews.
- Offline PWA shell, drafts/outbox, ordering/coalescing, cache TTL and clearing.
- API keys, OpenAPI spec, API v1 work orders/visits/equipment/plans/reports;
  strict i18n, typecheck/lint/unit/integration/E2E/axe/Lighthouse/Trivy CI.
- Customer portal CSV export is not the admin transfer feature; do not extend
  it for `CUST-EXPORT-01`.

---

## Suggested worker waves

1. **P1 product unblock:** CORE-01, CORE-02, CORE-03, CORE-04.
2. **P1 risk:** SEC-01, OPS-01, OPS-02, OPS-03, DATA-01.
3. **P2 security/data:** SEC-02–05, OPS-04, DATA-02/03.
4. **P2 UX/QA:** UX-01–07, QA-01/02.
5. **Backlog only:** CUST-EXPORT-01 — wait for explicit go-ahead.
6. **P3:** only after product decisions; split by platform area.
