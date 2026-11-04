# Administrator

Applies to FSM Platform **0.8.9** (2026-11-04). This chapter is for system administrators who configure the platform, manage users and permissions, set up integrations, and are responsible for data, security and operations. It covers configuration and governance. Day-to-day workflows for office, technician and customer portal users are described in their own chapters.

## 1. The administrator role and delegation

Administrators always have every permission, including deletion, unlocking submitted reports, legal hold, roles, departments and API keys. The Office role is an operations role with broad access inside its own department, but without the most security-sensitive actions.

| Task | Administrator | Office | Recommendation |
| --- | --- | --- | --- |
| Roles, departments and API keys | Yes | No | Keep with administrators. |
| Administrators, deletion and moves | Yes | No | Keep with administrators. |
| 2FA, report unlocking and legal hold | Yes | No | Keep with administrators. |
| Activity log | Yes | No | Grant `audit.view` deliberately. |
| Employees in own department | Yes, all | Yes, own department | Delegate to the department lead. |
| Customers, work orders, agreements, templates and reports | Yes | Yes | Delegate to office and subject-matter owners. |

Office has `settings.manage`, `users.manage` and `dispatch.configure` by default, so it can change branding, map, SMS and dispatch settings. If that is too broad, create a separate role, for example **Service manager**, without `settings.manage`. Changes to the built-in Office role affect everyone who has it.

**Least privilege:** grant the weakest role that solves the task, use dedicated roles for leads and integrations, and keep at least two active administrators.

## 2. Departments and department scoping

Work orders, service agreements and employees belong to a department. Employees only see work orders in their own department. Customers and documents are shared; reports are department-scoped unless the user has `reports.viewAllDepartments`.

**Create a department:**

1. Go to **Settings → Departments**.
2. Enter **Name** and optional contact details.
3. Leave **Enable live tracking** off until privacy has been assessed.
4. Select **Create department**.

**Expected result:** the department appears with counts for employees, work orders and agreements. One department is the **Default** and is used when a work order or booking does not specify another. The default department cannot be deactivated until another department is set as default.

**Warning:** deactivating a department signs out all employees in it, clears calendar subscriptions and makes its work orders unavailable, because work-order queries require an active department. Accounts are kept and the department can be reactivated. Notify users in advance.


## 3. Users, invitations and sessions

**Create a user:** go to **Settings → Employees & Roles** or `/brukere`, select **Add new user**, enter **Full name**, **Email address** and optional **Phone**, choose **Role / Access level** and **Department**, then select **Create and generate invitation**. Employees need a department to see and create work orders.

The user is created inactive. You either get confirmation that the invitation email was sent, or an **Invitation link** you can send manually. The link is shown only in the page content, is valid for seven days, and can only be used by an inactive account. Without `SMTP_HOST` and `SMTP_USER`, the app cannot send email. Active users must use **Forgot password**.

**Activate the account:** the user opens the link and chooses a password. The account is still inactive. Find the user under **Employees & Roles** and select **Activate**. Only then can the user sign in. Ask the user to set up 2FA under **Settings → Security**.

**Deactivate and delete:** **Deactivate** signs the user out, clears the calendar subscription and blocks sign-in and API access. **Activate** restores access. **Delete user** is administrator-only and cannot be used on yourself or the last active administrator.

**Passwords and 2FA:** administrators cannot see or set a password. **Forgot password** sends a one-time link valid for one hour, rate-limited per email and IP. **Reset 2FA** disables two-factor authentication, deletes recovery codes and signs out all sessions. Use it only when a device is lost or misuse is suspected.

**Sessions:** there is no session list or “sign out everywhere” button. Sessions are invalidated when the password changes, 2FA changes or is reset, the user is deactivated, or the user’s role, permissions or department change. Editing a role definition applies on the next request without signing users out.

### Change password, 2FA and recovery codes

1. To change your password, sign out and use **Forgot password** on the sign-in page. 0.8.9 has no separate change-password page. The link is valid for one hour, and all other sessions are invalidated when the new password is set.
2. Go to **Settings → Security** to turn on **Two-factor authentication**. Scan the QR code with your authenticator app and enter the 6-digit code.
3. Store the **Recovery codes** in a safe place. They are shown only once, and each code can be used once. **Create new codes** invalidates the old ones.
4. Use **Log out** on shared devices. If misuse is suspected, change the password via **Forgot password** and reset 2FA.

An administrator can reset a user’s 2FA but cannot see the password. A reset deletes the recovery codes and signs out all sessions.

### SSO and SCIM

SSO is configured with `SSO_PROVIDERS` and the `SSO_<SLUG>_*` variables, not in
the interface. Entra ID, Keycloak, Authentik and Zitadel are supported with
OIDC, PKCE, state/nonce and verified email. The redirect URL is
`https://<NEXTAUTH_URL>/api/auth/callback/sso-<slug>`. After a restart,
**Settings → SSO and SCIM** shows the provider status, issuer, default role and
allowed domains. Password sign-in always remains as break-glass.

SCIM 2.0 is served at `/api/scim/v2` with a dedicated Bearer token created,
rotated and revoked in the same tab. `DELETE` deactivates the user without
deleting it, and `ADMIN` requires both an explicit group mapping and
`SCIM_ALLOW_ADMIN=true`. Use one token per integration, and keep at least two
local administrators with strong passwords and 2FA.

## 4. Roles and permissions

| Role | Key | Default content |
| --- | --- | --- |
| **Administrator** | `ADMIN` | All permissions; the list cannot be changed. |
| **Office** | `OFFICE` | Work orders, customers, agreements, equipment, reports, documents, templates, employees and settings in its own department. |
| **Technician** | `TECHNICIAN` | View and create work orders, update status, view customers, agreements and equipment, fill in reports, view documents and templates. |
| **User** | `USER` | No permissions by default. |
| **Customer** | `CUSTOMER` | The customer portal, controlled by the customer link. |

Administrator and Customer are locked. Office and Technician can be edited, but system roles cannot be deleted.

**Custom role:** go to **Settings → Roles & permissions → New role**, enter **Name**, optional **Description**, select **Permissions** and choose **Create role**. The role gets a fixed key based on its name; the key does not change if the display name changes. A role in use cannot be deleted until its users are moved.

**Per user:** open **Permissions for this user**, select the list and choose **Save permissions**. The list overrides the role completely; if it matches the role’s list, the override is removed. **Use the role's permissions** does the same. Customisation does not apply to administrators or portal users, and changing a role clears the list.

The permission groups are **Work orders** (`workorders.*`, `dispatch.configure`), **Customers and equipment** (`customers.*`, `equipment.*`), **Agreements and SLA** (`contracts.*`, `sla.manage`), **Reports and documents** (`reports.*`, `documents.*`) and **Administration** (`templates.*`, `users.*`, `settings.manage`, `audit.view`).

**Test a role:** use a dedicated account, try a direct URL it should not have (for example `/innstillinger?tab=roller`) and one mutation, confirm both are rejected, then deactivate. Authorisation is enforced on the server; hidden buttons are not security.

**Common mistakes:** giving a broad role to everyone, forgetting a per-user override, deleting a system role or a role in use, and giving Office `settings.manage` when it is not intended.

## 5. Customers and customer portal users

Customers are created under **Customers → New customer**. The customer card has **Overview**, **Work orders**, **Agreements**, **Equipment** and **More**. Portal users are created under **More → Portal users**.

**Create a portal user:**

1. Create the customer and at least one **Contact** with an email address.
2. Go to **More → Portal users**.
3. Enter **Name**, **Email** and choose **Contact**.
4. Select **Create and send invitation**.
5. Send the link manually if the email fails.
6. Select **Activate** after the user has chosen a password.

The user receives the `CUSTOMER` role, a customer link and a contact link, and remains inactive until you activate the account. **New link** only works for inactive accounts.

The portal shows the customer’s own overview, bookings, reports, documents, equipment, agreements, visits, messages and contact details. Reports appear only when submitted and locked; documents only when shared with the customer (`CUSTOMER`-owned).

Portal users never see other customers, internal notes, internal permissions, drafts or unlocked reports. `/uploads/...` is checked per file, and PDF responses are `no-store`.

**Security:** use separate accounts per person. **Deactivate** when someone leaves; this signs them out, clears the calendar subscription and revokes portal access. Deleting the customer deactivates all portal users, invalidates sessions and closes booking. After restoring, each portal user must be activated again. A portal user must always have a valid contact on the same customer.

**Delegation:** the portal has server-enforced capabilities for booking, documents, agreements and equipment, but 0.8.9 has no form for editing them. A contact without a delegation row gets full portal access; restricted access must be configured and tested with the actual account.

## 6. Checklists and templates

**Create a template:**

1. Go to **Settings → Checklists / Templates**.
2. Select **+ Create**, enter **Checklist name** and choose **Category**.
3. Select **Edit**, add fields under **Add a new checkpoint**, and set **Required field** where needed.
4. Use **Move up**/**Move down**, then select **Save template with logic**.

Field types are **Short text**, **Long text** (Markdown), **Checkbox**, **Dropdown**, **Condition + comment** (OK/Deviation/To be fixed/Not applicable), **Number**, **Signature**, **Image upload** and **Date**.

**Required and conditional:** required fields must be answered before submission. **Condition (If This Then That)** shows a field only when another field has a specific value, for example `Deviation`. **A comment is required for these options** applies to condition fields; the default is `Deviation` and `To be fixed`. Clear it to never require one.

**Units and report name:** **Link the report to equipment units** is on by default and gives one assessment per unit. Turn it off for reports that concern the whole work order. **Report name** appears in the PDF and report lists; an empty field uses the template name.

**Category and HMS:** **Service** or **HMS form**. HMS requires an **HMS type**: general, SJA, hot work, internal control, deviation, safety round or written instruction. Category and HMS type are frozen at submission.

**Linking and versioning:** templates can be linked to work orders, service agreements and maintenance plans. At submission, a snapshot of the template, report name, unit requirement, category and HMS type is stored. Later changes do not affect existing reports, even when unlocked; new fields apply only to new reports.

**Delete a template:** administrator only. A template cannot be deleted while it is used by reports, work orders or active agreements. A blocked attempt is logged.


### HMS library and QR labels

The **HMS library** is at `/hms`. It groups HMS forms by type and lists templates
and completed HMS documentation. **Link HMS form to work order** chooses a form
and an active work order; the form is added to the work order and completed
there. HMS templates are managed under **Settings → Checklists / Templates**
with category **HMS form**.

**QR label:** open the unit at `/enheter/<id>`, go to **QR label** and use
**Rotate QR token** if the label is lost or shared. Print the label from
`/enheter/<id>/etikett`. A rotated token invalidates the old label.

## 7. Work orders and reports

The statuses are **Open / New** (`OPEN`), **Waiting for planning** (`PENDING`, the system start status), **Planned** (`PLANNED`), **Waiting for customer** (`WAITING`), **In progress** (`IN_PROGRESS`), **Completed** (`COMPLETED`) and **Cancelled** (`CANCELLED`).

Office and technicians with `workorders.update` can change open statuses freely. Completed and cancelled are closed; only an administrator can reopen them, with a reason. Cancellation requires `workorders.edit`. The report has its own lock and is not affected by the work order status.

**Unlock a report:** open the work order, find the checklist, select **Unlock for correction**, enter **Reason for unlocking** and confirm. The report becomes **Unlocked**, can be edited, and a revision of the previous version is stored. The customer’s acknowledgement is withdrawn. On resubmission, the report is locked automatically and gets a new revision. Legal hold blocks unlocking.

**Revisions:** every unlock and submission creates a revision that freezes the form, units, comments, signatures, report number, category, HMS type and acknowledgement. **Revisions** shows the content and lets you download it as a PDF.

**Report numbers:** HMS reports receive an automatic `abc1234` number (three lowercase letters and four digits) on first submission. It is kept across revisions. Ordinary service reports have no automatic number.

**PDF and branding:** the PDF uses the company name, logo and primary colour from **Branding**, is stored as a `WORK_ORDER` upload and requires `reports.view`. The response is `no-store`. Branding is part of the PDF hash, so changes apply next time the PDF is generated. Report PDF labels are Norwegian in 0.8.9; agreement PDFs support all four languages. The generated remediation work order title is also Norwegian (“Utbedring av avvik – …”) in 0.8.9.

**Legal hold and retention:** legal hold prevents hard deletion and freezes the report. On a work order, all reports inherit the flag. Releasing it requires a reason and does not release the reports’ own flags; **Report hold** must be released per report with its own reason. Soft-deleted work orders can be hard-deleted after `RETENTION_DAYS` (default 365) only when they have no reports. **Recycle bin** and **Restore** are administrator-only.

## 8. Service agreements, SLA and price lists

**SLA policy:** go to **Settings → SLA and business hours**, enter **Name**, **Department** or **All departments**, **Response time (minutes)**, **Resolution time (minutes)** and **Count business hours only**, then select **Create policy**. The work order’s agreement can point to a policy; otherwise an active customer agreement is used, then the department default and finally the global policy. The clock starts at creation, response is recorded on `EN_ROUTE`/`ON_SITE`, resolution on `DONE`/`COMPLETED`, and `CANCELLED` cancels it. States: `ON_TRACK`, `AT_RISK`, `BREACHED`, `MET`, `CANCELLED`.

**Business hours and holidays:** choose **Department**, select **Show**, set **Opens**/**Closes** or **Closed** per weekday, and select **Save business hours**. Add **Holidays** with date, name and optional department. Global holidays apply to all; department-specific rows override only that department. Without business hours, weekdays 08–16 in Europe/Oslo are used. All deadlines are calculated through this calendar.

**Service agreement:** create it from the customer card, **Agreements** tab, or via **Agreements**. Enter **Title**, **Start date**, **Interval** (3, 6, 12 or 24 months), optional **Contact**, **Checklist** and **Department**, then select **Create service agreement**. The agreement becomes **Active** (or **Draft** if selected) with a next service date. A start date today creates the first work order immediately; a past date uses the next future interval. Each interval creates a work order with customer data, a checklist and the previous report as a PDF.

**Coverage:** an agreement without lines covers all equipment. A line without a product also covers all; a line with a product covers only that product. A line can have **Coverage**, **Visits/year**, **Response (min)** and **Resolution (min)**.

**Renewal:** **Automatic** renews after the end date and generates a new work order. **Manual** becomes **Expired** after the end date. **Notice (days)** controls the expiry notice. Automatic renewal runs exactly once even with multiple instances.

**Price lists:** create them under **SLA and business hours → Price lists** with **Code**, **Description**, **Unit** and **Amount**. They are reference data for agreement PDFs and settings; the system never calculates, invoices or exports amounts.

## 9. Booking, SMS, tracking and reviews

**Booking:** the customer chooses a requested date (up to 60 days ahead) and writes the desired time in the description; the customer cannot select a time block. The request creates a new work order with status **Open/New** and no visit or confirmed time. The office or technician plans it and sets **Planned**, or **Waiting** if the time does not fit. **Bookings** shows unconfirmed requests; they can be declined, but planning happens on the work order.

**SMS:** the provider is selected with `SMS_PROVIDER`, not in the UI. The default `console` is a dry run; `linkmobility`, `pswincom` and `twilio` are supported. **Sender** comes from `SMS_SENDER_ID`. Under **Settings → SMS and messaging** you can see the provider, sender, dry-run state and **Webhook signature**, and set **Default language**, **Opt-out keywords**, **Opt-in keywords**, **Monthly cap** and **Templates per event**.

SMS is sent only when the recipient has `optedIn = true` and `optedOut = false`. STOP/START is enforced from the keywords, and consent is checked when queuing and before sending. `SMS_ALLOWLIST` can restrict test and staging. The webhook at `/api/webhooks/sms/<provider>` requires an HMAC or Twilio signature; without `SMS_WEBHOOK_SECRET`, deliveries are rejected (except console in development). Outgoing SMS is a queue with three attempts; provider delivery status updates **Sent**, **Delivered** or **Failed** in the same conversation without creating a new message. Conversations appear under **Messages**.

**Reminders:** under **Settings → SMS → Automatic reminders** you create rules per department. A rule has a **Channel** (SMS, email or both), **Hours before visit** (for example 24 or 2), **SMS template**, **Quiet hours**, **Time zone** and **Maximum reminders per visit**. The worker sweeps every five minutes, skips customers without consent, respects quiet hours, and cancels the reminder if the visit is moved, cancelled or completed. **Recent reminders** shows planned, sent and skipped rows with a reason — without message text or phone numbers. Sending happens in the background, so a slow SMTP or SMS provider never blocks a page.

**Tracking:** off by default per department. Enable it under **Departments → Edit department → Enable live tracking** after a DPIA, because the technician’s location is personal data. An assigned technician can share location while the visit is `EN_ROUTE`. The public link shows only first name, status, ETA, planned time and last updated — never coordinates, a map or history. Pings are kept for 24 hours and deleted on `DONE`/`CANCELLED`; the link expires two hours after the visit, and there is one active link per visit. `TRACKING_AVERAGE_SPEED_KMH` (default 50) controls the fallback estimate. With `OSRM_BASE_URL`, an external routing provider is used for ETA; without it, ETA is calculated locally. A ping older than ten minutes is shown as **last known position**, not as live. The public ETA endpoint is polled every 30 seconds and has its own per-token rate limit.

**Reviews:** internal and never published. The customer can request a review in the portal after a completed visit, or the office can send an SMS with “Request review”. A review requires a completed visit, can be submitted once and is stored with a hashed token. Reviews are not shown as a separate dashboard in 0.8.9.

## 10. Branding, map, language and notifications

**Dispatch and workforce:** under **Settings → Dispatch**, configure **Assignment rules** (weights for skills, distance, travel time, availability, SLA and load) and **Territories**. Weights are relative. **Capacity plans** are shown under **Calendar → Capacity** but are not edited in **Settings** in 0.8.9. Skills, absence and working hours feed the suggestions but also have no separate form in **Settings**; keep the data updated outside the interface.

**Branding:** under **Settings → Branding**, set **Company name**, **Primary colour (hex code)** and **Company logo (optional)**. The logo must be uploaded through the app; external URLs are rejected. It is used in reports, email and the dashboard header, and applies to office and customer portal, not the dark field app. Customers can have their own colour and logo in the portal.

**Map and geocoding:** under **Settings → Map**, choose a **Map provider**. **OpenStreetMap (no key)** is the default; **MapTiler** and **Mapbox** require an **API key**. The key is stored on the server and sent only to the map in the browser; use a domain-restricted key. Set **Default layer**, **Default zoom (2–19)**, **Center** and **Enable scroll wheel zoom**. Geocoding is on by default (`GEOCODE_ENABLED=true`) and tries OpenStreetMap/Nominatim, then Kartverket and Photon. Set `GEOCODE_USER_AGENT` to identify the installation, or disable with `GEOCODE_ENABLED=false`. The **Geocode addresses** button on the map reports whether no address was found, the service did not respond, or geocoding is disabled.

**Language:** Norwegian, English, Polish and German have complete catalogues. The top-bar selector stores the `NEXT_LOCALE` cookie and uses `router.refresh()`, without a URL prefix. Dates and numbers follow `nb-NO`, `en-GB`, `pl-PL` and `de-DE`. SMS uses the recipient contact’s `locale`; email notifications use the user’s `locale`. Reports have Norwegian PDF labels in 0.8.9; translations live in `messages/` and are checked with `npm run check:i18n`.

**Notifications:** in-app and email. Each user chooses events and channels under **Notifications → Settings**; there is no global default. Make sure SMTP is configured. The `Notification` queue retries five times with backoff, skips deactivated users and uses a lease (a time-limited lock) to prevent double sending. Types include assignment, date change, cancellation, report ready, booking, agreement, overdue, contact update, SLA and warranty.

**Messages:** **Messages** collects customer conversations. Threads are scoped to a department or customer; office users see their own departments, portal users only their own threads. Outgoing messages can be sent as SMS with consent; incoming SMS lands in the same thread and is idempotent per provider ID.

## 11. API keys and the REST API

The API is under `/api/v1` and uses Bearer keys prefixed `fsm_`. NextAuth cookies are never accepted.

**Create a key:** go to **Settings → API keys**, enter **Name** and optional **Expires (optional)**, select **Create key**, copy the key into a secret manager and select **I have saved the key**.

The key is shown only once. The server stores only a SHA-256 hash and a short display prefix. If you lose it, revoke it and create a new one.

The API has no separate scopes. A key inherits exactly the owner’s permissions, department and customer scope. Role and permission changes also apply to the key; a deactivated user gets `401`. **Important:** in the UI, the key is created for the signed-in administrator and therefore gets all administrator permissions. Treat it as an administrator secret. For lower privilege, create a dedicated active integration user with a narrow role and use `scripts/create-api-key.mjs` with `API_KEY_USER_EMAIL`, `API_KEY_NAME` and optionally `API_KEY_EXPIRES_AT`.

**Revoke** takes effect immediately and returns `401`. Expired keys also return `401`. The list shows **Owner**, **Created**, **Last used**, **Expires** and status **Active**, **Expired** or **Revoked**.

Each key can make **120 requests per minute**; exceeding the limit returns `429` with `Retry-After`. Pagination uses `page` and `limit` (maximum 100). OpenAPI 3.1 is at `/api/v1/openapi.json`; documentation with examples is in `docs/API.md`.

**Safe use:** use HTTPS, one key per integration, an expiry date, a secret manager and **Last used**. To rotate: create a new key, deploy it, verify with `GET /me`, then revoke the old one. On suspected leakage, revoke first, create a new key and review the activity log.

## 12. Activity log, privacy and data

**Activity log:** **Settings → Activity log** shows system events, security events such as failed 2FA attempts, and user activity with search, **From date** and **To date**, 50 rows per page. Work orders and customers have their own activity tabs; reports have revisions. The log is written in the same transaction as the mutation, cannot be edited or deleted in the UI, and is not hash-chained in 0.8.9.

**Privacy:** collect only necessary data, use department and customer scope, and grant `reports.viewAllDepartments` only when needed. Use separate portal accounts and deactivate them on leaving. Assess DPIA before tracking in a new department; tracking is opt-in, limited to `EN_ROUTE`, shows no route or coordinates and deletes pings after 24 hours. Obtain SMS consent and keep reviews internal. Deleting a customer deactivates portal users.

**Export:** there is no automatic export job or self-service GDPR export. Evidence is exported through the database backup or an administrator-controlled query against `WorkOrder`, `Report`, `ReportRevision` and `AuditLog` for one work order at a time. Never export reports from the client or a public route.

**Retention:** `RETENTION_DAYS` (default 365) controls hard deletion of soft-deleted work orders without reports. Work orders with reports are kept indefinitely. Legal hold stops all automatic deletion. Files are removed only when no rows reference them.

**Backup and upgrade:** take a backup before migration and rollback. Follow `docs/OPERATIONS.md`, use `scripts/backup.sh` and `scripts/restore-test.sh`. In production, set `REQUIRE_BACKUP_BEFORE_MIGRATE=true` so the app refuses to migrate without `BACKUP_CONFIRMED=true`. That only confirms a backup was taken, not that it is good; run the restore test first. Restore database and uploads from the same timestamp, stop the app before switching databases, use `prisma migrate deploy` and never `prisma db push`. Pin `APP_IMAGE` to a published version or digest, not `latest`, and never run `docker system prune --volumes`.

## 13. Operations and health

`GET /api/health` is liveness and returns 200 when the Node process is alive, without database, disk or queue calls; Docker uses it so a slow database does not cause a restart loop. `GET /api/ready` is readiness: unauthenticated calls get a short status and a database check, rate-limited per IP. With `READY_SECRET` or `CRON_SECRET`, the upload volume and job queue are also checked; it returns 503 when something is missing. Production Compose uses readiness but does not restart on `unhealthy`; a database outage gives 503 from the proxy. Both return `requestId`.

**Migrations:** the app runs `prisma migrate deploy` at startup. `DATABASE_MIGRATION_URL` can be used for a DDL role, `DATABASE_RUNTIME_URL` for the app. To run migrations separately, start with `SKIP_MIGRATIONS=true` and run them manually. Verify with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.

**Jobs:** `RECURRING_SCHEDULER=true` runs service agreements and maintenance plans every six hours and at startup. `POST /api/cron/recurring` and `/api/cron/cleanup` require `Authorization: Bearer <CRON_SECRET>`. `PDF_JOB_WORKER` controls OCR/document jobs with at most two concurrent jobs per instance; report PDFs render in-process with a separate concurrency limit. `SMS_WORKER` is independent.

**Uploads and OCR:** files are stored in `UPLOAD_DIR` (default `./uploads`, `/app/uploads` in Docker). `/uploads/...` requires sign-in and checks the `Upload` row. Limits are 15 MB for images and 50 MB for PDFs. A rolling 24-hour quota of 2 GiB per user and 10 GiB total storage per customer also applies. Adjust it with `UPLOAD_QUOTA_USER_MB` and `UPLOAD_QUOTA_CUSTOMER_MB`; the proxy still needs its own body limit (55 MB in the Caddy example). Over quota the user gets a clear error, and the upload is not written. OCR uses `TESSDATA_DIR` and `/tmp`; large PDFs can fill `/tmp`, and the job then fails without filling the root filesystem. Check `DocumentJob`, `PDF_JOB_WORKER` and disk.

**Environment variables:** the most important are `DATABASE_URL`, `NEXTAUTH_URL`, `APP_URL`, `NEXTAUTH_SECRET`, `SMTP_*`, `SMS_*`, `SSO_*`, `SCIM_*`, `PDF_JOB_WORKER`, `RECURRING_SCHEDULER`, `CRON_SECRET`, `READY_SECRET`, `RETENTION_DAYS`, `UPLOAD_*`, `TESSDATA_DIR`, `GEOCODE_*`, `ROUTING_*`, `TRACKING_AVERAGE_SPEED_KMH`, `TRUST_PROXY` and `BACKUP_*`. `.env` must be `chmod 600` and never shared; changes require a new deploy or restart.

**Before escalating:** is `/api/health` 200 and `/api/ready` 200/503? Is `app` `healthy`, and is `RestartCount` increasing? What do the logs say? Does Postgres respond? Is there free disk and a writable upload volume? Are `DocumentJob`, `Notification` or `SmsMessage` stuck? Include `requestId`, timestamp and error message, never secrets or personal data.

## 14. Administrator routines

**Onboard a department:** create it, enter contact details, set business hours and holidays, create a default SLA policy and optional price list, leave tracking off until DPIA is assessed, and create employees.

**Onboard a user:** create with the right role and department, send the invitation, let the user set a password, activate, ask for 2FA, and test that the user sees the right work orders and not other departments.

**Customer and portal user:** create the customer, add a contact with email, create the portal user under **More → Portal users**, send the invitation, activate and test the portal. Deactivate the test account afterwards.

**Publish a template:** build it, set the report name, unit requirement and HMS type, test on an internal work order, check the PDF, **A comment is required for these options** and conditional fields, then link it to agreements or work orders. Inform office and technicians.

**Launch an agreement and SLA:** choose or create a policy, check business hours and holidays, create any price list, create the agreement with the right interval and checklist, add lines and coverage, set renewal and notice, activate and check the next service date and SLA clock.

**Rotate an API key:** create a new key with a clear name, store it in the secret manager, deploy it, verify with `GET /api/v1/me`, revoke the old key, confirm it returns `401`, and update the documentation.

**Monthly review:** review administrators, employees, roles and departments. Review API keys, **Last used** and expiry. Review the **Activity log** for deletions, role changes, unlocks and legal hold. Check 2FA, portal users and unlocked reports. Run `scripts/restore-test.sh` and check disk, `/api/ready`, `RestartCount` and pending migrations.

## 15. Common problems

| Symptom | Cause | Action |
| --- | --- | --- |
| User cannot sign in | Inactive, missing password or deactivated. | Activate, send a new invitation, or use **Forgot password**. |
| Customer portal is empty | Portal user inactive, customer deleted or contact missing. | Activate, restore and link a valid contact. |
| Template is missing, or changes do not apply | Wrong category/permission, or the report has a frozen template snapshot. | Check category and `templates.view`; create a new report for new fields. |
| Report cannot be unlocked | Legal hold or missing administrator. | Release the hold with a reason, or use an administrator. |
| SMS is not sent | `console`, missing consent, allowlist or cap. | Set the provider, record consent, check the cap. |
| SMS webhook rejects | `SMS_WEBHOOK_SECRET` missing or signature wrong. | Set the secret and check the signature. |
| Upload is rejected by quota | User or customer quota reached, or the proxy rejects the body. | Check `UPLOAD_QUOTA_*`, disk and the proxy body limit; remove unused attachments. |
| Unit cannot be moved | Active contract lines, number conflict or cross-customer reference. | Clear the contract lines, choose another order number, or check the preview. |
| SLA has the wrong deadline | Wrong policy, business hours or holiday. | Check the policy, department and calendar. |
| API returns `401`/`403`/`429` | Expired key, missing permission or rate limit. | Create a new key, grant permission, or wait for `Retry-After`. |
| `/api/ready` returns 503 | Database, upload volume or job queue. | Check Postgres, `UPLOAD_DIR`, disk and queue. |
| App restarts in a loop | Migration gate, OOM or `.env` error. | Check logs, `dmesg` and `REQUIRE_BACKUP_BEFORE_MIGRATE`. |

## 16. Relationship to the office and technician chapters

The administrator chapter covers setup and governance; the office and technician chapters cover daily use. **Department and role** determine which work orders and actions staff see; the customer portal is controlled by the customer link. **Templates, SLA, branding and SMS** provide the forms, deadlines and messages staff work with. **Legal hold** freezes data for all parties.

See `10-office.md` for customer cards, work orders, agreements, the booking queue and reports. See `20-technician.md` for the field app, offline drafts, forms, submission and tracking. See `90-reference.md` for concepts, error codes and reference material.
