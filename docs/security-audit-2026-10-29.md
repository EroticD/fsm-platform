# Security audit — 2026-10-29

**Target:** `fsm-platform` at `1b9e9c1` (v0.7.5)
**Mode:** read-only static review. Six parallel audits: auth/session, authorization/IDOR,
injection/files, browser/PWA, infrastructure/supply chain, business logic/privacy.
No code was changed and no destructive tests were run.

**Result:** **0 Critical, 3 High, 18 Medium, 20+ Low/Info.**
The injection, XSS, SQL, path-traversal and file-ACL foundations are strong. The
material risks are authorization edge cases around customer ownership, account
recovery, offline caches, and lifecycle gaps after deletion/deactivation.

---

## High

### SEC-01 — Reassigning a work order moves signed reports to another customer
**Confidence:** high · **CWE-639 / CWE-915**
**Evidence:** `src/server/work-orders.ts:493,573,608-610`;
`src/server/reports.ts:1568-1570`; `src/server/portal.ts:738-741,863-865`

`updateWorkOrder` accepts a new `customerId` while the order is open, does not
check for existing reports/attachments/booking requests, and rewrites every
`Upload.customerId` to the new customer. Report/PDF access and the customer
portal authorize only by the **mutable** `WorkOrder.customerId`.

**Exploit:** an OFFICE user with `workorders.edit` changes an in-progress order
with a signed report from customer A to customer B, then completes it. B's portal
users can now read A's signed report, checklist answers, photos and signatures.
A's still-open `BookingRequest` can also cancel/reschedule the order now owned by B.

**Fix:** make `customerId` immutable once protected artifacts exist, or require
an ADMIN transfer workflow. Store an immutable customer snapshot on reports and
use it for portal/PDF authorization. Transfer upload ownership only when the
order has no reports. Scope booking mutations by both booking and work-order
customer. Audit old/new customer.

---

### SEC-02 — 2FA can be bypassed by regenerating recovery codes with only the password
**Confidence:** high · **CWE-287 / CWE-308**
**Evidence:** `src/server/security.ts:343-369`;
`src/app/innstillinger/security-actions.ts:110-127`; recovery login at
`src/app/logg-inn/actions.ts:187-219`

`regenerateRecoveryCodes` verifies the password but **not** a current TOTP code,
then returns ten fresh plaintext codes. An attacker with a stolen session cookie
plus the saved password (infostealer pattern) regenerates codes and logs in
without the second factor, surviving session expiry.

**Fix:** require a current TOTP/re-auth with both factors for regeneration;
notify the user; invalidate other sessions; require the same for every 2FA-state
change.

---

### SEC-03 — Offline PWA serves cached customer pages after session expiry
**Confidence:** high (code) · **CWE-922 / CWE-613**
**Evidence:** `public/sw.js:150-198`; `src/lib/offline/cache.ts:41-73`;
`src/components/LogoutButton.tsx:28-38`

`/mine-oppdrag`, work-order details and report forms are cached as HTML/RSC and
served offline with **no auth revalidation**. Only an explicit logout clears the
cache; session expiry, deactivation, `sessionVersion` revocation or a direct
NextAuth sign-out do not. On a shared/lost field device, the next person can read
customer names, addresses, contacts, order details and report notes offline.

**Fix:** timestamp cache entries with a maximum offline age; clear caches when any
response redirects to login or returns 401/403; re-check `/api/auth/session` on
resume/online; clear on forced logout; minimize cached PII.

---

## Medium

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| SEC-04 | **Cancelled jobs leak reports/files to technicians.** Equipment history and `/uploads` filter `deletedAt` but not `status: CANCELLED`, although report pages deliberately hide cancelled jobs. | `src/server/customers.ts:206-212,550-557`; `src/app/uploads/[...path]/route.ts:51-82`; `src/lib/access.ts:71-90` | Central status-aware work-order access for report units and uploads. |
| SEC-05 | **Deleting a contact does not revoke the portal user.** `User.contactId` is `ON DELETE SET NULL`, but `customerId`/`isActive` remain, so the removed person keeps portal access. | `src/server/customers.ts:919-928`; `prisma/migrations/0_init/migration.sql` | Deactivate linked portal users, bump `sessionVersion`, clear calendar tokens in the same transaction. |
| SEC-06 | **Soft-deleted customers can be re-opened through the portal.** `createPortalUser`, `setPortalUserActive`, PDF/revision and work-order upload auth never check `customer.deletedAt`; a reactivated user can read reports/uploads. | `src/server/users.ts:748-807`; `src/server/reports.ts:1551-1575`; `src/app/uploads/[...path]/route.ts:51-98` | Central `active customer` guard in every customer-facing service; block create/reactivate for deleted customers. |
| SEC-07 | **Office managers can demote/deactivate/reactivate more privileged colleagues.** `changeRole` checks only the *new* role's permissions; `setActive` checks no permission subset and can undo an admin suspension. | `src/server/users.ts:270-405` | Require `assignedPermissions(target) ⊆ actor` for target and new role; admin-only reactivation of suspended accounts. |
| SEC-08 | **Pending 2FA secret is reachable with a session alone, and confirmation needs no password.** An abandoned setup keeps `twoFactorSecret` forever; `?setup=1` renders the QR; `confirmTwoFactorSetup` verifies only TOTP. A session-only attacker can enroll their own authenticator (and lock out the victim). | `src/app/innstillinger/page.tsx:291`; `src/components/SecuritySettings.tsx:50`; `src/server/security.ts:186-216` | Require password again on confirm; expire pending secrets (10 min); bind setup to a server-side nonce. |
| SEC-09 | **Login/reset lockout DoS; IP limits off by default.** 10 bad passwords per email locks the account for 15 min before password verification. With `TRUST_PROXY=false` there is no IP limit; reset uses one shared `"ukjent"` bucket that anonymous users can exhaust. With a proxy, the first `X-Forwarded-For` value is trusted. | `src/lib/credentials.ts:22-73`; `src/lib/client-ip.ts:9-20`; `src/app/glemt-passord/page.tsx:29-39`; `docker-compose.prod.yml:67` | Exponential backoff instead of hard lockout; per-IP/global limits; rightmost trusted hop; no shared fallback bucket. |
| SEC-10 | **Deleted customers keep generating work.** Active contracts are not paused and the recurring scheduler/create/update paths do not check `customer.deletedAt`. | `src/lib/recurring.ts:70-113,288-295`; `src/server/work-orders.ts:258-266` | Pause/disable contracts on delete; filter `deletedAt` in scheduler and all work-order customer lookups. |
| SEC-11 | **Signature aliasing and signer impersonation.** Any `WORK_ORDER` upload from the same order is accepted as a signature, so one report's customer signature can be reused on another; `technicianName`/`customerName` are free text. | `src/server/reports.ts:49-106,883-901,1084-1113` | Report-scoped one-time signature token; reject reused signature URLs; bind names to the actor/delegation; verify image MIME. |
| SEC-12 | **Legal hold does not freeze work-order metadata.** Title, description, customer, address, date, tags, contact and templates remain editable while `legalHold` is set. | `src/server/work-orders.ts:418-450,715-737,844-993` | Block/reason-gate every mutation under legal hold; snapshot before/after. |
| SEC-13 | **Booking reschedule can flood notifications; booking checks race.** Reschedule has no rate limit and a `Date.now()` dedupe key, so each call emails every technician/office user. Duplicate/open-booking checks run outside the create transaction; the open limit counts only `OPEN`. | `src/server/portal.ts:231-329,614-721` | Rate-limit and no-op-check reschedules; dedupe by booking+slot; per-customer advisory lock/idempotency key; count all non-closed statuses. |
| SEC-14 | **Deactivating a department does not revoke file access.** `canReadUpload` passes no `departmentIsActive`; the upload route loads only `deletedAt`. | `src/lib/upload-access.ts:33-37`; `src/app/uploads/[...path]/route.ts:56-59` | Load and enforce `department.isActive` in upload ACL and login. |
| SEC-15 | **Authenticated memory-exhaustion DoS.** Upload/download buffers entire files (50 MB × concurrency) in a 700 MB container; several JSON/form routes parse unbounded bodies with only the 100 MB proxy limit. | `src/app/api/upload/route.ts:83-96`; `src/app/uploads/[...path]/route.ts:115-117`; `src/app/api/oppdrag/[id]/date/route.ts:30-37` | Stream uploads/downloads; enforce route-level byte limits before parsing; add per-user concurrency limits. |
| SEC-16 | **Offline cleanup UI is dead under CSP.** `/offline.html` is served with a nonce CSP but its inline script has no nonce, so draft listing/delete/discard never run. | `public/offline.html:92`; `src/proxy.ts:36-70`; `src/lib/csp.ts:13` | Move the script to `/offline.js` (allowed by `script-src 'self'`) or add a hash; bump SW cache version. |
| SEC-17 | **Release pipeline trusts any `v*` branch and pushes before scanning.** `workflow_run` publishes when `head_branch` starts with `v`; image is pushed (`push: true`) before Trivy. | `.github/workflows/docker-publish.yml:25-35,76-98` | Require a real `refs/tags/v*` push, same-repo head, protected environment; scan before push/promote after scan. |
| SEC-18 | **App runs as PostgreSQL superuser.** Compose defaults `POSTGRES_USER=admin` for both migrations and runtime queries. | `docker-compose.prod.yml:26-28,62` | Separate migration role (DDL) and runtime role (DML only). |
| SEC-19 | **Backups are unencrypted by default.** `BACKUP_AGE_RECIPIENT` is optional; a plain run writes full DB + uploads PII, then copies them to remote storage. | `scripts/backup.sh:13-16,30,50-58,103-109` | Fail closed in production unless encryption is configured; encrypt before remote copy. |

---

## Low / hardening

| ID | Finding | Fix |
|---|---|---|
| SEC-20 | **PDF links are not protocol-filtered.** `markdown-pdf.tsx:142` passes `node.url` to `<Link>`; web Markdown is sanitized, PDF is not. `javascript:`/`file:`/`data:` link actions land in signed PDFs. | Allow only `https:`, `mailto:`, `tel:`, `#fragment`; reuse one URL policy. |
| SEC-21 | **PDFs stored unmodified and served inline.** Only `%PDF-` is checked; active content/JS reaches the viewer. | `Content-Disposition: attachment`; sanitize with qpdf; consider a sandboxed viewer. |
| SEC-22 | **Customers can fetch unlocked reports by URL.** `getReportPdfForViewer` does not require `isLocked` for CUSTOMER; portal history hides them, but a known URL works. | Require locked reports for customer access or watermark “under correction”. |
| SEC-23 | **Report image ACL only filters `IMAGE` fields.** A `/uploads/...` URL in a TEXT field is embedded in the PDF; `buildPdfImages` checks owner type, not owner id. | Filter all answers; validate upload `ownerId` against the order. |
| SEC-24 | **Closed work orders remain mutable** via assign/attachment actions and upload route. | Enforce completed/cancelled in the final update predicate. |
| SEC-25 | **Audit gaps/non-atomic logging.** Comments audit outside the insert; password reset has no audit; activation audit outside the transaction. | Use `audit(tx, ...)` and include `actorId`. |
| SEC-26 | **Search analytics stores raw PII and `userId`** and exposes top queries to `audit.view`. | Redact/hash, drop `userId`, aggregate, shorten retention. |
| SEC-27 | **Customer CSV export is unbounded and unrate-limited.** | Rate-limit, cap/date range, stream. |
| SEC-28 | **Map provider key is sent to every staff client.** | Domain-restricted publishable token or tile proxy; rotate. |
| SEC-29 | **User-controlled notification/email bodies can carry phishing URLs.** | Neutralize URLs in all user fields; linkify only system hrefs. |
| SEC-30 | **`.env` is 0644 and `.next/standalone` contains `.env` + uploads** (5.6 GB locally). `.env.production` is not gitignored. | `chmod 600`; ignore `.env*` except examples; fix tracing exclusions. |
| SEC-31 | **`NEXTAUTH_SECRET` entropy not validated** (`"secret"` passes tests). | Require ≥32 random bytes at startup. |
| SEC-32 | **Reset/invite tokens in query strings and re-embedded on error.** | POST/code exchange, no-store, redact proxy logs. |
| SEC-33 | **TOTP replay within the 30 s step.** | Store last accepted step / otplib `afterTimeStep`. |
| SEC-34 | **Sessions slide indefinitely; logout does not revoke the JWT.** | Absolute lifetime, bump `sessionVersion` on logout, “sign out everywhere”. |
| SEC-35 | **Password policy minimal; bcrypt truncates at 72 bytes, cost 10.** | 12–15+ chars, breach check, explicit 72-byte cap, cost 12/Argon2id. |
| SEC-36 | **SMTP STARTTLS not required.** | `requireTLS: true`, TLS 1.2+, secure 465. |
| SEC-37 | **Missing `no-store` on customer JSON endpoints** (`/api/kunder/*`). | Central `noStoreJson()` helper. |
| SEC-38 | **CSP missing on HTML paths ending in `.js/.png`** due to the proxy matcher. | Match `text/html` responses instead of extensions; add a header test. |
| SEC-39 | **`?reportSubmitted=` deletes local drafts and spoofs a receipt.** | Signed one-time flash token or server confirmation. |
| SEC-40 | **Offline drafts authorized only by a localStorage marker**; retained after logout by design. | PIN/step-up or encrypted per-user key; offer explicit discard. |
| SEC-41 | **Supply chain: mutable base images/actions, unpinned Prisma CLI.** | Pin images/actions by digest/SHA, checksum traineddata, lock the CLI. |
| SEC-42 | **Health/readiness reveal uptime/DB state; trusted `x-request-id` reflected in logs.** | Restrict at proxy; validate/regenerate request IDs. |

---

## Needs a product/risk decision

- **Cross-department reports are intentional.** `reports.view` lets any technician
  read reports from every department. Confirm the data-classification model; if
  reports contain customer-sensitive content, this is a High leak.
- **Customers, documents and reports are shared across departments; work orders
  are not.** Confirm this is intended.
- **Soft-delete is retention, not erasure.** Reports/signatures/audit/backups are
  retained indefinitely. A GDPR erasure workflow is missing (anonymisation +
  retention matrix).
- **2FA is optional, including for ADMIN/OFFICE.** Consider mandatory 2FA for
  privileged roles.
- **Map provider key is public to staff.** Use a restricted/publishable token.
- **Bookings are requests, not reservations.** The UI must not imply a slot is
  confirmed; server-side availability enforcement would be stronger.

## Fix order

1. **SEC-01** customer reassignment / report ownership (data leak).
2. **SEC-02** 2FA recovery-code bypass; **SEC-08** pending setup.
3. **SEC-03** offline cache re-auth/TTL.
4. **SEC-04/05/06** cancelled jobs, contact deletion, deleted-customer portal.
5. **SEC-07** user-management permission subset.
6. **SEC-09/13/15/17/18/19** DoS, booking, release, DB role, backups.
7. **SEC-10/11/12/14** lifecycle, signatures, legal hold, department ACL.
8. Low findings and defense-in-depth in one hardening PR.

## What is well hardened

- Raw SQL is parameterized with allowlisted identifiers; no `$queryRawUnsafe`.
- Markdown uses `rehype-sanitize` with no raw HTML; one `dangerouslySetInnerHTML`,
  for a validated CSS colour.
- Uploads: UUID names, magic-byte checks, size/quota limits, per-file ACL,
  `nosniff`, `no-store`, no SVG/HTML.
- PDF/OCR: `execFile` with fixed binaries, no shell; bounded pages/DPI/timeouts.
- CSRF origin checks on mutating routes; safe redirects; nonce CSP on app pages.
- Session `sessionVersion` invalidation on password/role/2FA/active/customer
  changes; fail-closed 2FA credentials provider.
- Reset/invite tokens: 256-bit, SHA-256 at rest, single-use, expiry.
- Report locking uses atomic `updateMany`; revisions are append-only; customer
  acknowledgment is idempotent.
- Rate limiting is DB-backed and shared across instances where keys are available.
- Container: non-root, read-only root, caps dropped, `no-new-privileges`,
  loopback-bound DB, isolated uploads volume.
- `npm audit` reports 0 production/dev vulnerabilities; no secrets in git history.

## Method / limitations

- Static review by six agents, plus targeted verification of every High/Medium
  finding by the lead. No live exploit was executed.
- Deployment-dependent items (proxy headers, `APP_URL`/`NEXTAUTH_URL`, SMTP TLS,
  secret entropy) are marked where applicable.
- `docs/security-audit-2026-10-29.md` is a read-only audit artefact and was not
  committed to the release branch.
