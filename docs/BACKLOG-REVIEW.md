# Backlog review — status, gaps and next work

> **Type:** evidence-based backlog and gap review (docs + code + tests).
> This document does not certify, release or merge anything.

| Field | Value |
| --- | --- |
| Review date | 2026-11-08 |
| Worktree | `/home/garshol/Work/fsm-backlog` |
| Branch | `feat/backlog-review` |
| Commit | `a0537ae` (`fix(a11y): gjør feltpolicy-tabellen tastaturtilgjengelig`) |
| Base | `dev` at `a0537ae` |
| Version | `0.8.11` (`package.json`) |
| Mobile repo | `/home/garshol/Work/fsm-mobile` at `e6d6bc6`, read-only |
| Working tree at start | clean |
| Scope | Backlog, delivered versus documented, residual risk, stale docs, test implications |
| Out of scope | Design lab, merge, tag, release, production changes, external credential use |

## 1. Executive summary

### 1.1 Method

The review compares four evidence classes:

1. **Queue and analysis docs:** [`remaining-features.md`](remaining-features.md),
   [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md), [`MODULES.md`](MODULES.md),
   [`REV.md`](REV.md), [`INVENTORY.md`](INVENTORY.md),
   [`PAYROLL_EXPORT.md`](PAYROLL_EXPORT.md), [`BI.md`](BI.md),
   [`privacy-erasure.md`](privacy-erasure.md), [`EMAIL.md`](EMAIL.md),
   [`PAYMENTS.md`](PAYMENTS.md), [`ACCOUNTING.md`](ACCOUNTING.md),
   [`PUSH.md`](PUSH.md), [`ROUTING.md`](ROUTING.md), [`STORAGE.md`](STORAGE.md),
   [`SCALING.md`](SCALING.md), [`compliance/`](compliance/), and
   [`README.md`](../README.md).
2. **Feature wiring:** module catalog in [`src/lib/modules.ts`](../src/lib/modules.ts),
   navigation and settings tabs, page tree, API v1 routes, Prisma schema.
3. **Implementation evidence:** server services, route handlers, workers and
   provider adapters under [`src/server`](../src/server),
   [`src/lib`](../src/lib) and [`src/app/api`](../src/app/api).
4. **Test evidence:** unit and integration tests under `src/**/*.test.ts`,
   Playwright specs under [`e2e/`](../e2e), CI in
   [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

Repository facts measured at `a0537ae`:

| Fact | Measured value | Evidence |
| --- | --- | --- |
| Prisma models / enums | **113 / 26** | `prisma/schema.prisma` |
| `page.tsx` files | **91** | `src/app` |
| `route.ts` files under `src/app/api` | **82** | `src/app/api` |
| Test files under `src` | **394** (40 integration) | `src/**/*.test.ts*` |
| Playwright specs | **13** | `e2e/*.spec.ts` |
| Module keys | **22** (core + 21 togglable) | `src/lib/modules.ts` |
| API v1 resource families | 10 (no quotes, invoices, inventory, expenses) | `src/app/api/v1` |

The audit did **not** call real PSP, accounting, traffic, SAML, S3, Redis,
SMTP, FCM or APNs endpoints. Those remain production-verification gaps, not
code gaps.

### 1.2 Headline findings

- **P1 queue is genuinely empty.** DATA-01 and DOC-01 have code, tests and
  docs. No unlisted P1 code regression was found.
- **P2 is delivered as v1, not done.** Quotes, invoicing/payments/accounting,
  inventory/purchasing, expenses/payroll export, BI and customer transfer all
  have real code, module gates and tests. Their residuals are now the gap.
- **Most remaining risk is outside the core FSM flow:** production proof with
  real credentials, operational evidence (PITR/failover, SLO, ISO/SOC), native
  store readiness, integration surface (outbound webhooks, external orders,
  e-invoice/Peppol), and commercial depth (pricebook, marketing, support SLA).
- **The biggest stale document is [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md).**
  It still describes the platform as having no PSP, accounting, e-mail,
  SAML/SCIM groups, field RBAC, S3, Redis or HA/PITR. All of those now exist at
  least as v1. Other stale rows are listed in §4.
- **Open gaps in this review: 28** — 7 P1 (production proof/governance), 19 P2
  (product/integration depth), 2 P3 (strategic).

## 2. Status against the existing queue

Status vocabulary:

- **Delivered** — code, tests, docs and wiring exist; no known blocker.
- **Partial** — primary flow exists, but named residual remains.
- **Missing** — no implementation found.
- **Residual** — debt inside a delivered item, not a new feature.

### 2.1 P1

| ID | Queue claim | Audited state | Evidence | Residual |
| --- | --- | --- | --- | --- |
| DATA-01 · GDPR erasure | Delivered | **Delivered** | [`src/server/customer-erasure.ts`](../src/server/customer-erasure.ts), [`customer-erasure.test.ts`](../src/server/customer-erasure.test.ts), [`privacy-erasure.md`](privacy-erasure.md), customer privacy page | Backup deletion is explicitly out of scope and documented. |
| DOC-01 · booking/overlap | Delivered | **Delivered** | [`src/server/bookings.ts`](../src/server/bookings.ts), [`bookings.test.ts`](../src/server/bookings.test.ts), `DECISIONS.md` Phase 5A, manual | Direct-slot confirmation is deliberately not offered; date requests are the product decision. |

**P1 verdict:** no open P1 in the queue. The P1 gaps in §3 are
production-readiness/governance gaps, not missing core code.

### 2.2 P2

| ID | Delivered state | Evidence | Residual that remains |
| --- | --- | --- | --- |
| **REV-01** · Quotes | **Delivered v1** | [`src/server/quotes.ts`](../src/server/quotes.ts), `/tilbud/**`, [`quotes-scope.test.ts`](../src/server/quotes-scope.test.ts), [`integration/quotes-invoicing.integration.test.ts`](../src/server/integration/quotes-invoicing.integration.test.ts) | Print-to-PDF only; no server PDF; no good/better/best or reusable pricebook. E-mail now exists via the outbox, contrary to [`REV.md`](REV.md) line 118. |
| **REV-02** · Invoicing/payment | **Delivered v1** | [`src/server/invoices.ts`](../src/server/invoices.ts), [`src/server/payments.ts`](../src/server/payments.ts), [`src/server/accounting.ts`](../src/server/accounting.ts), `/faktura/**`, `/api/webhooks/payments/[provider]` | No PSP refund/capture/void, NOK only, manual accounting sync, no e-invoice/Peppol, no bank reconciliation. |
| **OPS-05** · Inventory/purchasing | **Delivered v1** | [`src/server/inventory.ts`](../src/server/inventory.ts), [`src/server/purchasing.ts`](../src/server/purchasing.ts), `/lager/**`, [`integration/inventory-expenses.integration.test.ts`](../src/server/integration/inventory-expenses.integration.test.ts) | No supplier invoice, returns/credit, order send/EDI, serial/lot, automatic reorder. |
| **FLD-01** · Trips/expenses/payroll CSV | **Delivered v1** | [`src/server/expenses.ts`](../src/server/expenses.ts), `/utlegg/**`, [`lib/expenses.test.ts`](../src/lib/expenses.test.ts), [`integration/inventory-expenses.integration.test.ts`](../src/server/integration/inventory-expenses.integration.test.ts) | No payroll-system connector; CSV is the contract. |
| **BI-01** · Profitability | **Delivered v1 + actual revenue** | [`src/server/bi.ts`](../src/server/bi.ts), `/lonnsomhet`, [`lib/bi.test.ts`](../src/lib/bi.test.ts), [`integration/bi-actual.integration.test.ts`](../src/server/integration/bi-actual.integration.test.ts) | No per-work-order cost ledger, no absence in BI availability, no free report builder, CSV only. |
| **CUST-EXPORT-02** · Transfer hardening | **Delivered v1** | [`src/lib/customer-transfer/`](../src/lib/customer-transfer), worker, encryption/signature tests, [`integration/customer-transfer.integration.test.ts`](../src/server/integration/customer-transfer.integration.test.ts) | ZIP is in memory, export encryption only via CLI, no automatic key distribution, Ed25519 is one deploy identity. |

**P2 verdict:** all six are delivered v1. Do not reopen them as new projects;
address the named residuals as separate gaps.

### 2.3 Technical debt and residual risk

| ID | Queue state | Audited state | Evidence | Residual |
| --- | --- | --- | --- | --- |
| **FLD-02** · Auto-close last trip | Open | **Missing** | No auto-close policy in [`src/server/expenses.ts`](../src/server/expenses.ts) or visit close path; manual “Avslutt kjøring” remains | Policy decision needed so unpaid travel is never guessed. |
| **UX-08** · FullCalendar visual QA | Open | **Partial** | FullCalendar 7 in `/kalender/**`; no visual regression test | Two-week header, 07:00 scroll, clipped short events. |
| **UX-09** · Live map prerequisites | Open | **Partial** | [`src/lib/map-technician-layer.ts`](../src/lib/map-technician-layer.ts), dashboard field status; tracking requires department setting and technician sharing | Empty-state copy/links and fresh-ping test. |
| **DATA-04** · Visit backfill | Delivered | **Delivered** | [`src/server/visit-backfill.ts`](../src/server/visit-backfill.ts), `npm run visits:backfill:daily`, integration coverage | — |
| **SEC-06** · Atomic quota | Delivered | **Delivered** | [`src/lib/upload-quota.ts`](../src/lib/upload-quota.ts), `UploadQuotaReservation`, integration test | — |
| **OPS-06** · SLA cleanup | Delivered | **Delivered** | [`src/server/sla-cleanup-job.ts`](../src/server/sla-cleanup-job.ts), scheduler, metrics, [`sla-cleanup-job.test.ts`](../src/server/sla-cleanup-job.test.ts) | — |

### 2.4 P3

| ID | Audited state | Evidence | What remains |
| --- | --- | --- | --- |
| **PLAT-01** · S3/object storage | **Partial** | [`src/lib/storage/`](../src/lib/storage), [`STORAGE.md`](STORAGE.md), `npm run storage:migrate` | No real S3/MinIO smoke test, versioning or large-PDF load test. |
| **PLAT-02** · Redis queue/cache | **Partial** | [`src/lib/infra/`](../src/lib/infra), [`SCALING.md`](SCALING.md), DB fallback | No real Redis load test with 2+ replicas; BullMQ not evaluated. |
| **PLAT-03** · Outbound signed webhooks | **Missing** | Only inbound SMS/payment/SCIM endpoints exist; no outbound subscription, delivery, retry or DLQ model | Full webhook platform. |
| **PLAT-04** · SSO/OIDC/SAML/SCIM | **Delivered v1** | [`src/lib/saml.ts`](../src/lib/saml.ts), [`src/server/scim-groups.ts`](../src/server/scim-groups.ts), `/api/scim/v2/**`, `/auth/saml/[slug]/**`, tests | Entra group overage, IdP metadata UI, real-tenant smoke test. |
| **PLAT-05** · Field RBAC/SoD | **Partial** | [`src/lib/field-rbac.ts`](../src/lib/field-rbac.ts), [`RBAC.md`](RBAC.md), field policy matrix | No editable matrix, no per-field granularity, no two-person rule. |
| **PLAT-06** · HA/DR/PITR | **Partial** | [`docker-compose.ha.yml`](../docker-compose.ha.yml), [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md), `restore-pitr.sh` | No measured restore drill, failover test or load test; Compose has no DB failover. |
| **PLAT-07** · White-label/custom domains | **Missing** | Single `Branding` row; no host-to-tenant mapping | Per-tenant branding, DNS/TLS validation, unknown-host handling. |
| **PLAT-08** · Stock module | **Moved** | Now OPS-05 | Historical reference only. |
| **PLAT-09** · Key rotation | **Partial** | API key rotation in [`src/server/api-keys.ts`](../src/server/api-keys.ts) | Infra secrets, age identity, old-backup re-encryption and rotation test. |
| **PLAT-10** · Supply chain | **Partial** | Trivy and SHA-pinned actions in CI; digest scanning | Digest-pinned base/Prisma CLI, SBOM, SAST, secret scanning, signed provenance. |
| **PLAT-11** · Maintenance mode/request ID/health | **Partial** | Request ID; `/api/health` still exposes `uptimeSeconds` | Maintenance mode with 503 and health/metrics exceptions. |
| **PLAT-12** · Performance/screenshots/bulk | **Partial** | Lighthouse a11y threshold in CI | Performance budget, screenshot manifest in CI, customer/equipment bulk operations. |
| **NATIVE-01** · Native app/push | **Partial** | `fsm-mobile` push bootstrap, signing CI and native projects; [`docs/PUSH.md`](PUSH.md) server outbox | Real FCM/APNs credentials, store accounts/listing, physical-device QA. |
| **SCH-02** · Traffic/reroute/turn-by-turn | **Partial** | [`src/lib/routing/traffic.ts`](../src/lib/routing/traffic.ts), [`src/server/route-plan.ts`](../src/server/route-plan.ts), [`ROUTING.md`](ROUTING.md) | Traffic-aware ETA exists; dynamic rerouting and turn-by-turn do not. |
| **AI-01** · AI/IoT/predictive/AR | **Missing** | No AI, IoT or predictive code | Full product decision and data foundation. |
| **INT-01** · Accounting/CRM/payments/webhooks | **Partial** | PSP, accounting and REST API v1 exist | CRM connectors and outbound webhooks missing. |

## 3. What is missing now

These are audit-priority gaps, not a replacement for the queue's P1/P2/P3
labels. Count: **28 open gaps** (7 P1, 19 P2, 2 P3). Multi-tenant and AI/IoT
remain P3 because no paying customer or owner decision is recorded.

### 3.1 P1 — production proof and commitments

| ID | Gap | Evidence | Acceptance criteria |
| --- | --- | --- | --- |
| **GAP-01** | No end-to-end verification with real providers: PSP (Stripe/Vipps), accounting (Fiken/Tripletex/PowerOffice), traffic (TomTom/HERE), SAML IdP, S3/MinIO, Redis, SMTP, FCM/APNs. | [`PAYMENTS.md`](PAYMENTS.md) line 172, [`ACCOUNTING.md`](ACCOUNTING.md) line 148, [`PUSH.md`](PUSH.md) line 229, [`STORAGE.md`](STORAGE.md) line 146, [`SCALING.md`](SCALING.md) line 143; all secrets are empty/commented in [`.env.example`](../.env.example). | A dated smoke-test record per provider, with request IDs, failure modes, and **no secrets in the repo**. Each provider either passes or is explicitly marked not production-ready. |
| **GAP-02** | HA/failover/PITR has never been drilled, and RTO/RPO are targets rather than measurements. | [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md) line 155, [`SCALING.md`](SCALING.md) line 143; `docker-compose.ha.yml` has no automatic DB failover. | A real restore + PITR + failover exercise with measured RTO/RPO, data-loss boundary, operator log and updated runbook. |
| **GAP-03** | Native app is not store-ready: no real signing keys, store listings or device matrix; push is code-complete but not proven end-to-end. | `fsm-mobile/docs/NATIVE.md` §“Hva som gjenstår før butikk”; signing CI exists, credentials do not; [`PUSH.md`](PUSH.md) line 229. | Signed AAB/IPA produced from CI, store listing and privacy text, physical-device matrix for push foreground/background/cold start, deep links, camera/QR, upload and offline recovery. |
| **GAP-04** | ISO 27001/SOC 2 is a readiness package, not operating evidence. | [`compliance/GAP-ANALYSIS.md`](compliance/GAP-ANALYSIS.md): 6 P0 and 7 P1 gaps; [`compliance/ISO27001-SOA.md`](compliance/ISO27001-SOA.md) line 60 reports 29 implemented / 50 partial / 11 planned of 93 controls. | P0 gaps closed, two quarters of evidence, independent internal audit, management review, CPA engagement; no certification claim before a certificate/report exists. |
| **GAP-05** | No separation of duties or two-person approval for destructive/financial actions (GDPR erasure, credit note, role changes, module toggles). | [`RBAC.md`](RBAC.md) residual; [`compliance/ISO27001-SOA.md`](compliance/ISO27001-SOA.md) control 5.3 is Partial. | A server-enforced two-person rule for named actions, with requester/approver separation, audit trail, negative tests and a documented compensating policy. |
| **GAP-06** | No operational key-rotation plan: API keys rotate, but `NEXTAUTH_SECRET`, DB/SMTP/SMS, age identity and old backups do not. | [`remaining-features.md`](remaining-features.md) line 222 PLAT-09; [`BACKUP-RESTORE.md`](BACKUP-RESTORE.md) line 77. | Rotation runbook with overlap window, re-encryption of old backups, tested old/new key path, and a recorded rotation exercise. |
| **GAP-07** | No SLO/error budget, on-call model or customer support SLA. Alerts exist, but availability commitments are not defined. | [`deploy/monitoring/fsm-alerts.yml`](../deploy/monitoring/fsm-alerts.yml), [`OPERATIONS.md`](OPERATIONS.md) line 363; [`compliance/README.md`](compliance/README.md) assumption A6 (no 24/7 SOC). | Published internal SLOs and error budget, dashboard/alert mapping, on-call rota, support tiers and response targets, and a test of the alert path. |

### 3.2 P2 — product and integration depth

| ID | Gap | Evidence | Acceptance criteria |
| --- | --- | --- | --- |
| **GAP-08** | **Outbound signed webhooks are missing.** There is no subscription model, event delivery, retry, dead-letter queue or HMAC signing. | PLAT-03 in [`remaining-features.md`](remaining-features.md) line 216; only inbound SMS/payment/SCIM routes exist; no outbound webhook worker in `src/server`. | Subscription/admin UI, per-event HMAC, retries with backoff, DLQ/replay, idempotency, audit and tests for success/4xx/5xx/timeout. |
| **GAP-09** | **External order-system integration is missing.** API v1 can create an internal work order, but there is no external order id, inbound connector, mapping, reconciliation or status write-back. | [`src/app/api/v1/work-orders/route.ts`](../src/app/api/v1/work-orders/route.ts) `CREATE_FIELDS` has no external reference/idempotency key; no integration/queue model in `prisma/schema.prisma`. | An idempotent inbound order adapter with external-id mapping, customer/site/asset resolution, duplicate detection, status write-back, retry/reconciliation and contract tests. |
| **GAP-10** | **Quote, invoice, inventory and expense API v1 are missing.** `modules.ts` even declares `/api/tilbud` without a route. | [`src/app/api/v1`](../src/app/api/v1) contains no quotes/invoices/inventory/expenses; [`src/lib/api-key-scopes.ts`](../src/lib/api-key-scopes.ts) has no such scopes; OpenAPI excludes them. | Versioned endpoints, scopes, module gates, pagination, field-level redaction, OpenAPI contract tests and a published baseline. |
| **GAP-11** | **E-invoice/Peppol/EHF, KID/OCR and bank reconciliation are missing.** | [`PAYMENTS.md`](PAYMENTS.md) line 170 states “Ingen e-faktura/Peppol/OCR/KID”; no Peppol code in `src`. | Valid EHF/Peppol test invoice, KID/OCR reference, bank reconciliation against payments, audit trail and failure handling. |
| **GAP-12** | **Accounting/ERP depth is v1 only:** manual per-invoice sync, no automatic retry, credit note/refund sync, two-way sync, supplier invoices or rich VAT mapping. | [`ACCOUNTING.md`](ACCOUNTING.md) line 148; [`INVENTORY.md`](INVENTORY.md) residual. | Background retry, credit/refund support, supplier invoice path, configurable VAT codes, two-way read/reconcile and idempotency tests. |
| **GAP-13** | **Field-level RBAC has documented limits:** no editable matrix, no per-field granularity, explicit keys are DB-only, PDFs keep historical data, BI aggregates are not masked, technician/customer signature split is unresolved. | [`RBAC.md`](RBAC.md) residual; [`src/lib/field-rbac.ts`](../src/lib/field-rbac.ts); field policy matrix is read-only. | Editable admin matrix, explicit per-field grants, redaction in exports/PDF generation where required, aggregate masking policy and role-by-role tests. |
| **GAP-14** | **Bulk operations are limited to document upload.** Customers, equipment and work orders have no bulk edit/archive/assign. | Document bulk upload exists; PLAT-12 in [`remaining-features.md`](remaining-features.md) line 225. | Bulk actions with scope checks, preview, per-row result, audit and rollback/recovery semantics. |
| **GAP-15** | **No free report builder and no BI PDF export.** Template builder exists, but arbitrary report definitions do not. | [`BI.md`](BI.md) v1 residual; `/lonnsomhet` exports CSV only; `/innstillinger/maler` is a checklist template builder. | Builder for report sections/metrics, saved definitions, permissions, PDF/CSV export and tests against source data. |
| **GAP-16** | **No pricebook or good/better/best.** `PriceList` exists for contract rates, not a sellable pricebook with margin/packages. | `PriceList`/`PriceListItem` in schema; PLATFORM-ANALYSIS matrix says missing; no pricebook UI. | Pricebook with items/packages, cost/margin, quote reuse, good/better/best variants and quote-to-invoice consistency tests. |
| **GAP-17** | **Customer direct booking is deliberately absent.** All bookings are date requests. | [`src/server/bookings.ts`](../src/server/bookings.ts), DOC-01 in [`remaining-features.md`](remaining-features.md) line 72, DECISIONS Phase 5A. | Owner decision; if approved, opt-in direct slot with capacity check, confirmation policy, cancellation window and overlap tests. |
| **GAP-18** | **Marketing, lead generation and review campaigns are missing.** Manual review request exists; no campaign scheduling, lead intake or reputation workflow. | [`src/server/reviews.ts`](../src/server/reviews.ts) `requestReview`; no campaign/lead models or pages. | Campaign/trigger model, consent, lead source, review request automation, metrics and unsubscribe/STOP handling. |
| **GAP-19** | **No overtime or route/labour policy.** Route optimization supports work hours, absence, skills and priority, but no overtime, rest breaks, lunch, depot, multi-day routes or max driving time. | [`ROUTING.md`](ROUTING.md) line 115; [`src/lib/routing/route-optimizer.ts`](../src/lib/routing/route-optimizer.ts); no overtime model in schema. | Configurable overtime/rest/driving rules, policy-aware scheduling, warnings when a plan breaks them and tests for each rule. |
| **GAP-20** | **No dynamic rerouting or turn-by-turn.** Traffic ETA is single-leg; matrix routing is OSRM without traffic. | [`ROUTING.md`](ROUTING.md) line 121; SCH-02. | Reroute on deviation/traffic event, turn-by-turn navigation handoff, ETA refresh and field tests. |
| **GAP-21** | **Inventory/procurement stops at goods receipt:** no supplier invoice, returns/credit, order send/EDI, serial/lot, automatic reorder. | [`INVENTORY.md`](INVENTORY.md) residual. | Supplier invoice matching, returns/credit, order transmission, serial/lot traceability, reorder automation and concurrency tests. |
| **GAP-22** | **PSP depth is limited:** no refund/capture/void from the app, one payment per link, no automatic portal link, no bank reconciliation. | [`PAYMENTS.md`](PAYMENTS.md) line 158. | Refund/void/capture workflows, portal auto-link policy, reconciliation and provider-contract tests. |
| **GAP-23** | **SAML/SCIM enterprise residuals:** Entra group overage via Graph, IdP metadata only via environment, no real-tenant CI test. | PLAT-04 in [`remaining-features.md`](remaining-features.md) line 217. | Overage handling or documented limit, metadata admin UI, at least one real IdP smoke test and migration/rollback docs. |
| **GAP-24** | **Customer transfer residuals:** in-memory ZIP, CLI-only export encryption, no automatic key distribution, Ed25519 is one deploy identity. | CUST-EXPORT-02 residual; [`MODULES.md`](MODULES.md) line 150. | Streaming ZIP, encryption in the normal admin flow, key distribution/rotation and per-job verification. |
| **GAP-25** | **Field-operations residuals:** FLD-02 auto-close, UX-08 calendar visual QA, UX-09 live-map prerequisites. | [`remaining-features.md`](remaining-features.md) line 201; calendar and map code. | Policy-based auto-close, visual regression coverage, empty-state links and fresh-ping tests. |
| **GAP-26** | **Platform hygiene and supply chain:** maintenance mode, performance budget, screenshot manifest in CI, SBOM/SAST/secret scanning, digest pinning. | PLAT-10/11/12. | Maintenance mode with health exceptions, CI budgets and manifest, SBOM/SAST/secret scan, digest-pinned base image and provenance. |

### 3.3 P3 — strategic, needs owner decision

| ID | Gap | Evidence | Acceptance criteria |
| --- | --- | --- | --- |
| **GAP-27** | **No multi-tenant/white-label or custom domains.** One deployment, one `Branding` row, no host mapping. | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 68; schema `Branding`; PLAT-07. | Tenant model and data isolation, host-to-tenant mapping, per-tenant branding, TLS/DNS validation, unknown-host fallback and isolation tests. |
| **GAP-28** | **No AI/Copilot, IoT intake, predictive maintenance or AR.** | AI-01 in [`remaining-features.md`](remaining-features.md) line 236; no code. | Owner-approved use case, data/privacy assessment, measurable model/ingest quality and human-in-the-loop controls. |

## 4. Contradictions and stale docs found

I did **not** rewrite these documents. The only corrections applied are in
[`remaining-features.md`](remaining-features.md), where a row was objectively
wrong. Recommended corrections below.

| # | Location | Stale claim | Current reality | Recommended correction |
| --- | --- | --- | --- | --- |
| 1 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 27 lines 27–29 | “Vi mangler … betalinger/finansiering … ruteoptimalisering” | Stripe/Vipps payment links and route optimization with traffic-aware ETA exist as v1. | Change to “mangler finansiering/refusjon, moden mobilapp og markedsføring; betaling og ruteoptimalisering er v1”. |
| 2 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 39 line 39 and line 349 | Missing SAML/SCIM groups, field RBAC, S3, Redis, HA/PITR | All are delivered/partial: SAML/SCIM/RBAC v1, S3/Redis/HA profiles. | Replace with residual wording (real IdP/S3/Redis proof, no SoD). |
| 3 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 63 lines 63–65 | 101 models / 23 enums; 71 API routes; 327 test files / 2 986 unit / 33 integration files | 113 / 26 models/enums; 82 API routes; 394 test files / 40 integration files. | Recompute from `prisma/schema.prisma`, `find src/app/api -name route.ts`, `find src -name '*.test.ts*'`. |
| 4 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 80 lines 80–81 and 102 | Database-only queue; no Redis/BullMQ, S3 driver or worker; no Redis/S3/HA/PITR | `src/lib/infra`, `src/lib/storage`, `docker-compose.ha.yml` exist. | Update to “DB fallback with optional Redis/S3; HA/PITR scripted but not drilled”. |
| 5 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 88 line 88 | “ikke trafikk eller optimalisering” | Traffic ETA and 2-opt optimization exist. | Say “trafikk-ETA og optimalisering; ikke dynamisk omruting/turn-by-turn”. |
| 6 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 100 line 100 | “ingen regnskap/PSP/e-faktura/webhooks” | PSP and accounting v1 exist; e-invoice/webhooks still missing. | “PSP/regnskap v1; e-faktura og utgående webhooks mangler”. |
| 7 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 266 lines 266, 274–276, 282, 287, 300–302 | Matrix says traffic optimization, PSP, accounting, SAML and SCIM groups are absent | Route optimization, PSP, accounting, SAML and SCIM groups are present. | Change to ✅/◐ with a short residual note; leave direct booking, Peppol, AI and multi-tenant unchanged. |
| 8 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 337 lines 337–350 | “Ingen PSP/regnskap”, “Ingen e-postutsending”, “Ingen SAML/SCIM-grupper”, “Ingen S3/Redis/HA” | All four are delivered/partial. | Rewrite the weakness table around residuals: PSP depth, e-invoice, SoD, real provider proof, native store. |
| 9 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 437 lines 437–467 | P0/P1 lists ask for payments, e-mail, route optimization, SAML/SCIM/RBAC, S3/Redis/HA | These are v1 delivered; the list now duplicates the queue. | Turn into “verify and deepen” items; keep AI, pricebook, direct booking, webhooks, multi-tenant, Peppol. |
| 10 | [`PLATFORM-ANALYSIS.md`](PLATFORM-ANALYSIS.md) line 501 lines 501, 508–513, 566–568 | 2 986/184 tests; “Ingen PSP/regnskap”, “Ingen e-post”, “Ingen SAML”, “Ingen S3/Redis/HA”; next step is those P0s | Counts and statuses are stale; the next step is proof/depth, not first delivery. | Recompute counts and replace the next-step sentence with §5 of this review. |
| 11 | [`REV.md`](REV.md) lines 118–119 | “Ingen e-postutsending av tilbud/faktura … må deles manuelt” | `sendQuote`/`sendInvoice` enqueue transactional e-mail through `EmailMessage`; settings tab exists. | Replace with: e-mail is sent from the durable outbox; residual is print-to-PDF and no server-generated quote PDF. |
| 12 | [`ACCOUNTING.md`](ACCOUNTING.md) line 8 lines 8–10 | “AccountingSettings … er ikke koblet inn i denne endringen” | `src/app/faktura/innstillinger/page.tsx` renders `<AccountingSettings />`. | Delete the paragraph; document that settings live under **Faktura → Innstillinger**. |
| 13 | [`PUSH.md`](PUSH.md) line 237 lines 237–239 | “Denne serverleveransen inneholder ikke appkoden”; app must still call push-token API | `fsm-mobile` now contains the injected push bootstrap and native token flow. | Update to “server and native shell are delivered; real credentials/store/device QA remain”. |
| 14 | [`PAYROLL_EXPORT.md`](PAYROLL_EXPORT.md) line 3, [`INVENTORY.md`](INVENTORY.md) line 3, [`BI.md`](BI.md) line 8 | `fieldExpenses` depends on `calendar`; `inventory` on `equipment`; `bi` on `reports` | [`src/lib/modules.ts`](../src/lib/modules.ts) defines all P2 modules with `dependencies: []`; [`MODULES.md`](MODULES.md) line 57 says the same. | Remove the dependency claims or change the code/catalog deliberately; do not leave both stories. |
| 15 | [`remaining-features.md`](remaining-features.md) line 216 | PLAT-03: “Bare innkommende SMS-webhook finnes” | Inbound SMS, payment and SCIM endpoints exist; outbound is still missing. | Corrected in this commit: inbound SMS/payment exist; outbound signed webhooks missing. |
| 16 | [`remaining-features.md`](remaining-features.md) line 233 | NATIVE-01: “Ingen push i dag” | Server push outbox, FCM/APNs adapters, mobile token flow and signing CI exist. | Corrected in this commit: push delivered; real credentials/store/device QA remain. |
| 17 | [`remaining-features.md`](remaining-features.md) line 235 | SCH-02: “trafikkdata … mangler” | Traffic-aware ETA via TomTom/HERE with OSRM/haversine fallback is implemented. | Corrected in this commit: traffic delivered; dynamic rerouting/turn-by-turn remain. |
| 18 | [`remaining-features.md`](remaining-features.md) line 240 | INT-01: “konnektorer … mangler” (accounting/CRM/payments) | Payment and accounting connectors exist; CRM connectors and outbound webhooks do not. | Corrected in this commit: PSP/accounting v1 exist; CRM and outbound webhooks missing. |
| 19 | [`README.md`](../README.md) line 88 and line 275 | `APP_IMAGE=…:v0.8.10` | `package.json` is `0.8.11`. | Pin the current published tag or use a documented example placeholder, not an old release. |
| 20 | [`compliance/README.md`](compliance/README.md) line 5 | Baseline `feat/iso-soc2` at `dev` `c53cd26` | The package is now on `dev` `a0537ae`; scope/status counts may drift. | Update the baseline commit and date when the compliance package is next touched. |

## 5. Recommended next 10 work items

Order is dependency-aware, not a promise of sequence. “Agent” means an AI
coding agent can implement with review; “human” means an owner must decide,
procure or sign off.

| # | Gap | Priority | Size | Dependencies | Owner type | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **GAP-01** · Real-provider smoke and secret verification | P1 | M | Accounts/credentials in a secret store; staging URLs | Human (ops/owner) + agent for scripts/runbook | Dated pass/fail record per provider; no secrets in repo; every unverified provider marked “not production-ready”. |
| 2 | **GAP-02** · PITR/restore/failover drill | P1 | M | Staging Postgres/S3/Redis; backup artifacts | Human (ops) | Measured RTO/RPO, successful PITR to a new instance, failover test and updated runbook. |
| 3 | **GAP-03** · Native store release | P1 | M | Apple/Google accounts, keystore, APNs key, FCM project | Human (owner) + agent | Signed AAB/IPA from CI, store listing, physical-device matrix, push foreground/background/cold start and deep-link tests. |
| 4 | **GAP-04** · ISO/SOC operating evidence | P1 | L | GAP-01/02/05/06/07; auditor/CPA | Human (security/management) + agent for evidence automation | P0 gaps closed, two quarters of evidence, internal audit and management review records, no certification claim. |
| 5 | **GAP-05** · Separation of duties | P1 | M | Permission model and audit log | Agent + human policy owner | Two-person approval enforced server-side for erasure, credit note, role changes and module toggles; negative tests and audit proof. |
| 6 | **GAP-08** · Outbound signed webhooks | P2 | L | Event model; HMAC key management | Agent | Subscription UI, HMAC signing, retry/backoff, DLQ/replay, idempotency, audit and tests for 2xx/4xx/5xx/timeout. |
| 7 | **GAP-10** · Quotes/invoices/inventory API v1 | P2 | L | OpenAPI baseline; API scopes; field RBAC | Agent | Endpoints and scopes, module gates, pagination, redaction, OpenAPI contract test and updated baseline. |
| 8 | **GAP-09** · External order/ERP integration | P2 | L | GAP-08 and GAP-10 | Agent + human integration partner | Idempotent inbound order import, external-id mapping, customer/site/asset resolution, status write-back, reconciliation and contract tests. |
| 9 | **GAP-11** · E-invoice/Peppol/KID/OCR/reconciliation | P2 | XL | Accounting model; Peppol access point | Human (commercial decision) + agent | Valid EHF/Peppol test invoice, KID/OCR reference, bank reconciliation, audit trail and failure handling. |
| 10 | **GAP-07** · Monitoring/SLO/support model | P2 | M | Metrics and alerting; support owner | Human (owner) + agent | Published SLOs/error budget, dashboards, alert tests, on-call rota and support tiers with response targets. |

Deliberately **not** in the next 10: pricebook (GAP-16), direct booking
(GAP-17), marketing (GAP-18), report builder (GAP-15), multi-tenant (GAP-27),
AI/IoT (GAP-28). They need owner decisions or a paying customer before they
justify the cost.

## 6. Testing implications per module

There is no module-scoped test script today; CI runs the full unit,
integration and E2E suites. The table below defines what a module-based run
should include when a change touches that module. “Existing” is evidence to
reuse; “add” is the gap in coverage.

| Module | Existing evidence | What the module run must include |
| --- | --- | --- |
| `core` | `permissions`, `access`, `audit*`, session, API auth tests; `e2e/roles.spec.ts`, `smoke.spec.ts` | Permission matrix, department scope, audit hash chain, 2FA/API-key denial paths, module toggle audit. |
| `calendar` | `calendar-*`, `work-days`, `visit-*`, `dispatch-*`; `e2e/visits.spec.ts`, `dashboard-views.spec.ts` | Workday/visit invariants, drag/drop, overlap/absence, time zones, FullCalendar visual cases (UX-08). |
| `reports` | `reports`, `report-*`, `pdf-*`, `hms`; `e2e/qa-flows.spec.ts` | Template versioning, signature/PDF sanitization, legal hold, PDF inline/download, a11y. |
| `equipment` | `equipment`, `maintenance`, `scan`, `equipment-qr`; `e2e/scanner.spec.ts` | QR uniqueness, move-with-history, meter/warranty, scan fallback, customer isolation. |
| `contracts` | `contracts`, `sla*`, `contract-pdf`, `business-hours` | SLA start/stop, active contract/price list, PDF, cleanup job and metrics. |
| `portal` | `portal*`, `customer-sites`, `portal-delegation`, `portal-expansion` | Own-customer isolation, delegated rights, invoice/quote access, review request, no internal fields. |
| `booking` | `bookings`, `booking-*`; `e2e/booking.spec.ts` | Date request lifecycle, confirm/cancel, hold cleanup, e-mail enqueue idempotency, no direct-slot assumption. |
| `documents` | `documents`, `pdf-text`, `upload*`, document search; integration upload quota | Multipart/quota, OCR queue, tags/folders, S3/local driver parity, deletion/retention. |
| `sms` | `sms`, `messaging`, `reminders`; STOP/START and webhook tests | Signature/idempotency, inbound reply threading, reminder worker, consent and provider failure. |
| `map` | `map-settings`, `geo`, `geocode`, dashboard field status | Tracking-enabled gating, fresh pings, empty state, no stale/completed markers. |
| `tracking` | `tracking`, visit-location ping, ETA route | Token scope, ETA freshness, cleanup, no cross-customer leakage. |
| `reviews` | `reviews`, portal review action | One review per visit, token hashing/expiry, score validation, rate limits. |
| `transfer` | `customer-transfer` unit suite, encryption/signature/manifest, integration | Round-trip, checksum/signature failure, wrong version, resume/abort, module filtering, key rotation. |
| `auditExport` | `audit-export`, `evidence-export`, retention tests | Hash-chain proof, legal hold, signed ZIP, retention/purge, redaction. |
| `api` | `api-auth`, `api-key-scopes`, pagination, contract baseline tests | Every endpoint: auth/scope/module/field RBAC; OpenAPI equality; 401/403/404/422/429. |
| `sso` | `sso`, `saml`, `scim-*`, auth options; integration `sso-scim` | OIDC/SAML mapping, replay, audience/recipient, SCIM filter/patch, group→role/department, break-glass. |
| `offline` | `lib/offline` service-worker tests; `e2e/mobile-layout.spec.ts` | Cache allow/deny list, 7-day expiry, logout purge, draft PIN, queue replay. |
| `quotes` | `quotes`, `billing`, `quotes-scope`, `billing-module-gate`, integration | Totals/VAT/versioning, token expiry, cross-customer denial, conversion, module 404. Add API contract once GAP-10 lands. |
| `invoicing` | `invoices`, `billing`, `payments`, `accounting`, integration | VAT/credit/partial pay, overdue sweep, PSP webhook idempotency, accounting retry/idempotency, refund gap (GAP-22). |
| `inventory` | `inventory`, `purchasing`, integration `inventory-expenses` | Atomic stock, negative stock denial, concurrent reserve/consume/receive, over-receipt, department scope. |
| `fieldExpenses` | `expenses`, payroll CSV, integration | Rounding/VAT, approval, overlap/period lock, idempotent CSV, payroll connector once added. |
| `bi` | `lib/bi`, `server/bi`, integration `bi-actual` | Estimate vs actual, credit notes, department/customer/technician filters, CSV checksum, cost model and absence once added. |
| `infra` | `storage/*`, `infra/cache*`, `infra/queue*`, `rate-limit-*` | Real S3/MinIO and Redis contract tests, DB fallback, 2+ replica load, key rotation. |
| `push` | `server/push`, `lib/push/fcm|apns|jwt` | Token registration/cleanup, module gating, dead-letter, FCM/APNs contract and cold-start deep link. |
| `email` | `email-outbox`, `email-triggers`, `email-smtp`, templates | Enqueue idempotency, claim/SKIP LOCKED, retry/backoff, SMTP TLS, locale/escaping, settings off. |
| `routing` | `osrm`, `traffic`, `route-optimizer`, `route-plan` | Provider fallback, timeout/rate limit, skills/absence/work hours/priority, apply order audit, no auto-move. |
| `compliance` | `npm run compliance:links`, evidence collector | Link/path integrity, evidence pack reproducibility, no secrets/PII, status counts. |

## 7. Non-goals and decisions needed

### 7.1 Non-goals for this review

- No merge, tag, release or deployment.
- No design-lab work.
- No edits outside `feat/backlog-review`.
- No edits to the mobile repo; it was read-only evidence.
- No bulk rewrite of stale docs. Only `remaining-features.md` rows that were
  objectively wrong were corrected.
- No claim that any provider, certification or store release is verified.

### 7.2 Decisions needed from the owner

1. **Target segment and commercial model:** stay on Norwegian service/
   maintenance mid-market, or fund the SMB payments/marketing/mobile polish
   that Jobber/Housecall Pro win on?
2. **PSP and accounting certification:** which Stripe/Vipps merchant accounts
   and which Fiken/Tripletex/PowerOffice sandboxes must be certified before
   “production ready”?
3. **E-invoice/Peppol:** build, partner with an access point, or explicitly
   defer? This is a Norwegian market requirement, not a nice-to-have.
4. **Direct booking:** keep date requests only, or ship opt-in direct slots?
5. **Multi-tenant/white-label:** is there a paying partner/franchise, or is
   this a non-goal until then?
6. **AI/IoT:** which concrete use case and data set justify the privacy and
   quality work?
7. **Separation of duties and field RBAC:** which actions require two people,
   and how granular must field masking be for the first enterprise customer?
8. **Payroll:** is CSV the permanent contract, or is a payroll connector
   (Tripletex/Visma/other) required?
9. **Support/SLA:** what response times and availability commitments may be
   sold, given the current business-hours operating model?
10. **ISO/SOC:** budget, auditor/CPA, scope (managed service vs self-hosted),
    and the date from which no “certified” language may be used.
11. **Native distribution:** public stores, MDM/Managed Google Play/Apple
    Business Manager, or both?
12. **Turn-by-turn/GPS:** is continuous location and third-party traffic
    routing acceptable under the privacy policy and works-council rules?
13. **Supplier invoice/procurement:** does the first customer need supplier
    invoice matching, or is goods receipt enough for v1?
14. **BUSL and public pricing:** keep source-available licensing and quote-only
    sales, or publish packages/“from” pricing?

## Appendix A — Evidence commands used

```bash
git rev-parse --short HEAD                 # a0537ae
grep '"version"' package.json              # 0.8.11
grep -c '^model ' prisma/schema.prisma     # 113
grep -c '^enum ' prisma/schema.prisma      # 26
find src/app -name page.tsx | wc -l        # 91
find src/app/api -name route.ts | wc -l    # 82
find src -name '*.test.ts*' | wc -l        # 394
find src -path '*integration*' -name '*.test.ts' | wc -l  # 40
find e2e -name '*.spec.ts' | wc -l         # 13
npm run compliance:links                   # 35 files, 478 links, no broken paths
git diff --check                           # clean
npx tsc --noEmit                           # see commit gates
npm run lint                               # see commit gates
```

## Appendix B — Relationship to the queue

This review does not replace [`remaining-features.md`](remaining-features.md).
The queue remains the source of truth for delivered items and acceptance
gates. The gap register in §3 is the audit's cross-check: it adds production
proof and integration depth that the queue either lists as P3 or leaves
implicit in residuals.
