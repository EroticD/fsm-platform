# Backlog — Admin export and import of customers

> **STATUS: v1 IMPLEMENTED — SEE LIMITATIONS**
>
> The v1 transfer feature described here is implemented in `feat/cust-export`
> (schema migration `20261103120000_customer_transfer`, services under
> `src/lib/customer-transfer/` and `src/server/customer-transfer.ts`, settings
> tab `kundeoverforing`, and internal routes under
> `/api/innstillinger/kunder/`). It has been exercised by unit tests and by a
> real-PostgreSQL integration suite that exports a synthetic dossier, imports it
> into a cleaned target, verifies new IDs/relations/files, repeats the import,
> and rejects malformed/checksum/path-traversal/missing-file packages without
> writes.
>
> **Honest v1 limitations (not silently dropped):**
>
> - **Synchronous, in-memory jobs.** Export/import runs in the request process
>   and the ZIP is buffered in memory. Durable job rows record state, but there
>   is no async worker, resume-after-crash or progress streaming. Package limit
>   is therefore 500 MiB in total and 50 MiB per file. A process crash between
>   the file move and the DB commit can leave unreferenced files; v1 cleans
>   staging automatically but does not run a background reconciliation of final
>   `/uploads` files. Operators should compare the filesystem against `Upload`
>   rows after a crash during import.
> - **No package encryption or signature.** SHA-256 checksums detect corruption,
>   not tampering. ZIP passwords are deliberately rejected; confidentiality
>   relies on authenticated HTTPS, ephemeral staging (24 h) and restrictive
>   permissions. Envelope encryption is future work.
> - **Signatures excluded by default.** Signature images are included only when
>   the admin explicitly opts in; the default package sets `signatureExcluded`
>   and relies on the cached PDF. The legal basis for signatures/HMS data must
>   be assessed before enabling the option.
> - **Audit snapshot is provenance only.** Source audit rows are exported to
>   `data/audit-snapshot.json` (cap 5 000 rows) and referenced from
>   `provenance/audit.json`; they are never copied into the target `AuditLog`.
>   The target gets one `CustomerTransfer` audit entry for the import itself.
> - **One schema major version.** Only `1.x` is accepted; there are no
>   cross-version migrators, and unknown future majors are rejected.
> - **No equipment attachment version model.** Equipment `Upload` rows are
>   transferred as distinct attachments; versions are not inferred from time.
> - **Document ownership is nullable.** Only documents with `customerId` or
>   `productId` are exported. Unowned/global documents are excluded and are
>   never guessed from title or filename.
> - **Conflict updates are narrow.** Only customer and equipment fields can be
>   updated; reports are never updated, and contacts/sites/contracts/work
>   orders/plans/readings/documents/uploads are skip-or-new.
> - **Not exposed on `/api/v1`.** Routes are internal, admin-session-only and
>   intentionally unavailable to API keys or the customer portal.
> - **No SLA clocks, booking workflow, notifications, SMS, tracking pings,
>   reviews, drafts or offline/outbox data.** These remain explicit non-goals
>   (§5.11) rather than partial imports.
>
> The customer portal CSV export at
> `src/app/api/kundeportal/export/route.ts` is still unrelated and untouched.

**Created:** 2026-11-02
**Owner:** Platform/admin
**Type:** Backlog specification (v1 implemented, limitations above)

## 0. How a future worker should use this document

- Do not start the feature from this document in the same task that created it.
  It is a work list, not an implementation instruction.
- Claim one delivery slice (§14) at a time. Keep `typecheck`, unit tests,
  integration tests, i18n, lint and build green.
- The definition of done for any slice includes its tests, not just working
  code in a browser.
- The final slice must run the practical export → clean-database import test in
  §12 against real PostgreSQL. Mock-only tests do not satisfy the acceptance
  criteria.
- Never lower the security bar to make a demo pass. If a scope item is blocked
  (for example document ownership or signatures), leave it blocked and record
  the decision rather than silently dropping it.
- Only update the status banner when implementation actually starts, and only
  mark it shipped with evidence.

---

## 1. Decision summary

Build an **admin-only customer transfer package**:

1. An administrator can select one or more customers and download a single ZIP
   containing customer data, equipment, service history, reports, documentation
   and the binary files that belong to them.
2. The same ZIP can be uploaded into another installation (or the same
   installation) and **validated first** with a dry-run. Nothing is written to
   the database or upload directory until the administrator explicitly confirms.
3. Import creates **new database IDs** for every imported row. Source IDs are
   carried in the package only for reference, preview and mapping. Duplicate
   detection uses stable business keys (organisation number, customer number,
   equipment serial number, etc.), never source CUIDs.
4. Import is transactional for the database and staged for files. A failed
   import must leave the target database unchanged and clean up staged or
   orphaned files.
5. No secrets are transferred: no passwords, password hashes, sessions, API
   keys, recovery codes, 2FA secrets or customer signatures without an explicit
   legal decision.
6. The feature is documented as a **transfer/migration tool**, not as a backup,
   accounting export or GDPR data-subject self-service tool.

This aligns with the existing decision in `docs/DECISIONS.md`:
"En egen admin-eksport med signert pakke og hash-kjede er anbefalt neste steg;
den må kreve administratorrettighet og logges i `AuditLog`."

---

## 2. Goals and non-goals

### 2.1 Goals

- Move a complete customer dossier between installations without losing
  relationships or history.
- Preserve evidence: report content, report revisions, PDFs, attachments,
  document versions and audit-relevant links.
- Make duplicate handling explicit and reversible in preview.
- Make repeat imports idempotent: importing the same package twice must not
  create a second copy unless the administrator explicitly chooses "create new".
- Protect personal data, customer secrets and file storage during export,
  download, staging, validation, import and cleanup.
- Give future support staff enough diagnostics to understand a failed import
  without reading server logs or raw customer data.

### 2.2 Non-goals

- Full-instance backup/restore. Use PostgreSQL backups and the upload volume for
  disaster recovery (`docs/OPERATIONS.md`).
- Migrating global configuration such as roles, permissions, branding, SMS
  settings, API keys, departments as a whole, all templates or all users.
  Required references are mapped by natural key; optionally created only with
  an explicit, separately audited choice.
- Customer self-service export/import. The customer portal must never show this
  UI or expose these routes.
- Office/coordinator access. `settings.manage` alone is not sufficient; the
  actor must also have role `ADMIN`.
- Billing, invoicing, accounting or price calculation.
- Automatic background synchronisation between installations.
- Importing in-progress report drafts or transient offline/outbox data.
- Importing notification read states, SMS logs, tracking pings, sessions or
  login history.
- Importing a customer signature or health-related documentation where the
  receiving installation lacks a documented legal basis. Such files may be
  excluded or quarantined; see §16.

---

## 3. Current state that future workers must account for

This is a map of the code at the time of writing, not a promise that it will
remain unchanged. Re-verify before implementation.

### 3.1 Relevant models (`prisma/schema.prisma`)

| Area | Models |
| --- | --- |
| Customer | `Customer`, `CustomerSite`, `Contact`, `PortalDelegation` |
| Portal users | `User` with `role = "CUSTOMER"`, `customerId`, `contactId` |
| Equipment | `Product`, `EquipmentCategory`, `MeterReading`, `MaintenancePlan`, `MaintenancePlanOccurrence` |
| Contracts | `Contract`, `ContractLine`, `PriceList`, `PriceListItem`, `SlaPolicy` |
| Service history | `WorkOrder`, `Visit`, `VisitTechnician`, `Comment` |
| Reports | `Report`, `ReportRevision`, `ReportUnit` |
| Documents | `Document`, `DocumentVersion`, `DocumentFolder`, `DocumentTag` |
| Attachments | `CustomerAttachment`, `Attachment` (work-order data URL), `Upload` metadata |
| Tags | `Tag` (work orders), `DocumentTag` (documents) |
| Audit | `AuditLog` (`entityType`, `entityId`, `action`, `metadata`) |

Important ownership facts:

- Equipment files are **`Upload` rows with `ownerType = "EQUIPMENT"`** and
  `ownerId = Product.id`. There is no `ProductAttachment` table and no explicit
  version chain for equipment files.
- Customer files are `CustomerAttachment` rows (`dataUrl` string) plus
  `Upload` rows with `ownerType = "CUSTOMER"` and `ownerId = Customer.id`.
- Work-order files are `Upload` rows with `ownerType = "WORK_ORDER"` and
  `ownerId = WorkOrder.id`; `Attachment` is a separate legacy/data-URL table.
- Report PDFs are cached in `Report.pdfUrl`/`pdfHash` and registered as
  `Upload` rows with `ownerType = "WORK_ORDER"`. Rendering/caching lives in
  `src/lib/report-pdf-store.ts`; access checks live in `src/server/reports.ts`.
- `Document` is a **global document library**. It currently has no
  `customerId` or `productId`. Document versions exist in `DocumentVersion`.
- `Upload` has `customerId` and `departmentId` columns, which are useful but are
  metadata, not a complete ownership model.
- `AuditLog` has no foreign key to customers. Relevant rows must be found by the
  entity IDs in the package.

### 3.2 Consequence: ownership links must be added in the implementation

The feature cannot truthfully export "customer documents" or "equipment
attachments/versions" using only the current schema. A future implementation
must add one of these, in a new migration (never edit existing migrations):

1. Add `customerId String?` and `productId String?` (with indexes) to
   `Document`, plus optional backfill for existing rows; **or**
2. Add a `DocumentLink`/`DocumentOwner` join table with
   `documentId`, `customerId`, `productId`, `createdAt`; **or**
3. Use a generic `Upload` ownership link and stop treating the global document
   library as customer-scoped.

Recommended: option 1 for the first implementation, because document search,
folder browsing and version history already operate on `Document` and a nullable
owner is a small, testable change. Add a data migration/backfill only where
ownership can be proven; leave ambiguous documents unowned and exclude them from
customer packages. Do not guess ownership from title or filename.

If equipment file versioning is required, add an explicit
`EquipmentAttachment`/`EquipmentAttachmentVersion` model or a generic
`AttachmentVersion` with a stable `uploadId`; do not infer versions from
`createdAt` alone.

### 3.3 Existing conventions to follow

- Business logic in `src/server/*`; thin server actions/route handlers.
- Re-authorise on every server action and route; hiding a button is not enough.
- Mutations and `audit(tx, ...)` in the same transaction
  (`src/lib/audit.ts`).
- Zod validation in `src/lib/schemas/*`; stable error codes, translated in UI.
- Norwegian UI copy; add keys to `messages/nb.json`, `en.json`, `pl.json` and
  `de.json` in the same change (`npm run check:i18n:strict`).
- Uploaded files live outside `public/`, served by
  `src/app/uploads/[...path]/route.ts` through `uploadDir()`
  (`src/lib/uploads.ts`). Allowed upload types are PDF, JPEG, PNG, WebP and GIF.
- Existing file upload limits and MIME sniffing are in
  `src/lib/upload-slot.ts` and `src/lib/upload-validation.ts`.
- Integration tests run against a real PostgreSQL database via
  `TEST_DATABASE_URL` (`vitest.integration.config.ts`). Mandatory here; mocks
  alone do not satisfy the test plan.

### 3.4 Existing settings architecture

The admin UI is `/innstillinger` with tabs defined in
`src/lib/settings-tabs.ts` and rendered by
`src/components/settings/SettingsTabs.tsx`. A new tab must be added to both,
permission-gated, with the actual page block in `src/app/innstillinger/page.tsx`.
Do not create a separate public page under `/kundeportal`.

---

## 4. Authorisation and security model

### 4.1 Required server-side guard

Every action, route handler, job-status endpoint and download endpoint must call a
single guard equivalent to:

```ts
requireCustomerTransferAdmin(user):
  user must be active
  user.role === "ADMIN"
  hasPermission(user, "settings.manage") === true
```

Notes:

- `role === "ADMIN"` alone is insufficient if the product later allows a
  restricted admin role. `settings.manage` alone is insufficient because office
  staff may have it. Require **both**.
- Never rely on the `SettingsTabs` visibility check. Re-check in the service,
  in every route, and before streaming a ZIP or revealing validation errors.
- Customer portal users (`role === "CUSTOMER"`) and office users must receive
  `403`, even with a valid session.
- API-key authentication is **not** enabled by default for this feature. If a
  later decision exposes it under `/api/v1`, the key's user must satisfy the same
  ADMIN + `settings.manage` rule, and the endpoint must be explicitly documented
  in OpenAPI. Do not add it silently.
- Reject import confirmation if the ADMIN lost the role between preview and
  confirm; preview tokens must be short-lived and bound to the actor and package
  checksum.

### 4.2 CSRF, rate limits and transport

- POST routes use the existing same-origin check (`assertSameOrigin`) and must be
  inaccessible by cross-site form posts.
- Rate limits (DB-backed, shared across instances):
  - export starts: e.g. 3 per admin per hour;
  - import uploads/dry-runs: e.g. 3 per admin per hour;
  - download: e.g. 10 per export job;
  - status polling: modest limit, e.g. 120/minute per admin.
  Proposed values, tune after load testing. Return `429` with `Retry-After`.
- HTTPS only in production. Responses: `Cache-Control: no-store`,
  `Content-Disposition: attachment`, no public caching, no signed URL that works
  without an authenticated admin session. If a short-lived download token is
  used, bind it to the admin user, job ID and a single use/expiry (≤ 5 minutes).
- Do not log package contents, file names with personal data, or validation
  values in application logs. Log job IDs, counts, checksums and error codes.

### 4.3 PII and file protection

A full package contains personal data, customer contact details, signatures,
site coordinates, service history and possibly health/HMS information. Treat it
as **confidential personal data**:

- Require an explicit warning and confirmation before export.
- Store temporary packages/staging files on a non-public volume with restrictive
  permissions (`0700` directory, `0600` files where supported).
- Delete export artifacts and staged imports automatically (proposed: 24 hours
  for exports, 24 hours for failed/abandoned imports; configurable). Record the
  cleanup time in the job row.
- Do not email packages or put download URLs in notifications.
- Do not write PII to `AuditLog.metadata`; log customer IDs/names only where the
  existing audit convention already does so, and never file contents.
- If package encryption is required, use a reviewed envelope-encryption format,
  not a weak ZIP password. V1 may rely on authenticated HTTPS + ephemeral
  storage + short TTL; record that decision. See §16.

### 4.4 What must never be exported or imported

- `User.password`, password hashes, reset tokens, invite tokens;
- `TwoFactorRecoveryCode` and any TOTP secret;
- sessions, cookies, NextAuth tokens;
- `ApiKey` rows, hashes, scopes, last-used timestamps;
- API webhook secrets, SMS credentials, SMTP credentials, SSO secrets;
- notification read state, tracking pings, SMS message bodies unless separately
  approved;
- signatures/images whose legal basis is unresolved (see §16);
- any file outside the export scope or outside `uploadDir()`.

Portal users are exported as *identity/relationship metadata* only:
name, email, phone, role marker, customer/contact link, active flag and portal
delegation flags. They are imported disabled and without a usable password; the
recipient must send a normal invite/reset before first login.

---

## 5. Export scope

The package is built per selected customer. If multiple customers are selected,
each customer's data must remain internally consistent and must not reference
another selected or unselected customer except through explicitly allowed
shared reference data. Reject cross-customer child links during validation.

### 5.1 Customer core

Include all non-secret fields from `Customer`:

- `id` (source only), `name`, `customerNumber`, `orgNumber`, `brandColor`,
  `logoUrl`;
- address fields, phone, email, notes;
- `departmentId` (mapped by department name), `responsibleTechnicianId`
  (mapped by staff email; no staff user is created);
- `createdAt`, `updatedAt`, `deletedAt`, `deletedBy` (as provenance; see
  deletion policy below);
- customer logo/attachment files only if they resolve under `uploadDir()` via a
  safe `/uploads/<name>` URL. Never fetch arbitrary HTTP(S) logo URLs during
  export (SSRF risk); keep the existing URL as metadata and mark it
  `external_unfetched`.

Soft-deleted customers: export is allowed only with an explicit
`includeDeleted` option, because it may include legal-hold/history data. Import
must not resurrect a deleted customer by default; use `new` or `skip` and show
the deleted state in preview. A restore-on-import option is out of scope unless
added explicitly.

### 5.2 Contacts, sites and portal users

- `Contact`: all fields, including locale.
- `PortalDelegation`: all permission flags and active state.
- `CustomerSite`: all fields, including latitude/longitude and `isPrimary`.
  Coordinates are personal-data-adjacent; include only because sites are part of
  the customer record.
- Portal `User` rows linked to the customer/contact: metadata only, no secrets.
  Preserve `emailVerified` only as a boolean/provenance marker, not as a claim
  that the target instance verified the address.
- Preserve portal user IDs as source IDs; import creates new user IDs and
  requires an invite/reset.

### 5.3 Responsible technician, department and staff references

- `Department` referenced by customer/contract/maintenance plan: export a
  minimal reference object (`id`, `name`, `description`, active flags, contact
  fields) under `data/reference/departments.json`.
- `User` references for responsible technician, report technicians and
  audit actors: export only `id`, `name`, `email`, `role` and active marker as
  reference data. Never export password/hash/2FA/API keys.
- On import, map staff by normalised email. Do not create staff users. If no
  match exists, set the optional relation to `null` and report a warning; do not
  invent an employee. `WorkOrder`/`Visit` technician links may be omitted if the
  target staff member is missing, with a preview warning.
- Department mapping is by exact normalised name. If missing, import is blocked
  unless the administrator explicitly chooses a target department or enables
  `createMissingReferences` (default false). This prevents silently changing
  which department owns contracts and maintenance plans.

### 5.4 Contracts and commercial reference data

Include:

- `Contract` all fields, including `contractNumber`, interval, dates, status,
  renewal mode, notice days, indexation percent, department/contact/template/
  SLA/price-list references;
- `ContractLine` all fields, including optional product reference.

Supporting references:

- `Template` metadata (`id`, `title`, `reportName`, `description`, `category`,
  `hmsType`, `requiresUnits`, `fieldsJson`). Treat template fields as data; do
  not execute them.
- `SlaPolicy`, `PriceList`, `PriceListItem` as references, not as customer-owned
  rows. Conflict by natural key; do not silently mutate global price lists.
- `BusinessHours`/`Holiday` only if needed for a recreated SLA history. If SLA
  clocks are not in scope, do not import them; keep contract metadata only.

Import policy for references is defined in §9/§10.

### 5.5 Tags

- `Tag` rows referenced by the customer's work orders.
- `DocumentTag` rows referenced by included documents.
- Tags are global by unique name. Import maps by name; optional create only if
  `createMissingReferences` is enabled. Never duplicate a tag with the same name.

### 5.6 Products, equipment, categories and hierarchy

Include the full `Product` row except secrets/tokens:

- `id` (source only), `model`, `serialNumber`, `location`, `customerId`, `siteId`,
  `categoryId`, `parentId`, `status`, `criticality`, `meterUnit`, `installDate`,
  `warrantyUntil`, `warrantyNotifiedAt`, timestamps;
- do **not** import `qrToken` as-is. Export a boolean/hash marker
  (`qrTokenPresent`) only. On import, leave `qrToken` null or generate a new
  token when a QR label is requested. Reusing a token could let an old label
  point at a different physical unit or installation.
- `EquipmentCategory`: the full ancestor chain of every referenced category,
  plus all descendants if they are needed to preserve the tree. Preserve
  `parentId` and reject cycles. Category names are not guaranteed globally
  unique; match by path (`parent/child`) and optionally allow create.
- Equipment hierarchy: parents before children; preserve parent/child links by
  source-ID mapping. Reject cycles and cross-customer parent links.
- `MeterReading`: all fields, including decimal value as string to avoid float
  loss, `readAt`, `source`, optional visit/user references and note. Map
  `userId` to imported/existing staff or null; map `visitId` by source mapping.
- `MaintenancePlan`: all fields, including trigger, intervals, lead days,
  next due date, last meter value, active state, product/customer/department/
  template references. Recompute nothing automatically.
- `MaintenancePlanOccurrence`: include as historical/read-only records (status,
  due date, meter value, work order link). On import, do not generate new work
  orders. Pending occurrences may be imported as `PENDING` only if the job
  explicitly opts in and a dry-run shows the effect; otherwise import them as
  `SKIPPED`/historical with a warning. Recommended v1: preserve occurrences as
  history and never auto-generate.
- Equipment files: `Upload` rows with `ownerType = "EQUIPMENT"` for each product,
  including original name, MIME, size, checksum, created time. No implicit
  versions; each upload is imported as a distinct attachment. If the future
  `EquipmentAttachmentVersion` model exists, preserve its version chain.

### 5.7 Service history: work orders, visits, comments

Include `WorkOrder` rows where `customerId` is in scope, including soft-deleted
and legal-hold rows only when `includeDeleted`/`includeLegalHold` is explicit.
Fields include title, reference, orderNumber, description, address/geo fields,
schedule, status, creator, department, customer/site/product/contact/contract
links, tags, template links, legalHold, deletion provenance and timestamps.

Also include:

- `Visit` and `VisitTechnician` (staff mapped by email; optional);
- customer/work-order `Comment` rows, with authorship provenance. Internal
  comments may contain personal data; include only if required for service
  history and show them in the PII warning. Do not export notification text or
  SMS content;
- `WorkOrderSkill` requirements only if target skills exist; otherwise warning
  and drop the link;
- `SlaClock` history only if a future decision includes SLA evidence. If
  included, import as historical rows and never recalculate clocks.
- `Attachment` rows (data URL/legacy) only if they are safe, under the size cap
  and owned by an included work order. Prefer converting to `Upload` only with a
  documented migration; otherwise include as a data file with checksum.

Do not include `ReportDraft` (transient, per-user, possibly incomplete).
Do not include offline/outbox data.

### 5.8 Reports, report revisions, units and PDFs

Include every `Report` linked via included work orders, including soft-deleted
and legal-hold reports:

- all metadata: `dataJson`, comments, completion time, signatures/URLs and
  names, workOrderId, templateId/title, reportNumber, requiresUnits, category,
  hmsType, templateSnapshotJson, locking fields, PDF URL/hash/generated time,
  customer acknowledgement fields, revision number, legalHold, deletion
  provenance, timestamps;
- `ReportUnit` rows: label, serial, location, status, answersJson, comment,
  sortOrder, productId mapping, timestamps;
- `ReportRevision` rows: every field, including the full `dataJson`,
  `unitsJson`, signatures, acknowledgement state and change reason;
- report PDFs: include the cached file behind `Report.pdfUrl` when it exists and
  is under the size cap. Verify `pdfHash`/checksum and record the PDF's own
  SHA-256. If the cached PDF is absent, do not fail the whole export by default:
  record `pdfState: "missing"` and, only if explicitly requested, regenerate it
  at export time via the existing report PDF service; mark expensive generation
  in the job progress. Never regenerate during import (no source, no need, and
  it can differ across app versions).
- signatures: include the image files referenced by
  `technicianSignatureUrl`/`customerSignatureUrl` if they are safe uploads and
  the legal basis is approved. If not approved, include metadata and a
  `signatureExcluded` marker. The PDF remains the authoritative visual record.

A report imported onto an existing target work order is an **append-only**
event. Never overwrite a signed/locked report, never lower a revision number, and
never change a report under legal hold.

### 5.9 Customer and equipment documents, attachments and versions

**Decision for this feature:** documents are included as **metadata and binary
content in the same ZIP** (`files/`), not by external reference alone. The
default full export contains binaries. A future metadata-only/support export may
be offered to reduce exposure, but it must be clearly marked **non-importable**
and must never pass itself off as a full backup. There is no fetch-on-import from
the source installation; an import must be self-contained.

Required export:

- `CustomerAttachment` rows for each customer, including `fileName`, `dataUrl`
  (only safe `/uploads/...` or explicitly allowed data URL), `createdAt` and
  file metadata. If the file is missing on disk, mark `fileState: "missing"` and
  fail the dry-run for a full import (or allow metadata-only with a warning).
- `Upload` rows owned by the customer (`ownerType = "CUSTOMER"`), by included
  work orders, and by equipment (`ownerType = "EQUIPMENT"`), with all metadata
  and the binary file.
- `Document` rows explicitly linked to the customer/equipment through the new
  ownership model (see §3.2). Include title, description, fileName, filePath,
  size, MIME, extracted `contentText`/`pageTexts` (or mark them to be rebuilt),
  folder, tags, uploader provenance, timestamps, soft-delete fields.
- `DocumentVersion` rows for every included document: file name/path/size/MIME,
  creator and creation time, with binary content.
- `DocumentFolder` ancestor chain for included documents. Preserve tree and
  reject cycles. Folder names are not globally unique; match by path or create
  only with explicit consent.
- `DocumentTag` references.
- Any future `EquipmentAttachment`/version rows.
- `Upload` rows with `ownerType = "CONTRACT"` for included contracts, if used.

Important: do not include global documents solely because they exist. Only
documents that are proven to belong to the selected customer/equipment (via the
new ownership link) or are referenced by the selected dossier may be included.
If ownership cannot be proven, exclude and report it; never grant a customer
access to a global document by guessing.

### 5.10 Audit-relevant links

Export a **source audit snapshot** for the included entity IDs:

- `AuditLog` rows where `entityId` matches customer/contact/product/contract/
  document/report/work-order ids in the package, limited to a configurable
  window or count, with `entityType`, `entityId`, action, actor name/id,
  metadata and timestamp.
- Do not export unrelated audit rows just because they share a name.
- On import, do not copy source audit rows into the live `AuditLog` as if they
  happened in the target instance. Instead:
  1. write a new audit entry for the transfer itself (`entityType:
     "CustomerTransfer"`, action "Imported customer package …");
  2. store the source audit snapshot in the package/import report under
     `provenance/audit.json` and link it from the import job metadata (file
     checksum, not contents in the audit row);
  3. optionally expose it read-only in a future "import provenance" view.
  This avoids forging actor history while preserving evidence.

### 5.11 Explicitly excluded data

- `BookingRequest`, `BookingHold`, `BookingRequestEvent` (transient booking
  workflow; import would create live holds/requests)
- `Review`, `TrackingLink`, `VisitLocationPing` (tracking/GPS evidence; separate
  legal decision)
- `Notification`, `NotificationPreference`, `SavedSearch`, `SearchLog`
- `SmsMessage`, `MessageThread`, `Message`, `ChannelPreference`, `SmsTemplate`,
  `SmsSetting`
- `DocumentJob`, `ReportDraft`, `RateLimit`
- `ApiKey`, `TwoFactorRecoveryCode`, sessions, auth tokens
- `Branding`, global `MapSettings`, security settings, role definitions
- `Department`/`User` rows as full entities (only minimal references)

---

## 6. Package format

### 6.1 Envelope

A ZIP file named:

```text
fsm-customer-export-<yyyyMMdd-HHmmss>-<shortChecksum>.zip
```

Recommended tree:

```text
manifest.json
checksums.sha256
README.txt                     # human warning: confidential, PII, no passwords
data/
  customers.json
  contacts.json
  portal-users.json
  portal-delegations.json
  sites.json
  reference/
    departments.json
    users.json                 # metadata only, no secrets
    templates.json
    sla-policies.json
    price-lists.json
    business-hours.json        # only if needed
    holidays.json              # only if needed
  equipment-categories.json
  equipment.json
  meter-readings.json
  maintenance-plans.json
  maintenance-occurrences.json
  contracts.json
  contract-lines.json
  tags.json
  work-orders.json
  visits.json
  visit-technicians.json
  comments.json
  reports.json
  report-units.json
  report-revisions.json
  customer-attachments.json
  documents.json
  document-versions.json
  document-folders.json
  document-tags.json
  uploads.json
  audit-snapshot.json
  import-map.json              # optional, produced by dry-run; never trusted as authority
files/
  ab/
    <sha256>.pdf
    <sha256>.jpg
provenance/
  source-info.json
  audit.json
```

Rules:

- JSON is UTF-8, no BOM, deterministic key ordering and stable array ordering
  (by source ID or documented sort key) so the same export produces the same
  checksums where data has not changed.
- Dates use ISO-8601 UTC with milliseconds. Decimal values (meter readings,
  money-display amounts, indexation) are strings with a documented scale, not
  JavaScript floats.
- Binary paths are **content-addressed**:
  `files/<first two hex>/<full sha256>.<safe-extension>`. The same content maps
  to the same path across exports; duplicate contents appear once. The manifest
  maps logical entities to these paths.
- Never use the original filename as a path. Original names live in JSON. Sanitise
  for storage but preserve the display name separately.
- `manifest.json` is the only entry point. Unknown top-level entries are ignored
  with a warning; duplicate ZIP entry names, symlinks, hard links, absolute
  paths, `..`, backslashes and NUL bytes are rejected before extraction.

### 6.2 `manifest.json`

Proposed schema (version 1.0):

```json
{
  "format": "fsm-customer-export",
  "schemaVersion": "1.0",
  "exportedAt": "2026-11-02T12:34:56.789Z",
  "source": {
    "instanceId": "stable-random-or-configured-id",
    "appVersion": "0.8.5",
    "baseUrl": "https://fsm.example.no",
    "databaseLabel": "production"
  },
  "scope": {
    "customerIds": ["cust_source_1"],
    "includeFiles": true,
    "includeDeleted": false,
    "includeLegalHold": false,
    "includeAudit": true,
    "includeSignatures": false
  },
  "counts": {
    "customers": 1,
    "contacts": 2,
    "sites": 1,
    "portalUsers": 1,
    "products": 7,
    "equipmentCategories": 4,
    "meterReadings": 12,
    "maintenancePlans": 2,
    "contracts": 1,
    "workOrders": 3,
    "reports": 2,
    "reportRevisions": 2,
    "documents": 2,
    "documentVersions": 3,
    "uploads": 8,
    "files": 8
  },
  "files": [
    {
      "path": "files/ab/abcdef...pdf",
      "sha256": "abcdef...",
      "size": 123456,
      "mimeType": "application/pdf",
      "kind": "REPORT_PDF",
      "sourceUrl": "/uploads/source-name.pdf",
      "sourceEntityType": "Report",
      "sourceEntityId": "report_source_1",
      "originalName": "servicerapport.pdf"
    }
  ],
  "checksums": {
    "data/customers.json": "sha256...",
    "data/equipment.json": "sha256..."
  },
  "totals": {
    "dataBytes": 12345,
    "fileBytes": 987654,
    "entries": 42
  }
}
```

Requirements:

- `schemaVersion` is mandatory. Import accepts the current major version and
  explicitly supported older versions; it rejects future major versions with a
  stable error and never guesses.
- `counts` must match the actual decoded arrays/files; mismatch is a hard error.
- `checksums` covers every `data/*.json` and every file entry. `checksums.sha256`
  repeats them in a `sha256sum -c`-compatible format for manual inspection.
- There is no self-referential manifest checksum. If a package signature is
  added later, sign `checksums.sha256` plus a canonical manifest projection; put
  the signature in `manifest.sig` and document the algorithm/key rotation.
  Checksums are integrity, not authenticity; state this in `README.txt`.
- `source.instanceId` is a stable, non-secret installation identifier used for
  provenance/idempotency. Do not use a hostname or secret.
- `scope.customerIds` lists source IDs only; no credentials.

### 6.3 File handling and limits (proposed defaults)

Configurable via environment variables; document the final values:

| Limit | Proposed default | Rationale |
| --- | --- | --- |
| Max package size | 2 GiB | needs streaming; tune with storage |
| Max single file | 50 MiB (existing document limit) | reuse `MAX_DOCUMENT_BYTES` |
| Max ZIP entries | 50 000 | prevents metadata bombs |
| Max uncompressed total | 4 GiB | prevents decompression bombs |
| Max compression ratio | 100:1 per entry and total | reject zip bombs |
| Max nested archives | 0 | never extract nested ZIPs |
| Allowed MIME | `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif` | matches upload policy |
| Max path length | 255 bytes | prevent filesystem issues |
| Max JSON size per file | 100 MiB | stream/large-array protection |

Additional rules:

- Validate MIME by magic bytes, not `Content-Type` or extension; reuse
  `sniffFileMime` where possible.
- Reject encrypted ZIP entries in v1 (no reliable cross-platform support without
  a reviewed library); if encryption is required, implement an explicit outer
  encryption format.
- Reject HTML, SVG, JavaScript, executables and unknown binary types. PDFs are
  served as attachments; do not inline untrusted content.
- Compute SHA-256 while streaming; do not load whole files into memory.
- Extract only to a per-job staging directory under `uploadDir()` or a dedicated
  configured temp root. Canonicalise and verify that the target remains inside
  that root. Remove staging after success/failure/expiry.

---

## 7. ID strategy and duplicate keys

### 7.1 Source IDs vs target IDs

- Every exported row includes its **source ID** (`id`) and the package's
  `source.instanceId`.
- The importer treats `id` as an opaque **source reference**, never as a target
  primary key. It must generate new CUIDs/UUIDs for every imported row.
- All references inside the package (`customerId`, `productId`, `reportId`, …)
  are source IDs and are resolved through an import map.
- The dry-run response contains the proposed mapping:
  `{ sourceType, sourceId, targetType, targetId?, action, reason }`.
- Persist the applied mapping in an import ledger, not only in memory, so a
  retry can report "already imported" and so provenance survives. Proposed
  models (future migration):
  - `CustomerTransferJob`: id, actorId, kind (`EXPORT`/`IMPORT`), status,
    packageChecksum, sourceInstanceId, schemaVersion, countsJson, errorJson,
    stagingPath, createdAt, startedAt, completedAt, expiresAt, resultJson.
  - `CustomerTransferRecord`: id, jobId, sourceInstanceId, sourceEntityType,
    sourceId, targetEntityType, targetId, action, createdAt, unique
    `(sourceInstanceId, sourceEntityType, sourceId, jobId?)`.
    Consider a separate unique key for "already imported into this target" if
    repeat idempotency is required across jobs.

Do not add a generic `sourceId` column to every domain table in v1. Keep the
mapping in the transfer ledger unless a specific business need proves otherwise.

### 7.2 External/natural keys for duplicate detection

| Entity | Primary duplicate key | Fallbacks / notes |
| --- | --- | --- |
| Customer | normalised `orgNumber` (digits, country prefix handled explicitly) | `customerNumber` (trimmed, case-insensitive), then exact normalised name + city + email only as a warning, never auto-merge |
| Contact | normalised email within target customer | phone + normalised name within customer; otherwise new |
| Portal user | normalised email globally | existing user must be `role = CUSTOMER` and same customer; otherwise block |
| Site | `(customer, name)` | address/postal/city as warning |
| Equipment | `(targetCustomer, normalised serialNumber)` | no serial: do not auto-merge; require explicit `new`/`skip` |
| Equipment category | full path `parent/child` | do not match by name alone |
| Contract | `contractNumber` globally | customer + title + startDate as warning |
| Work order | source import ledger first | `reference` globally, `(department, orderNumberNormalized)`; never merge by title |
| Report | import ledger first | `(targetWorkOrder, templateId)` or `reportNumber`; signed reports never updated |
| Document | SHA-256 + logical title | version hash for versions; never link across customers |
| Customer attachment | SHA-256 + fileName + customer | otherwise new |
| Equipment upload | SHA-256 + product + originalName | otherwise new |
| Maintenance plan | import ledger (no natural key) | customer + product + title + trigger as warning |
| Meter reading | import ledger | product + readAt + value + source as warning |

Normalisation must be explicit and tested (whitespace, case, Norwegian
characters, leading zeros, country prefixes). Never silently merge on fuzzy
matching.

### 7.3 Reference resolution

- Departments: by normalised name; target default department is not an implicit
  substitute. Require explicit mapping if missing.
- Staff: by normalised email; never create staff; optional links become null with
  warnings.
- Templates: by `(title, category, hmsType)`; reports keep `templateTitle` and
  `templateSnapshotJson` even if `templateId` becomes null.
- Tags/document tags: by name; create only with explicit consent.
- SLA policies/price lists: by name + department/active state; missing optional
  links become null with warnings. Missing required references block import.
- Categories/folders: by path; create missing only with explicit consent.

---

## 8. Import flow

### 8.1 Stages

1. **Upload** — admin uploads ZIP. Reject before parsing if Content-Length or
   stream exceeds the package cap. Store in an isolated staging area; compute
   SHA-256. Create `CustomerTransferJob` with status `UPLOADED`.
2. **Extract** — validate ZIP structure and entry names; extract to a per-job
   directory. Enforce entry count/size/ratio/path rules while streaming.
   Status `EXTRACTING`.
3. **Schema check** — read `manifest.json`, require `format`, supported
   `schemaVersion`, parse with a strict zod schema; reject unknown major
   versions. Verify counts, checksums and allowed MIME.
4. **Parse and normalise** — stream JSON into typed records; normalise dates,
   decimals and external keys. Do not trust array order.
5. **Referential validation** — build source-ID graphs; every referenced ID must
   exist in the package or be an explicitly allowed target reference. Reject
   dangling, cyclic, cross-customer and ownership-invalid links (see §9).
6. **Conflict analysis / dry-run** — match against the target database without
   writing; produce per-entity counts and proposed actions (`create`, `skip`,
   `update`, `conflict`, `invalid`). Persist a validation report and a short-lived
   preview token bound to job + package checksum + actor.
7. **Await confirmation** — return preview to UI. No target writes. Admin chooses
   conflict policies and confirms. Aborting deletes staging and marks job
   `ABORTED`.
8. **Import** — begin a single interactive `prisma.$transaction` for all DB
   writes. Resolve mappings in topological order (references → customers →
   contacts/portal → sites → categories → equipment → plans/readings →
   contracts → work orders/visits → reports/units/revisions → documents/files).
   Use the prepared mapping; never create a row twice.
9. **File commit** — move verified files from staging to final
   `/uploads/<random>.<ext>` names inside the transaction window. Register
   `Upload` rows and final paths. On any failure, roll back DB and delete every
   file moved in this job.
10. **Commit and audit** — commit DB; write the import audit entry in the same
    transaction as much as possible. If audit cannot be in the same transaction,
    fail the import rather than leaving an unaudited transfer.
11. **Result** — status `COMPLETED`; store counts, mapping summary, warnings,
    error codes, package checksum and cleanup time. Offer a downloadable JSON/CSV
    result (no secrets/PII beyond what the admin already imported).
12. **Cleanup** — remove staging, package temp and extracted files; retain the
    import report/ledger per retention policy.

### 8.2 Transaction and file atomicity protocol

Files and database cannot share a native transaction, so use a documented
two-phase protocol:

```text
stage -> validate -> begin DB tx -> insert rows with final stored names
      -> move files staging -> final -> commit
      -> on failure: rollback DB, delete moved files, keep/clean staging
      -> on crash: reconciliation job deletes files not referenced by Upload/Document/etc.
```

- A file must never be moved to its final name before validation passes.
- Final names are random (`crypto.randomUUID()`) and never overwrite an existing
  file. Check collision with `fs.open(..., "wx")` or equivalent.
- If the DB commit fails after a move, the error path deletes the moved files.
  If the process dies, a scheduled reconciliation job compares disk files against
  `Upload`/`Document`/attachment references and removes only files known to be
  produced by the failed job. Never delete files referenced by any DB row.
- The reverse ordering (DB commit then file move) is not acceptable: users could
  see rows pointing at missing files.
- Dry-run never moves files, never inserts rows and never mutates existing
  customer data. It may write a temporary validation report, which is cleaned up.

### 8.3 Idempotency, retries and concurrency

- The unique `(sourceInstanceId, packageChecksum)` can identify the same package;
  the import ledger identifies individual entities.
- Re-uploading the same package: dry-run should show all previously imported
  entities as `skip` with `reason: already_imported` unless the admin explicitly
  selects "create new copy".
- If a job crashes between file move and commit, retrying must not duplicate
  rows; reconciliation determines what was committed. Mark jobs with an
  idempotency key and use a DB advisory lock per target customer/package to
  prevent two concurrent imports of the same customer.
- Never resume by reusing partially mapped IDs from memory. Recompute from the
  ledger and target DB.

### 8.4 Export flow

- Admin selects customers and options (`includeFiles`, `includeDeleted`,
  `includeLegalHold`, `includeAudit`, `includeSignatures`).
- Export job streams data to a temp ZIP; never loads all files into memory.
- Verify every file exists, is inside `uploadDir()`, has a safe URL and hashes
  during packaging. Missing files become `fileState: "missing"` with warnings;
  decide per option whether a full export is allowed. Recommended: allow export
  with warnings, but block full import if required files are missing.
- Package is downloadable only by the requesting admin, via an authenticated
  job endpoint; expiry and cleanup are enforced. Audit export creation and
  download (not package contents).
- Do not use a public `/uploads` URL for the ZIP; it is not a customer file.

---

## 9. Validation rules

All errors must have stable codes and a JSON Pointer/path to the offending
record. The UI shows a human translation and a count; the downloadable report
may include technical detail (but no full PII dumps).

### 9.1 Structure and schema

- ZIP is a valid archive, not encrypted, no trailing garbage/concatenated
  archives; `manifest.json` exists exactly once.
- `format === "fsm-customer-export"`; `schemaVersion` supported; missing fields
  fail; unknown fields produce warnings, not silent acceptance.
- Every `data/*.json` exists for the declared counts; arrays decode to objects;
  no duplicate source IDs within a collection.
- Counts/checksums/sizes match; no extra or missing `files/` entries.
- `checksums.sha256` matches recomputed hashes.

### 9.2 Required fields and domains

- Required strings non-empty after trimming where the domain requires it.
- Max lengths and existing `LIMITS`/zod schemas reused where possible.
- Enums valid; dates parseable and within sane bounds; no invalid date-only
  values; timestamps preserve timezone.
- Decimal values parse exactly to the target `Decimal` precision/scale; reject
  NaN/Infinity/overflow.
- JSON blobs (`dataJson`, `answersJson`, `fieldsJson`, `templateSnapshotJson`)
  parse as JSON and respect size caps; they are stored as data, never evaluated.
- Email/phone/URL sanitised with existing helpers; URLs only stored, never
  fetched by import.
- `Customer.name` required; `Product.model` required; `CustomerSite.name`
  required; contract title/interval/dates required per schema; report
  workOrderId required; document title/fileName required.

### 9.3 Referential integrity and ownership

- Every source ID reference resolves within the package, except allowed target
  references (department, staff, template, SLA, price list, tags) which must
  resolve by natural key or be explicitly created.
- Every child belongs to the same customer as its parent:
  - `Product.customerId === package customer`;
  - `Contact.customerId === package customer`;
  - `Contract.customerId === package customer`;
  - `MaintenancePlan.customerId === package customer` and its product, if any,
    belongs to that customer;
  - `MeterReading.productId` belongs to that customer;
  - `Report.workOrderId` belongs to that customer; `ReportUnit.productId`, if
    set, belongs to that customer;
  - `Document`/`Upload` ownership matches the customer/equipment/work order;
  - `CustomerAttachment.customerId` matches; `Attachment.workOrderId` matches.
- No cross-customer references. A package containing multiple customers must
  not have a child pointing at another customer's entity. Shared reference data
  is allowed only through the reference collections.
- Equipment parent chain and category tree are acyclic; folder tree is acyclic;
  work-order/visit technician links resolve or degrade with warnings.
- `Report.workOrderId` + `templateId` uniqueness must be respected. If the
  target already has that pair, conflict policy decides (skip/new work order/new
  report where allowed), never a blind insert.
- Contract `contractNumber` uniqueness, WorkOrder `reference` uniqueness,
  Report `reportNumber` uniqueness, CustomerSite `(customerId, name)`
  uniqueness, Tag/DocumentTag name uniqueness: detect and handle as conflicts.
- Portal users: email uniqueness in target; existing email with a different role
  or customer is a hard conflict, not an update.

### 9.4 Files

- Every referenced file exists in `files/`; no unreferenced files (warn/reject
  per option).
- Checksum and byte size match the manifest; recomputed SHA-256 matches.
- MIME sniff matches allowed types; extension/declared MIME cannot override
  content. Reject PDFs without `%PDF-`, images with wrong magic, HTML masquerading
  as an image/PDF, SVG, archives and executables.
- Original names sanitised for display and headers; no NUL/control chars.
- File paths canonicalised inside the staging root; reject absolute paths,
  drive letters, `..`, backslash traversal, symlinks/hardlinks, duplicate names.
- No zip bomb: limits on entries, per-entry size, total size and compression
  ratio; reject nested archives.
- Report PDFs: valid header, size cap, checksum; optionally verify the report ID
  link and that `pdfHash` is present. Do not execute PDF JavaScript.
- Signature files: only if `includeSignatures`; otherwise reject unexpected
  signature files or ignore with a warning.

### 9.5 Dry-run output

Return at minimum:

```json
{
  "jobId": "…",
  "package": { "schemaVersion": "1.0", "sourceInstanceId": "…", "checksum": "…" },
  "customers": [{ "sourceId": "…", "name": "…", "match": "NEW|EXISTING|CONFLICT" }],
  "entities": [
    { "type": "Product", "sourceId": "…", "action": "CREATE|SKIP|UPDATE|CONFLICT|INVALID", "reason": "…" }
  ],
  "counts": { "create": 0, "skip": 0, "update": 0, "conflict": 0, "invalid": 0 },
  "warnings": [{ "code": "…", "path": "data/equipment.json[3].parentId", "messageKey": "…" }],
  "errors": [{ "code": "…", "path": "…", "messageKey": "…" }],
  "canImport": false
}
```

`canImport` is true only if there are no errors and all required mappings/policies
are chosen. Warnings do not block unless the product decision says so; make that
explicit per warning code.

---

## 10. Conflict policy

Conflict policy is **explicit per import**, selected in the preview. There is no
silent default that mutates data. Recommended defaults:

| Entity | Default | Allowed choices | Notes |
| --- | --- | --- | --- |
| Customer | `skip` | skip / update / new | `update` must show a field diff and never delete/nulls unrelated fields |
| Contact | `skip` | skip / update / new | match email within customer |
| Portal user | `skip` | skip / link-existing / new | new user is inactive with no password; existing must be same customer and CUSTOMER role |
| Site | `skip` | skip / update / new | unique `(customer, name)` |
| Equipment | `skip` | skip / update / new | match customer + serial; no serial → new/skip only |
| Category/folder | `skip` | skip / create / map-existing | path-based |
| Contract | `skip` | skip / update / new | `contractNumber` must remain unique; `new` may need a new number |
| Work order | `skip` | skip / update / new | new gets a new `reference`; store source reference in ledger |
| Report | `skip` | skip / new | never update locked/signed/legal-hold reports; "new" only if the target work order allows it |
| Document | `skip` | skip / new | dedup by hash; never cross-link owners |
| Attachment/upload | `skip` | skip / new | dedup by hash + owner |
| Maintenance plan/reading | `skip` | skip / new | import-ledger based |

Rules for `update`:

- Update only mutable, non-append-only fields; merge child rows rather than
  replacing the collection.
- Never clear fields that are null/absent in the package unless the admin
  explicitly selects a "replace" mode (out of scope for v1).
- Never change IDs, ownership, legal hold, lock state, signature content,
  revision numbers or audit records.
- Never update a report; reports are immutable evidence. A new report may be
  added only when the target work order has room and the admin chooses `new`.
- Updating a customer/equipment must not move data between customers.

For `new`:

- Generate new IDs and new human-facing references where the target enforces
  uniqueness. Preserve source references in the import ledger/report.
- New portal users are disabled and passwordless.
- New rows must still pass all validation; "new" is not a way to bypass
  cross-tenant or file checks.

For `skip`:

- Do not create children whose parent was skipped unless they can attach to the
  existing matched parent and all references resolve. Preview must show the
  resulting action per child. Otherwise mark children `SKIP` with reason
  `parent_skipped`.

---

## 11. UI and API

### 11.1 UI

Add an admin-only settings tab, proposed key `kundeoverforing` (label e.g.
"Kundeoverføring"), at `/innstillinger?tab=kundeoverforing`.

Changes:

- `src/lib/settings-tabs.ts`: add key and permission check `isAdmin` (and
  `settings.manage` if the model supports it).
- `src/components/settings/SettingsTabs.tsx`: add tab link, icon, translations.
- `src/app/innstillinger/page.tsx`: gate the block with the server guard; load
  only when the tab is active.
- New client component(s) under `src/components/settings/` for export and import.
- No link from the customer portal, public pages, or customer-facing PDFs.
- Optionally add a subtle "Eksporter kunde" deep link on the admin customer page
  later, but v1 can be settings-only.

Export screen:

1. Search/select one or more customers (reuse existing customer search, bounded
   `take`).
2. Options: include files (default on), include deleted (default off), include
   legal-hold rows (default off, requires confirmation), include signatures
   (default off, requires legal confirmation if enabled), include audit snapshot
   (default on).
3. PII warning and explicit "Start eksport" confirmation.
4. Progress states and cancel.
5. Result: counts, warnings, missing-file count, download button, expiry time.
6. Download only for the acting admin; show checksum and schema version.

Import screen:

1. Drop/upload ZIP; show file name/size/checksum after upload.
2. Automatic dry-run; progress.
3. Preview: package source/app version, counts, per-entity actions, errors and
   warnings; links to a downloadable validation report.
4. Conflict policy selectors per entity, pre-filled with safe defaults; require
   an explicit choice if any `CONFLICT` exists.
5. "Importer" is disabled until `canImport` is true; require a confirmation
   checkbox/typed phrase that this writes data and may create portal users.
6. Progress and result: created/skipped/updated counts, mapping summary, errors,
   cleanup note.
7. Abort button; after commit, no cancel — show rollback instructions only if a
   future feature supports it (not v1).
8. Never display raw file contents or full PII in error previews.

Accessibility and i18n: keyboard operable, labels, focus states, mobile layout,
Norwegian source copy, keys in all four message catalogs, no hardcoded strings.

### 11.2 Internal API (proposed)

Use internal routes, not `/api/v1`, so API keys/customer integrations do not
accidentally gain transfer power:

```text
POST   /api/innstillinger/kunder/eksport
GET    /api/innstillinger/kunder/eksport/[jobId]
GET    /api/innstillinger/kunder/eksport/[jobId]/download
POST   /api/innstillinger/kunder/eksport/[jobId]/abort

POST   /api/innstillinger/kunder/import
GET    /api/innstillinger/kunder/import/[jobId]
POST   /api/innstillinger/kunder/import/[jobId]/dry-run
POST   /api/innstillinger/kunder/import/[jobId]/confirm
POST   /api/innstillinger/kunder/import/[jobId]/abort
GET    /api/innstillinger/kunder/import/[jobId]/report
```

Behavior:

- All require the admin guard, active session and same-origin POST.
- `POST /import` accepts multipart ZIP, streams to staging, returns `202` with
  job ID; never parses unbounded bodies in memory.
- Dry-run can be synchronous for small packages and asynchronous for large ones;
  the API must expose a job status either way. For consistency, use jobs for
  both.
- Confirm requires `jobId`, `packageChecksum`, `policies`, `previewToken` and
  explicit confirmation. Re-run validation/target checks immediately before
  writing; if the target changed since preview, return `409` and require a new
  dry-run.
- Errors use stable codes (`src/lib/api-errors.ts` style) plus `messageKey`;
  HTTP 400/403/409/413/415/422/429/500 as appropriate. Do not leak stack traces
  or file paths.
- The export download is a streamed ZIP; do not buffer it entirely.

### 11.3 Background work

Reuse the existing job-worker pattern where practical (`src/lib/job-worker.ts`,
`DocumentJob`) or add a transfer-specific job runner. Requirements:

- Durable job state in PostgreSQL, not in-memory only.
- Progress fields (stage, processed/total, bytes) updated periodically.
- Idempotent stage transitions; safe retry after process restart.
- A scheduled cleanup/reconciliation job for expired exports, abandoned
  staging, and orphaned files from failed imports.
- One active import per package/customer at a time; serialise via advisory lock
  or DB constraint.

### 11.4 Audit

Write audit entries in the same transaction as the import commit:

- `entityType: "CustomerTransfer"`, `entityId: job.id`, action
  `"Eksporterte kundepakke: <checksum>"` or
  `"Importerte kundepakke: <checksum> (<n> kunder)"`.
- Include counts, schema version, source instance, warnings count and package
  checksum in `metadata`; do not include PII/file contents.
- Add translation patterns to `src/lib/audit-actions.ts` and message keys under
  `auditActions.*` in all four catalogs.
- Export creation and download should be audited separately (download may be a
  separate action).
- Failed validation/dry-run may be logged as operational metrics, not as a
  customer mutation. Do not log raw errors with PII.

---

## 12. Practical test plan (mandatory before calling it done)

Mocks are not enough. The acceptance test must run against a **real PostgreSQL
database** with migrations applied, using `TEST_DATABASE_URL` and the existing
`vitest.integration.config.ts` conventions. File tests use a temporary
`UPLOAD_DIR` that is cleaned afterwards. Add E2E coverage for the admin UI and
denial cases.

### 12.1 Fixture

Create a deterministic fixture (test-only, synthetic data; no real PII):

- One department with business hours; a second department for cross-department
  checks; a default department.
- Admin, office user, technician(s), and a portal user for the customer.
- Customer A with:
  - `orgNumber`, `customerNumber`, contact(s), portal delegation, two sites
    (one primary with coordinates), brand color and a local logo file;
  - a responsible technician, department;
  - 3-level equipment hierarchy (building → system → unit) and a category tree
    with at least 3 levels; products with serial numbers, statuses, warranty
    dates, meter unit, QR token (to prove it is not reused);
  - meter readings (decimal values, both manual and visit source);
  - calendar and meter maintenance plans and occurrences;
  - contract with lines, contract number, template/SLA/price-list references;
  - work orders in open/completed/soft-deleted/legal-hold states, visits,
    technicians, comments, tags;
  - reports, including one signed/locked report with two report units and
    revisions; report PDF cached; signature images;
  - customer attachments, equipment uploads, document library docs with
    versions, folders, tags, and ownership links (after the new schema);
  - audit rows for the included entities.
- Customer B with overlapping names/emails? Use to test conflict isolation:
  same serial number under a different customer, same contact email, same
  document hash. The import must not cross-link them.
- A global document with no ownership link; it must not be exported/imported.

### 12.2 Export assertions

- ZIP opens; `manifest.json` parses; `schemaVersion`, counts, checksums match.
- `unzip -l`/script shows exactly the expected entries; no absolute paths,
  symlinks or duplicate names.
- Every `data/*.json` has the expected entity count and source IDs.
- Portable/stable sort order; a second export of unchanged data has identical
  data checksums except `exportedAt`/job metadata (document the exception).
- Binary paths are content-addressed; `sha256sum` verifies; sizes match.
- All expected relationship IDs are present; no excluded model leaks in.
- No password/hash/2FA/session/API-key strings anywhere in the ZIP (grep the
  extracted JSON and filenames).
- PDFs start with `%PDF-` and open with a PDF parser; images sniff correctly.
- Missing-file fixture produces a warning and never a broken silent package.
- Office/customer/non-admin cannot start an export or download a package.

### 12.3 Import into a clean database

- Import into an empty target DB (same migrations) with a fresh `UPLOAD_DIR`.
- Verify counts per entity equal the manifest/preview.
- Verify every target ID is new and not equal to source IDs; mapping is
  complete; no source CUID remains as a primary key.
- Verify all relations:
  customer → contacts/sites/contracts/products/work orders/reports/documents;
  product parent/category; meter readings/plans; contract lines;
  report work order/units/revisions; document folders/versions/tags/uploads;
  customer/equipment attachments.
- Verify files exist at `/uploads/...`, are readable through the authenticated
  route with the right actor, and are byte-identical to the package (checksum).
- Verify report PDFs open and show the expected report; report units match;
  signatures/legal-hold/lock/revision states preserved.
- Verify portal users are disabled and have no usable password; no sessions;
  invite/reset is required. Verify no staff user was created.
- Verify no duplicate customer/equipment/document/report rows.
- Verify no orphan `Upload`/file: every final file has a referencing row; every
  referenced row has a file.
- Verify audit entry for the import exists, and source audit is in
  provenance/report, not forged into live audit.
- Verify soft-deleted/legal-hold rows are handled per selected options and are
  not silently resurrected.
- Run `npm run test:integration` plus the focused transfer test suite.

### 12.4 Failure and abuse cases

Each case must leave the target DB unchanged and clean staging/files:

- malformed ZIP, truncated ZIP, not a ZIP, empty ZIP;
- missing/duplicate `manifest.json`, bad JSON, unsupported future
  `schemaVersion`, count mismatch, checksum mismatch;
- missing required field, invalid enum/date/decimal, duplicate source ID;
- broken FK, cross-customer parent/owner, equipment/report unit owned by a
  different customer, document ownership mismatch;
- missing file, size mismatch, checksum mismatch, MIME spoof (HTML/SVG as
  PDF/image), PDF without header, oversized file, too many entries, zip bomb
  (high ratio/nested archive);
- path traversal (`../`, absolute, backslash, encoded traversal), symlink,
  hardlink, NUL in name;
- duplicate import: second run dry-run all `skip`/already imported; no new rows;
  explicit "new" creates only what the admin selected;
- conflict policies: skip/update/new for customer/equipment; update diff;
  new contract without duplicate contract number; report never updated;
- abort after dry-run; abort during import; simulated DB failure after some
  inserts; simulated file-move failure; simulated crash and reconciliation;
- target changed between preview and confirm → 409 and no writes;
- two concurrent imports of the same package/customer → one succeeds, one
  waits/fails cleanly;
- wrong role: office with `settings.manage`, technician, customer portal,
  inactive admin, missing permission, API key without explicit support;
- cross-site POST/CSRF, expired preview token, token for another admin/job;
- oversized package upload rejected before buffering; rate limit works;
- export download after expiry → 410/403; no public access without session.

Run the critical cases both in unit tests (fast, precise) and in integration
tests (real DB/files). E2E: admin can complete a small export/import flow;
office/customer cannot see the tab or call the routes; preview errors render
accessibly.

### 12.5 Test commands

```bash
npm run typecheck
npm test
npm run test:coverage
TEST_DATABASE_URL=postgresql://…/fsm_integration npm run test:integration
npm run test:e2e
npm run check:i18n:strict
npm run lint
npm run build
```

The release is not accepted until the real-Postgres transfer test passes in CI.

---

## 13. Acceptance criteria

A future implementation is complete only when all of these are true:

1. Only an active user with role `ADMIN` **and** `settings.manage` can reach the
   UI, start export, preview, confirm import, download a package or read a
   validation report. All checks are server-side and covered by tests.
2. An admin can export at least the full scope in §5, including binaries, and
   receives a ZIP whose manifest/counts/checksums verify.
3. A dry-run produces exact counts, conflicts, warnings and errors without
   writing to the target database, upload directory or live audit history.
4. An admin can import into a clean database and recover all relationships and
   files listed in §12.3, with new IDs and no secrets.
5. All-or-nothing behaviour is demonstrated: induced failure leaves the target
   DB unchanged and no orphan files; successful import leaves no unreferenced
   files.
6. Duplicate import and every conflict policy (skip/update/new) behave as
   specified; signed reports are never mutated.
7. Malicious/malformed packages (traversal, zip bomb, MIME spoof, checksum
   mismatch, oversized, missing file) are rejected safely with stable errors.
8. Import audit entry exists and contains no secrets/PII payload; export and
   import are traceable by job ID/package checksum.
9. The full test plan in §12 passes against real PostgreSQL, including E2E
   denial tests and a11y/i18n checks.
10. Docs are updated: this spec status, `docs/API.md`/OpenAPI only if an API is
    exposed, `docs/OPERATIONS.md` for limits/cleanup/storage, and a user-facing
    manual page for admins. Do not claim completion before CI is green.
11. No password/hash/session/API key/2FA secret appears in any package, log,
    test fixture, screenshot or documentation example.

---

## 14. Delivery slices for future workers

Each slice should be a separate PR/commit series, with the previous slice's
acceptance criteria green. Do not combine schema migration, import commit and UI
in one unreviewable change.

### Slice 0 — Decisions and ADR

- Confirm package ownership model, encryption/signature stance, legal basis for
  signatures/HMS, retention/cleanup, size limits and reference-creation policy.
- Record decisions in `docs/DECISIONS.md` and update this document's status to
  "in progress" only when work actually starts.
- No runtime code.

### Slice 1 — Schema and ownership foundations

- Add `CustomerTransferJob` and `CustomerTransferRecord` (or equivalent ledger)
  in a new migration; indexes/uniques for idempotency and job lookup.
- Add document ownership (`Document.customerId`/`productId` or a link table) and
  optional equipment attachment/version model if in scope.
- Backfill only provable ownership; leave ambiguous rows unowned.
- Add Prisma tests/integration tests for constraints and cascade behaviour.
- Update `docs/DECISIONS.md`.
- No export/import UI yet.

### Slice 2 — Package format and export service

- Define JSON schemas (zod) for manifest and data collections; version them.
- Implement streaming export service and temporary ZIP storage.
- Include all §5 data; explicit excludes; missing-file warnings.
- Internal export API + authenticated download, rate limits, audit.
- Unit tests for manifest, stable sorting, checksums, scope filtering, no
  secrets, URL safety.
- Do not build import yet.

### Slice 3 — Safe package reader and dry-run

- Streaming ZIP reader with traversal/bomb/MIME/size limits.
- Schema/version/count/checksum validation and referential/ownership checks.
- Dry-run conflict analysis and validation report.
- Job persistence/progress; preview token; abort/cleanup.
- Tests for malformed/abusive packages and dry-run no-write guarantee.

### Slice 4 — Import execution

- ID mapping, conflict policies, transactional DB writes, staged file commit,
  rollback/reconciliation.
- Portal users disabled; staff/reference mapping; report immutability.
- Import audit and result report.
- Mandatory real-Postgres integration suite from §12 plus concurrency/retry
  tests.

### Slice 5 — Admin UI

- Settings tab, export form, import upload/preview/policy/confirm/progress/result.
- PII warnings, server-side gating, error translations, mobile/a11y.
- i18n keys in nb/en/pl/de; audit action translations.
- E2E admin flow and denial for office/customer.

### Slice 6 — End-to-end verification, docs and release

- Run the full fixture export → clean import → verify on real Postgres in CI.
- Run all commands in §12.5.
- Update `docs/OPERATIONS.md` (storage, cleanup, limits, monitoring),
  `docs/API.md`/OpenAPI if applicable, and the admin manual.
- Update this document: only now may the status change from backlog to shipped,
  with evidence (commit, test run, known limitations).

---

## 15. Risks and open questions

### 15.1 Storage and performance

- A customer with many high-resolution photos/PDFs can be large. Streaming,
  temp quotas and per-file/total caps are mandatory. What is the real maximum
  for the largest expected customer? Set limits from measured data, not guesses.
- Local disk vs future S3/MinIO (`docs/DECISIONS.md` P4-1). The service should
  use a storage abstraction, not hardcode `uploadDir()` everywhere. Until then,
  cleanup/reconciliation must be robust.
- Long-running exports/imports need a durable job runner. If the process dies,
  who resumes? Define timeout, retry and alerting.
- File-system moves are not atomic with DB commits. The reconciliation job is a
  hard requirement, not an optional nice-to-have.
- Rate limits and job locks are DB-backed; multi-instance behaviour must be
  tested. Advisory locks or unique constraints are preferred over in-memory
  mutexes.

### 15.2 Legal, privacy and compliance

- What is the legal basis for exporting/importing customer signatures, HMS
  forms and health-related documentation? If unclear, default to excluding
  signatures and requiring explicit approval.
- Is the receiving installation the same data controller? Cross-border transfer,
  processor agreements and data-subject rights must be documented.
- Retention of exported ZIPs and validation reports: how long, where, who can
  access? Proposed 24 hours for artifacts, but the import ledger may need a
  longer audit retention. Align with `docs/DECISIONS.md` retention rules.
- Should exports be encrypted at rest / password-protected? ZIP passwords are
  weak; recommend envelope encryption with a reviewed library if required.
  Decide before handling real PII.
- Should customers be notified? Does the export include data the customer
  portal cannot see? Ensure the admin warning explains scope.
- Audit retention vs data minimisation: source audit snapshots can contain
  personal data. Limit fields and retention.

### 15.3 Evidence, reports and audit

- Signed/locked reports are immutable evidence. Never update them; import new or
  skip. Legal hold must be preserved and must block destructive actions.
- Report PDFs may be stale relative to `dataJson`/revisions. Exporting the cached
  PDF preserves what was shown, but may not match a regenerated PDF in a new app
  version. Decide whether to record `pdfGeneratedAt`, `pdfHash`, app version and
  a warning; never silently regenerate during import.
- Should the package be cryptographically signed (Ed25519/HMAC) and by whom?
  Checksums alone detect corruption, not malicious tampering. The existing
  decision recommends a signed package/hash chain; implement only with key
  management, rotation and a clear trust model.
- Copying source `AuditLog` rows into the target would forge history. Keep them
  as provenance and write a single target audit entry. Confirm this with
  compliance.
- If the target has an audit hash chain in the future, imports must integrate
  with it rather than bypass it.

### 15.4 Data model and cross-version compatibility

- Current schema gaps: no document ownership, no equipment attachment versions,
  no generic natural key for templates/categories. These must be resolved before
  claiming complete scope.
- Schema version compatibility across app releases: how long are old package
  versions accepted? Provide explicit migrators and tests; never silently drop
  unknown fields that affect meaning.
- Enum changes, renamed fields, timezone/date changes and decimal precision can
  break imports. Validate and document a compatibility matrix.
- Global catalogs (departments, templates, tags, price lists, SLA) may differ
  between instances. Mapping by name is convenient but ambiguous; show all
  matches and require explicit selection when not unique.
- Multi-tenant future: today the app appears single-installation with
  departments. If true multi-tenancy arrives, ownership checks and package
  scoping must be tenant-aware; a customer package must never cross tenants.
- Work order references are globally unique and human-facing. Importing a
  package with conflicting references requires generating new references and
  preserving the source in the ledger; decide how support staff find the
  original.
- Equipment QR tokens must not be reused. Confirm label reissue workflow.
- Portal user email collision with an existing internal user is a security
  event; block, do not convert roles.

### 15.5 Product/UX questions

- Should export be per customer only, or multi-customer? Multi-customer is useful
  for migrations but increases cross-link risk. Recommended: support a list but
  validate isolation; start with one customer in v1 UI if needed.
- Who may download a package after the initiating admin leaves? Proposed:
  only the initiating admin until expiry; add an explicit transfer-of-ownership
  flow later.
- Should imported customers be marked "imported" or need review before portal
  access? Recommended: yes, a review state/banner and disabled portal users.
- Should the importer create missing departments/templates/tags? Default no;
  require explicit consent and audit each created global row. Otherwise a
  customer import silently changes global configuration.
- How should conflicts with deleted/legal-hold customers be presented? Do not
  auto-restore.
- Is a "metadata-only" export needed for support/debugging? It can reduce PII
  exposure, but must never be importable as a full restore. If offered, label it
  clearly and block import of missing files.

---

## 16. Appendix — fixture checklist and error-code sketch

### 16.1 Fixture checklist

- [ ] Department A + B, default department, business hours
- [ ] Admin, office (`settings.manage` without ADMIN), technician, portal user
- [ ] Customer A with org/customer numbers, logo, notes, department, technician
- [ ] Contacts, portal delegation, primary/non-primary sites
- [ ] Equipment category tree (≥3 levels)
- [ ] Equipment hierarchy (≥3 levels), all statuses, warranty, meter unit
- [ ] Meter readings with decimals and both sources
- [ ] Calendar + meter maintenance plans and occurrences
- [ ] Contract + lines + template/SLA/price-list references
- [ ] Work orders (open/completed/deleted/legal hold), visits, technicians,
      comments, tags
- [ ] Reports: signed/locked, units, revisions, PDF, signatures
- [ ] Customer attachments, equipment uploads, document library with versions,
      folders, tags, ownership links
- [ ] Audit rows for included entities
- [ ] Customer B with overlapping external keys for isolation tests
- [ ] Missing-file case, oversized file, MIME-spoof file, path-traversal entry

### 16.2 Error-code sketch (stable keys, final names TBD)

- `customer_transfer.unsupported_schema`
- `customer_transfer.invalid_manifest`
- `customer_transfer.count_mismatch`
- `customer_transfer.checksum_mismatch`
- `customer_transfer.missing_file`
- `customer_transfer.file_too_large`
- `customer_transfer.too_many_entries`
- `customer_transfer.compression_ratio`
- `customer_transfer.path_traversal`
- `customer_transfer.unsupported_mime`
- `customer_transfer.mime_mismatch`
- `customer_transfer.invalid_reference`
- `customer_transfer.cross_customer_reference`
- `customer_transfer.duplicate_source_id`
- `customer_transfer.conflict`
- `customer_transfer.policy_required`
- `customer_transfer.preview_stale`
- `customer_transfer.forbidden`
- `customer_transfer.rate_limited`
- `customer_transfer.job_expired`
- `customer_transfer.import_failed`
- `customer_transfer.cleanup_failed`

Use `messageKey` translations in all four catalogs; never expose raw stack
traces or filesystem paths to the client.

---

## 17. References

- `docs/DECISIONS.md` — export/retention decision and recommended admin export.
- `docs/OPERATIONS.md` — backups, upload volume, storage and retention.
- `docs/API.md` — internal/public API conventions (if an API is exposed later).
- `CONTRIBUTING.md` — service layer, auth, audit, i18n and test conventions.
- `src/lib/settings-tabs.ts`, `src/components/settings/SettingsTabs.tsx`,
  `src/app/innstillinger/page.tsx` — settings tab pattern.
- `src/lib/access.ts`, `src/lib/permissions.ts`, `src/server/actor.ts` —
  authorisation patterns.
- `src/lib/uploads.ts`, `src/lib/upload-validation.ts`,
  `src/lib/upload-slot.ts`, `src/app/uploads/[...path]/route.ts` — file
  storage/security.
- `src/lib/report-pdf-store.ts`, `src/server/reports.ts` — report PDF cache.
- `src/lib/audit.ts`, `src/lib/audit-actions.ts` — audit conventions.
- `prisma/schema.prisma` — entity definitions and ownership gaps described in
  §3.1.
