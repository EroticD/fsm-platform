# UI/UX backlog — agent work queue (revision 2)

Re-audit of the same five areas at HEAD `e8480fc`, verifying every revision-1
claim against current code. Revision 1 was lost (never committed); this file is
the authoritative version. Commit it.

> **Fixes landed since revision 1** (`6cddf33`, `2fa7e7`, `ddc4646`, `8026f9e`,
> `bfa27a3`, `30137e2`, `e8480fc`): date boundary, end-before-start validation,
> dispatch-tab permission gating, global focus ring, neutral confirm dialog,
> mobile header overlay/search collapse, outbox coalescing, logout preserving
> drafts, document global text search, report-submitted cleanup.
>
> **Screenshots in `screenshots/` are stale** (2026-10-24, pre-`ddc4646`) and
> still show removed features. Re-capture before using them as evidence.

**How to use**

- Claim an item by flipping `[ ]` → `[~]` and adding your branch.
- Keep `npm run typecheck`, `npm test`, `npm run lint`, `npm run check:i18n`
  green; obey `CONTRIBUTING.md` (Norwegian UI copy, service layer, re-auth).
- Acceptance criteria are the definition of done. Add tests where testable.
- Never touch `prisma/migrations/**` here.

Legend: **S** <½ day · **M** 1–2 days · **L** 3+ days.

---

## Status of revision 1

| Rev-1 item | Status now | Evidence |
| --- | --- | --- |
| UX-01 design tokens + base layer | **Partial** | Focus ring done (`globals.css:34-36`). Still no `--primary-foreground`/danger/muted/type scale; coarse rule still only `button, [role=button]` (`globals.css:67-70`). 24 `bg-[var(--primary-color)] text-white` sites. |
| UX-02 `ui/` primitives | **Partial** | PageHeader 7 uses, SectionCard 11, EmptyState 3; no `src/components/ui/`. Several pages still hand-roll `<h1>`. |
| UX-03 confirmation contract | **Fixed** | Neutral defaults (`lib/confirm-dialog.ts:8-12`); all destructive sites pass `danger`. Dialog id/focus issues remain → R2-15. |
| UX-04 localized date sweep | **Open** | `NotificationCard.tsx:74`, `AuditLogTable.tsx:61`, `oppdrag/page.tsx:417`, `mine-oppdrag/[id]/page.tsx:249`. |
| UX-05 i18n hardening | **Open** | Static Norwegian metadata (`layout.tsx:28-47`); checker only scans JSX text (`check-i18n.mjs:87`). |
| UX-06 “I dag” included tomorrow | **Fixed** | `lib/work-order-date-where.ts:18` uses `lt`; both callers + tests. |
| UX-08 silent end-date drop | **Fixed** | `dateRangeError` → `sluttdato-for-startdato` (`server/work-orders.ts:198-204`), Zod + UI mapping. |
| UX-11 error/404 | **Partial** | No `global-error.tsx`; `error.tsx:23` still `min-h-screen`, `<h2>` only, no digest; `not-found.tsx:12` hardcodes “FSM”. |
| UX-14 draft restore integrity | **Partial** | Remount + notes/signatures restored, but images and unit/line comments never enter the snapshot → R2-04. |
| UX-15 outbox coalescing | **Fixed** | Upsert + ordered replay + newest-wins (`lib/offline/db.ts:123-179`, `outbox-order.ts`). |
| UX-16 logout draft loss | **Fixed** (drafts kept) | `LogoutButton.tsx:26-38` clears caches only. Offline-submit guard still missing → R2-05. |
| UX-21 dashboard action queue | **Partial** | Reports link fixed; mobile order reworked. Still 8 KPIs, 12-query `Promise.all`, `take: 100`, first job ~700 px down. |
| UX-22 nav/mobile shell | **Partial** | Overlay drawer + mobile search collapse done. Still 9 flat items wrapping at 1024–1280, duplicate Settings tile, no breadcrumbs, language hidden <640. “Add Rapporter/Utstyr” was **wrong** (product decision). |
| UX-24 status transitions | **Partial** | `force: true` claim was **wrong**. Fixed status list still used instead of `allowedTransitions` → R2-02. |
| UX-25 calendar | **Partial** | Dispatch tab now permission-gated (`lib/calendar-tabs.ts`). Calendar still `editable: true` unconditionally → R2-08; three routes remain. |
| UX-37 branding flash | **Fixed** | Branding is read once in the root layout and emitted as a server `<style>` (`layout.tsx:76-118`). |

**Corrections to revision 1:** “`force: true` in detail actions” was false;
“add Rapporter/Utstyr to nav” contradicts the product decision (keep them out);
primitive adoption is no longer zero.

---

## P0 — data-loss risk

- [ ] **R2-01 · Confirm destructive admin actions** — M
  `UsersAdmin.tsx:484` (delete user), `RolesAdmin.tsx:183` (delete role),
  `TagsTab.tsx:89,159` (delete tag) are bare `<form><button>` — one click,
  irreversible. Wrap in `ConfirmSubmitForm` with `danger` + entity name.
  Add these call sites to a regression test that asserts every `delete*`
  action is behind a confirmation.
  Done when: no destructive action submits on a single unconfirmed click.

## P1 — correctness, blocked workflow, silent failure

- [ ] **R2-02 · PENDING masquerades as WAITING** — S
  `orders.detail.statusPending` and `statusWaiting` are both “Venter”
  (`messages/nb.json:113,115`). The option list dedupes by label and PENDING
  sorts first (`oppdrag/[id]/page.tsx:440-447`,
  `mine-oppdrag/[id]/page.tsx`), so picking “Venter” sends `PENDING` — illegal
  from every open state — while legal `WAITING` is hidden. Technicians cannot
  set “Venter” at all.
  Build options from `allowedTransitions()` (`lib/work-order-status.ts`, unused
  outside tests), give PENDING/WAITING distinct labels (or normalize
  PENDING→WAITING), and test the option set for PLANNED and IN_PROGRESS.
  Done when: every offered status is accepted by the server.

- [ ] **R2-03 · Document filters can't be cleared** — S
  `folderLink()` re-applies `q`/`tag`, so the “Nullstill” link
  (`DocumentBrowser.tsx:134-141`) and the active tag chip (`:154-157`) link to
  the current URL — clicking does nothing. Build reset hrefs from scratch;
  add a unit test on the href builders.
  Done when: both controls clear the filter in one click.

- [ ] **R2-04 · Draft restore still loses evidence** — M
  Restore reconstructs notes/signatures, but `IMAGE` fields never call
  `onValueChange` (`FieldInput.tsx:272-280`) and unit/line comment editors have
  no `onChange` (`ReportForm.tsx:711-717`), so images and comments are absent
  from `state` and are overwritten with empty values on remount. Banner claims
  “alle feltene”.
  Make those fields report value changes, or merge `snapshot.form` keys
  (`answer__*`, `comment__*`, `linecomment__*`) during restore; add a test using
  a snapshot produced by the real form path.
  Done when: a restored draft shows and submits the same photos/comments the
  technician entered.

- [ ] **R2-05 · Offline submit has no guard** — S
  `ReportForm.tsx:426-430` posts regardless of connectivity. Disable submit when
  `!navigator.onLine` with “Rapporten kan ikke sendes offline – kladden er
  lagret”, and keep the action pending until reconnection.
  Done when: a technician can never believe an offline report was sent.

- [ ] **R2-06 · Report submit contract** — M
  Three inconsistencies in one flow:
  - Button says “Lagre rapport” and locks the report (`reports.ts:1076`), with no
    review/confirmation.
  - `ReportSubmissionCleanup` renders `null` and strips `?reportSubmitted`, so
    there is no success banner (key doesn't exist).
  - `orders.reportForm.noUnits` promises the report is saved with zero units,
    but the server rejects `unitRows.length === 0` (`reports.ts:1012`) and the
    button stays enabled.
  Add a review dialog (units, deviations, photos, signature, “låses”), a
  persistent success banner with PDF link, and either block removing the last
  unit or fix the copy + dedicated `mangler-enhet` error.

- [ ] **R2-07 · 2FA lockout is permanent** — M
  No recovery codes anywhere; disabling 2FA needs the current TOTP
  (`SecuritySettings.tsx:130-159`); no admin reset. Pending cookie is 5 min
  (`session-token.ts:86`) and expiry redirects to `/logg-inn` **before** the
  error param is read (`2fa/page.tsx:27-28`).
  Add 10 hashed single-use recovery codes + login path, an admin reset with
  audit, raise TTL to 10–15 min, and surface `TwoFactorExpired`.
  Done when: a lost phone does not require DB surgery.

- [ ] **R2-08 · Calendar edit permission ignored** — S
  `FullCalendarView.tsx:128-134` sets `editable/droppable/eventDurationEditable`
  unconditionally; `canEdit` only gates a link. The date API requires
  `workorders.update`, which technicians have — so decide: either gate editing
  on `canEdit` or explicitly document field rescheduling and keep it. Add a test
  either way.

- [ ] **R2-09 · Bulk document import is untruthful** — M
  One failed file `throw`s out of the loop (`BulkUploadForm.tsx:91`), abandoning
  the rest after earlier files were already uploaded; dedupe checks only the
  first 1000 files in the current folder; `bulkCreateDocuments` returns `void`
  and the client prints “N filer lastet opp” even when the action failed.
  Continue on error, return `{created, skipped, failed}`, show per-file results
  with retry, and clean up orphan uploads.

- [ ] **R2-10 · Action feedback gaps** — M
  Customer edit/unit CRUD, document upload/edit, notification settings, portal
  acknowledge/contact-update and comment posting all succeed or fail silently.
  `CommentSection.tsx:53-61` never clears `submitting` on non-2xx (infinite
  spinner). Use `SubmitButton`/`useFormStatus` + toast/banner, and reset state in
  `finally`.

- [ ] **R2-11 · Search layouts hide results on mobile** — M
  `/sok` renders the filter `<aside>` before results (`sok/page.tsx:307-317`);
  measured ~1,460 px of filters before the first hit at 375 px. Put results
  first and filters behind `<details>Filtre (n)</details>` on `<lg`.
  Also: two search inputs can hold different queries — make the header input the
  only authoritative one (or hide it on `/sok`), and fix the hardcoded `⌘K`
  hint (`GlobalSearch.tsx:431`).

- [ ] **R2-12 · Customer activity feed is false** — M
  “Siste aktivitet” queries `entityType: "Customer"` only
  (`server/customers.ts:171-178`), so a customer with orders/contracts/reports
  shows “Ingen aktivitet”. Merge WorkOrder/Report/Contact audit rows into one
  timestamped feed with links.

## P2 — UX debt and accessibility

- [ ] **R2-13 · Unlabeled form controls** — M
  26 orphan `<label>`s (no `htmlFor`, not wrapping): `FieldInput.tsx:197-304`,
  `ReportForm.tsx:549-590,711-726`, `RolesAdmin.tsx:63-75`, `WorkOrderForm.tsx`,
  `TemplateBuilder.tsx`; 16 unlabeled `<select>` incl. dispatch filters;
  3 placeholder-only search inputs. Build `Field` with `useId` and migrate the
  report/customer/user forms first.

- [ ] **R2-14 · Contrast failures** — M
  `text-gray-400` at 2.54:1 (36×, e.g. `SignaturePad.tsx:124`,
  `GlobalSearch.tsx:410`, `kundeportal/page.tsx:479`); amber-500/600 + white
  2.1–3.0:1 (`oppdrag/[id]/page.tsx:745`); `green-600`+white at `text-xs`
  (`ContactCard.tsx:135`); white on arbitrary tag colours (`TagSelector.tsx:72`).
  Raise to gray-600/amber-700/green-700 and apply `readableTextColor` to tag
  chips. Also add `--primary-foreground` derived from brand colour and stop
  hardcoding `text-white` on `var(--primary-color)` (24 sites).

- [ ] **R2-15 · Dialog + toast semantics** — S
  `ConfirmDialog.tsx:103-111` hardcodes ids (duplicate if two open), focus
  effect depends on inline `onCancel` (refocus thrash), no `aria-busy`, no
  scroll lock. `ToastProvider.tsx:39-40` uses one polite region for errors, 4 s,
  no dismiss/pause, no cap. Use `useId`, a stable callback ref, portal + `inert`,
  `role="alert"` for errors, dismiss + pause.

- [ ] **R2-16 · Table semantics and mobile audit log** — M
  10 of 27 `<th>` lack `scope`; 5 of 9 tables lack captions
  (`AuditLogTable`, `NotificationPreferences`, `kundeportal`).
  `AuditLogTable` is `overflow-hidden` with `truncate`, so actions clip on
  phones. Add `scope`/`caption`, `overflow-x-auto` region, and a card layout
  below `sm`.

- [ ] **R2-17 · Small/dead interactive affordances** — S
  Icon-only delete buttons rely on `title` (`UsersAdmin.tsx:490`,
  `ContactCard.tsx:71`, `ConsumerAttachments.tsx:196`, `TagSelector.tsx:126`);
  tag selection indicated by colour only (no `aria-pressed`); coarse-pointer rule
  excludes links/inputs/selects; 72 remaining 9–11 px texts (16 in
  `mine-oppdrag/[id]`, 10 px labels in `BookingForm.tsx:63,81`).

- [ ] **R2-18 · Pagination duplicated 7×** — M
  `oppdrag`, `kunder`, `rapporter`, `kundeportal`, `DocumentBrowser`,
  `AuditLogTable`, `UsersAdmin` each hand-roll it; only `/sok` has
  `<nav aria-label>`. `/oppdrag` doesn't clamp page → stale `?side=999` shows an
  empty list. Ship one `Pagination` with `aria-current`, first/last, clamping.

- [ ] **R2-19 · Document library workflow** — L
  Upload/new-folder/bulk panels sit **below** the list (`DocumentBrowser.tsx:386-435`);
  no bulk select/move/tag/delete; no folder rename/move/delete (`deleteFolder`
  exists unused, and deleting a parent silently moves child docs to root);
  versions nested in the edit row with no per-version download/restore; folder
  cap of 200 silent. Move actions into a sticky toolbar/modal, add bulk ops and
  a version drawer, block non-empty folder delete.
  Tag filtering is also still folder-scoped while text search is global — make
  scope explicit with a “Kun denne mappen” toggle and show the folder path on
  hits.

- [ ] **R2-20 · Search result targeting** — M
  Document hits open the raw `/uploads/...` file (no title/tags/versions) and
  report hits open the combined work-order PDF, not the specific report
  (`lib/search.ts:923,1017`). Add `/dokumenter?doc=<id>` and a per-report route
  (`/rapporter/<wo>?rapport=<id>`).

- [ ] **R2-21 · Dispatch board** — L
  Still no drag-and-drop; no date/search filter, no technician grouping, 500-row
  cap (`dispatch/page.tsx:78-90`), one modal per assignment, removal defaults to
  the first technician and names nobody, errors render at page top after a long
  scroll, all statuses offered (incl. illegal). Group by date/technician, drag to
  assign, per-person remove, legal statuses + inline row errors.

- [ ] **R2-22 · Status counts ignore filters** — S
  `statusGroups` where = `visibleStatus` only (`oppdrag/page.tsx:201-205`), so a
  zero-result search still shows “Alle 5”. Apply `filters` to every count, and
  rename “Alle” → “Aktive” (description currently claims all orders, excluding
  closed).

- [ ] **R2-23 · Map correctness** — M
  Date filter matches only `scheduledFor`, excluding multi-day jobs already
  running (`kart/page.tsx:64-65`); default shows up to 1000 orders; identical
  markers, no status/legend/technician; `role="application"` on the map;
  `dateFrom > dateTo` silently empty. Use interval overlap, default today/week,
  status-coloured clustered markers, region semantics tied to the list.

- [ ] **R2-24 · Dashboard completion** — M
  Still 8 equal KPIs and 12 queries in one `Promise.all`; `take: 100` today-cards
  duplicates rows and buries overdue on busy days; “Enheter” subtitle counts
  completed work orders, not units (`page.tsx:501-507`). Cap today at 5–8 + “Se
  alle”, promote overdue/unassigned above secondary KPIs, fix the Enheter metric,
  add Suspense sections.

- [ ] **R2-25 · Header overflow** — S/M
  9 flat nav items + logout wrap to two rows at 1024–1280 px (`navigation.ts:18-32`,
  `BrandedHeader.tsx:206-214`). Group to 5 + “Mer” or move logout into a user
  menu. Also remove the duplicate Settings tile in the mobile drawer
  (`BrandedHeader.tsx:330-338`) and show the language control on mobile.

- [x] **R2-26 · Branding first paint** — M
  Done: branding is read once in the root layout, passed to the header, and
  emitted as `--primary-color` in a server `<style>`.

- [ ] **R2-27 · Metadata + i18n leak** — L
  Static Norwegian metadata (`layout.tsx:28-47`) with no per-page titles; server
  layer returns Norwegian literals for search subtitles (`lib/search.ts`), audit
  actions (`server/*.ts`), HMS templates (`lib/hms.ts`, 118) and validation
  (`lib/schemas/workOrder.ts:40`); `check-i18n.mjs` ignores `.ts`, attributes and
  string literals. Return keys/params, localize metadata, extend the checker,
  add a terminology glossary (oppdrag/montør/tekniker/kundens ordrenummer).

- [ ] **R2-28 · a11y CI gate is blind** — M
  `e2e/a11y.spec.ts:5,18` blocks only critical/serious and only WCAG 2.0 A/AA;
  routes exclude `/kundeportal`, `/sok`, `/rapporter`, `/hms`, `/brukere`,
  `/oppdrag/[id]`; Lighthouse is not in CI; ESLint has no
  `jsx-a11y/label-has-associated-control`. Add moderate + 2.1/2.2, the full
  route matrix, dialog/toast states, keyboard flows, and a Lighthouse job.

## P3 — polish

- [ ] **R2-29 · Page states** — M
  Only root `loading.tsx`/`error.tsx`; add route-shaped `loading.tsx` for
  `/oppdrag`, `/kunder`, `/sok`, `/kalender`, `/dokumenter`, `/rapporter`; add
  `global-error.tsx`; fix double live-region announcement
  (`loading.tsx:9` + `Skeleton.tsx:27`); `error.tsx` → `<h1>`, digest, retry,
  `min-h-[60vh]`; brand the 404 and make its recovery links role-aware.

- [ ] **R2-30 · Notification UX** — M
  Bell is still a link with a 60 s poll (`NotificationBell.tsx:62`); add a
  popover, optimistic decrement, mark-all-read, and localized relative time;
  render cards as `<a>` not POST buttons (`NotificationCard.tsx:117-127`);
  disable pagination at boundaries (`varsler/page.tsx:106-128`).

- [ ] **R2-31 · Calendar consolidation + legend** — M
  Three routes render one component with different `initialView`; in-calendar
  view buttons desync the URL. Use `/kalender?vis=` with one switcher, add a
  status legend (colours are undocumented), hide the unassigned warning for
  non-dispatch users (`kalender/page.tsx:91-112`), fix OPEN shown as “Planlagt”
  in the resource overview (`:148-152`).

- [ ] **R2-32 · Customer surface** — L
  8 tabs without counts/`aria-current`; no `/enheter/[id]` so unit links land at
  the top of a 100-unit tab; list has only name/org.nr with the create form
  permanently open; “Utfylte sjekklister” KPI links to the wrong tab; the
  brand-colour text field doesn't update. Consolidate to ~5 tabs, deep-link
  units, add list columns/sorting, collapse the create form.

- [ ] **R2-33 · Portal booking + feedback** — M
  Booking captures only title/description — no requested date, equipment, or
  contact — and the availability table can't be acted on; no cancel/reschedule;
  acknowledge/contact forms have no pending/error state; 560 px table forces
  horizontal scroll. Add fields + slot picker, reference and next steps,
  `useActionState` feedback, and a card layout on phones.

- [ ] **R2-34 · Field ergonomics leftovers** — M
  Checklist still 3–4 screens down on `mine-oppdrag/[id]` (comment editor and
  personnel first); “Ta oppdrag →” only opens detail (no self-assign action);
  no tap-to-call/map on list cards; photo input forces `capture` and clears
  failed files (`ImageUploadField.tsx:107`); no client-side compression/retry.
  Add sticky “Fortsett skjema”, real claim action, contact shortcuts, and a
  camera/gallery choice with a retry queue.

- [ ] **R2-35 · Offline shell completion** — L
  Only the report form HTML is cached (`sw.js:14-16`); `/mine-oppdrag` and job
  detail are not, and submitting one report clears the whole page cache. Queue
  local-only drafts into the outbox (currently only failed POSTs are queued, so
  a killed tab never syncs and the banner says 0), cap outbox retries
  (`attempts` unused → 413 loops forever), and add “forkast kladder”.

- [ ] **R2-36 · Reports list + report PDF targeting** — M
  `/rapporter` only filters month + HMS; every “Se rapport” surface opens the
  combined work-order PDF with no way to reach a specific checklist. Add
  customer/technician/deviation/text filters and a per-report PDF route.

- [ ] **R2-37 · Screenshot refresh** — S
  Re-capture all screenshots at HEAD. The cleanup part (dead files, duplicate
  calendar key, `PageHeader`/`SectionCard`, `DECISIONS.md`) is done.

---

## Waves

| Wave | Items | Notes |
| --- | --- | --- |
| 1 | R2-01, R2-02, R2-03, R2-05, R2-08, R2-22, R2-15 | Small, independent, high trust value |
| 2 | R2-04, R2-06, R2-07, R2-09, R2-10, R2-11, R2-12 | One per flow; R2-04 before any further offline work |
| 3 | R2-13, R2-14, R2-16, R2-17, R2-18, R2-28 | Foundation/accessibility block, parallel-safe |
| 4 | R2-19, R2-20, R2-21, R2-23, R2-24, R2-25, R2-26 | Surface redesigns |
| 5 | R2-27, R2-29…R2-37 | i18n, polish, offline shell |

**If you only do five:** R2-01 (one-click deletes), R2-02 (can't set “Venter”),
R2-06 (report submit contract), R2-04 (restored drafts lose evidence),
R2-28 (turn the a11y gate back on).
