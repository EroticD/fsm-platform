# Introduction and system overview

*Applies to FSM Platform version 0.9.0, 8 November 2026.*

## What FSM Platform is

FSM Platform is a service and maintenance system for work carried out at the customer's site: service, maintenance, inspection and repair. It brings planning, work orders, visits, checklists, reports, equipment, service contracts, documents and the customer portal together in one service.

The platform is designed so that the office can plan without parallel spreadsheets, the technician can work from a phone or tablet even with a poor connection, and the customer can see contracts, visits, reports and equipment without calling the office. The core documents and plans work and records time and travel per workday. Quotes, invoicing, payments, accounting sync, inventory, expenses and profitability are optional modules that an administrator must enable. Without those modules, price lists and contract amounts are reference data and invoicing happens outside the platform.

### The four roles

This manual uses four standard roles. An administrator can create custom roles and give individual users tailored permissions, but day-to-day work generally follows these four.

| Role | Who | Main task | They see |
| --- | --- | --- | --- |
| **Administrator** | System or operations manager | Sets up departments, roles, templates, branding, API access and security | Everything, across all departments |
| **Office** | Service manager, planner or case handler | Plans and dispatches work, follows up customers, contracts, bookings and reports | Own department for work orders, contracts and reports; customers, equipment and documents are shared |
| **Technician** | Field service technician | Carries out visits, completes checklists, takes photos and signs | Own department for work orders and reports; customers, equipment and documents are available |
| **Customer portal user** | Customer or contact | Books service, follows visits, reads reports and views their own equipment | Their own customer, with the portal access granted |

> **Note:** "Office" is a role, not a physical place. A service manager can work from a phone and still have the office role.

## What's new in 0.9.0

- **Quotes, invoices and payment links.** Quotes have versions, printing and a
  one-time approval link. Invoices have partial payments, credit notes,
  overdue handling and CSV. The customer can pay with Stripe Checkout or Vipps
  MobilePay where the provider is configured. See
  [quotes and invoicing](40-quotes-invoicing.md).
- **Accounting sync.** Sent invoices can be synced manually to Fiken, Tripletex
  or PowerOffice Go, with CSV as an explicit export fallback. Sync is
  idempotent and audit-logged. See [accounting](40-quotes-invoicing.md).
- **Inventory, suppliers and purchasing.** Item list, locations, stock,
  reservations, consumption, supplier register, purchase orders and goods
  receipt. See [inventory](10-office.md).
- **Mileage, expenses and payroll basis.** The technician records mileage and
  expenses with receipts; the office approves and exports a locked payroll CSV
  per period. See [expenses](10-office.md).
- **Profitability.** Estimated and actual revenue, time, first-time fix and
  utilisation by department, customer and technician, with CSV export. See
  [profitability](10-office.md).
- **Automatic email and push.** Transactional email uses a durable outbox with
  retry, per-event switches and test send. Push uses FCM and APNs with deep
  links and device registration. See [administrator](30-administrator.md) and
  [technician](20-technician.md).
- **Routing with traffic and overtime.** Routing uses OpenStreetMap/OSRM, with
  optional Google Routes API for traffic-aware ETA. Visits that cannot meet the
  time window are planned as overtime instead of staying unassigned. See
  [route plan](10-office.md).
- **Manual order.** Both the route planner and **Days and time** on the work
  order have number fields 1/2/3/4. Manual order overrides automatic
  optimisation and is audited per visit.
- **SAML 2.0, SCIM groups and field-level RBAC.** SAML can be used alongside or
  instead of OIDC. SCIM Groups grant role and department through explicit
  mapping. Sensitive fields are masked on the server for technicians and the
  customer portal. See [SSO and SCIM](31-sso-scim.md).
- **API for quotes, external orders and inventory.** `/api/v1/quotes`,
  `/api/v1/orders` and `/api/v1/inventory/**` have dedicated scopes. External
  order systems use `source` + `externalId` and `Idempotency-Key`, and receive
  the same order on replay. See [administrator](30-administrator.md).
- **S3, Redis and HA/PITR.** Uploads can live in S3/MinIO, the job queue and
  rate limits can use Redis, and the HA profile has multiple app replicas, WAL
  archiving and tested PITR restore. See [administrator](30-administrator.md).
- **Compliance.** The ISO/IEC 27001 and SOC 2 package is a **readiness basis**,
  not a certification or audit report. See [administrator](30-administrator.md).

## How the system is put together

You meet the system through a few surfaces. They share data and permission checks but are adapted to different tasks.

| Surface | What you do there |
| --- | --- |
| **Browser and PWA** | Opens the system on a PC, tablet or phone. The field surface can be installed as an app and used with limited connectivity. |
| **Office surface** | Plans in lists, boards, calendars and dispatch. Handles customers, contracts, bookings, reports and settings. |
| **Field surface** | Shows today's jobs, the next action, map links, checklists, photos and signatures, with large touch targets and a dark theme. |
| **Customer portal** | Gives the customer an overview of their own bookings, reports, documents, equipment, contracts, visits and messages. |
| **REST API** | Lets other systems read and write data with a dedicated API key and the same permission checks. |

Behind the surfaces is a shared application that enforces workflow and access. It is built with Next.js and React, using Prisma against PostgreSQL as the source of truth. The field app is a PWA with a service worker and IndexedDB for offline drafts. PDFs and uploaded files live in a separate file volume. Report PDFs render in-process with a concurrency limit; OCR and document jobs run through a job queue.

| Layer | Content |
| --- | --- |
| **User surfaces** | Customer portal, office surface, field surface and REST API clients in a browser or installed PWA. |
| **Application** | Access control, workflow, notifications, search and PDF rendering. |
| **Data and jobs** | PostgreSQL with data, revisions and audit log; file volume for PDFs and images; job queue for OCR, document jobs and notifications; email/SMS where configured. |

### Modules

The platform has a core and a catalogue of modules that can be switched on and
off under **Settings → Modules**. The core (customers, work orders, workdays,
time, revisions and settings) works without optional modules. A module may have
dependencies, and the module guard returns `404` for pages and APIs when the
module is off.

| Module | Key | Provides |
| --- | --- | --- |
| **Quotes** | `quotes` | Quotes, versions, approval link and conversion to work order |
| **Invoicing** | `invoicing` | Invoice, payment, credit note, overdue and CSV |
| **Inventory** | `inventory` | Items, locations, stock, reservations and purchasing |
| **Expenses** | `fieldExpenses` | Mileage, expenses and payroll CSV |
| **Profitability** | `bi` | Estimated and actual revenue, time and CSV |
| **Customer portal** | `portal` | The customer's own surface |
| **API** | `api` | The REST API under `/api/v1` |

Existing installations get every delivered module enabled. Turning a module off
removes navigation, settings, search hits and background jobs for that area, but
keeps the data. Turn it on again to restore access.

The field surface also has a local buffer in the browser:

1. **Offline:** the form is stored in IndexedDB as a draft and outbox item.
2. **Online:** the draft is sent to the server, which confirms receipt.
3. **Always:** the server decides whether a report has actually been received; "sent" appears only after confirmation.

A draft can be saved locally, but a submitted report is not considered sent until the server confirms it. This is why the field surface shows "draft saved locally" and "waiting to send" as two different states.

### Core entities

| Entity | What it is | Key relationships |
| --- | --- | --- |
| **Department** | Organisational unit that determines who sees what | Staff, work orders, customers, contracts, business hours |
| **User and role** | Employee or customer portal user with permissions | Department, customer, contact, API keys |
| **Customer** | The company receiving service | Contacts, sites, equipment, contracts, work orders |
| **Contact** | The person the office and technician deal with | Customer, work orders, contracts, portal user |
| **Site** | Physical address or facility at the customer | Customer, work orders, equipment, bookings |
| **Equipment/unit** | Machine or system being serviced | Customer, site, meter readings, maintenance plans, history |
| **Work order** | The service job itself, with status and responsibility | Customer, contact, site, equipment, templates, visits, reports |
| **Visit** | Time block within a work order, with technicians and status | Work order, technicians, tracking, meter readings |
| **Checklist template** | Reusable template for service or HMS | Work orders, contracts, reports, maintenance plans |
| **Report, unit and answers** | Completed checklist with units, photos and signatures | Work order, template, equipment, PDF, revisions, acknowledgement |
| **Service contract and SLA** | Agreement for recurring service and deadlines | Customer, department, template, SLA policy, work orders |
| **Booking** | Customer's request or confirmed appointment | Customer, site, equipment, work order, visit, events |
| **Quote** | Price proposal with lines, versions and approval | Customer, contact, work order, contract, equipment |
| **Invoice and payment** | Invoiced amount, payments and credit note | Customer, work order, report, quote |
| **Item and stock** | Spare part with stock per location | Location, reservation, work order |
| **Purchase order** | Supplier order with goods receipt | Supplier, receiving location, item lines |
| **Mileage and expense** | Mileage allowance or expense with receipt | User, work order, approver, payroll CSV |
| **Document** | File in the library or an attachment | Folder, tags, versions, work order, customer, contract |
| **Notification** | Message to a user about an event | User, type, source, link, email status |
| **Audit log** | Traceable history of actions | Entity, actor, time, metadata |
| **API key** | Secret for integrations | User, permissions, expiry, revocation |

## End-to-end flows

The role chapters describe each step in detail. Here you can see how the roles and data fit together.

### 1. Service contract → recurring work order → report → PDF and history

1. **Office or administrator** creates a service contract on the customer card with an interval (3, 6, 12 or 24 months), start and end dates, department, template, optional SLA and renewal mode.
2. **The system** creates a new work order when `Next service` is due. The work order inherits the customer, contact, template and department; the previous report is attached as a PDF.
3. **The office** sees the work order in "Work orders" and "Calendar", creates or checks the visit and assigns a technician.
4. **The technician** completes the checklist per unit, takes photos, comments on deviations and signs if desired. The customer can sign at the same time.
5. **The system** locks the report, saves a revision, generates a PDF and notifies the office and customer portal. If there are deviations, it creates one undated remediation work order.
6. **The customer portal user** sees the submitted report, downloads the PDF and acknowledges receipt. The acknowledgement is visible to the office.
7. **The office** follows up deviations. The equipment on the customer card shows service history from the report's units.

> **Note:** The report is frozen at submission. If the template or equipment changes later, the submitted report keeps the information that applied when it was submitted.

### 2. Customer portal booking → work order and notification → dispatch → technician

1. **The customer portal user** selects a site, service and requested date under "Bookings". The desired time is written in the description; the customer cannot select a time block.
2. **The system** creates a new work order with status `OPEN` and an unconfirmed booking request. No visit or confirmed time is created, and the office is notified.
3. **The office or technician** plans the work order and sets the status to **Planned**, or **Waiting** if the time does not fit. Only then are the date and time confirmed.
4. **The technician** receives an assignment notification and sees the visit under "Today". Cancellation triggers a new notification.

> **Tip:** A customer booking is a request, not a confirmed appointment. The office must plan it before the customer gets a final time.

### 3. Office creates a work order → calendar, board and assignment → field

1. **The office** selects "New work order" and enters a title, customer, contact, site, date, template and optionally tags and technician.
2. **The system** creates the work order and a visit in the same transaction when a date is set. New work orders start as `PENDING`; undated work orders have no visit.
3. **The office** distributes the work through "Assign technician", the calendar, the dashboard board or dispatch with suggestions and automatic assignment.
4. **The technician** sees the work order under "Today" or "Work orders" and can claim available work with "Take work order" if the role allows it.
5. **The technician** starts driving, marks "On site", completes the form and finishes. Status, comments and the report flow back to the office.
6. **The office** follows up overdue work orders, deviations, missing signatures and reports that have not been acknowledged.

> **Note:** On the board, a drop assigns a technician; it does not move the date. Date and time are changed in the calendar or in the visit details.

### 4. Tracking and reviews → customer portal and office follow-up

1. **The administrator** enables live tracking for the department. It is off by default and applies only to visits in that department.
2. **The technician** sets the visit to "On the way" and can share position. The customer opens the tracking link from "Visits" or receives it separately.
3. **The customer portal user** sees the first name, status and estimated arrival. The position is never shown as a map or coordinates, and the link expires when the visit is finished or after two hours.
4. **The customer** can leave an internal review after the visit is completed. Reviews are internal and never published; they are not shown as a separate dashboard in 0.9.0.

### 5. Permissions, notifications and audit across all flows

1. **Every** action is authorised on the server. Staff see their own work orders, contracts and reports, while customers, equipment and documents are shared. Administrators see everything, and customer portal users see only their own customer and granted portal areas.
2. **The system** notifies on assignment, date change, cancellation, completed report, booking, contract due, overdue work orders, SLA events and contact requests. Notifications go to the bell, "Notifications" and optionally email.
3. **The audit log** records who created, changed, moved, cancelled, deleted, unlocked or applied a legal hold, with time and actor. The log cannot be edited.
4. **The administrator** can change roles and permissions. Old sessions are rejected, and API keys inherit the user's current permissions.
5. **Legal hold** prevents deletion and changes. A submitted report can only be unlocked by an administrator, with a reason, and the unlock is logged.

## Navigation by role

The menu is adapted to role and permissions, so you will not necessarily see every item.

| Role | Home | Main menu | Hamburger menu and settings |
| --- | --- | --- | --- |
| **Administrator** | "Dashboard" | Dashboard, Work orders, Calendar, Customers, Messages, Reports | Bookings, Contracts, Units, Search, HMS, Documents, Map, New work order, Notifications, Quotes, Invoices, Inventory, Expenses, Profitability, Settings |
| **Office** | "Dashboard" | Dashboard, Work orders, Calendar, Customers, Messages, Reports | Bookings, Contracts, Units, Search, HMS, Documents, Map, New work order, Notifications, Quotes, Invoices, Inventory, Expenses, Profitability, Settings |
| **Technician** | "Today" | Today, Work orders, Calendar, Customers, Messages | Reports, Bookings, Contracts, Units, Search, HMS, Documents, Map, New work order, Notifications, Customers & equipment, Settings |
| **Customer portal user** | "Customer portal" | Overview, Bookings, Reports, Documents, Equipment, Contracts, Visits, Messages, Contact | Account & security |

On mobile, the bottom bar shows the most important areas: "Dashboard", "Work orders" and "Calendar" for office and administrator, and "Today", "Work orders" and "Notifications" for technicians. "More" opens the rest.

### Where do I find …?

| What you are looking for | Go to |
| --- | --- |
| Today's work and overdue work orders | "Dashboard" for the office, "Today" for the technician |
| Planning or moving a visit | "Calendar" or the work order's visit section |
| Assigning technicians quickly | "Dashboard" → board, "Calendar" → Dispatch, or "Assign technician" |
| Customers, contacts and portal users | "Customers" → customer card |
| Equipment and service history | "Units" or the customer card → "Equipment" |
| Service contracts and next service | "Contracts" or the customer card → "Contracts" |
| Bookings from the customer portal | "Bookings" |
| Reports and PDFs | "Reports", or the work order → "Checklists" |
| Checklists and HMS templates | "Settings" → "Checklists / Templates", or "HMS" |
| Documents, folders and tags | "Documents" |
| Notifications and notification settings | The bell at the top, or "Notifications" → "Settings" |
| Audit log for one work order | The work order → "Activity log" |
| Global audit log | "Settings" → "Activity log" (administrator) |
| Employees, roles and permissions | "Settings" → "Employees & Roles" or "Roles & permissions" |
| API keys | "Settings" → "API keys" (administrator) |
| Quotes and approval links | "Quotes" |
| Invoices, payments and credit notes | "Invoices" |
| Spare parts, stock and purchasing | "Inventory" |
| Mileage and expenses for approval | "Expenses" → "Office" |
| Revenue, time and profitability | "Profitability" |
| Automatic email and push | "Settings" → "Automatic email" / "Push notifications" |
| Anything across customers and work orders | "Search" |

## How to use this manual

The manual has an introduction, three role chapters, a chapter on SSO and SCIM, a chapter on quotes, invoicing and accounting and a reference section. You do not need to read everything in order. Start with your role, and use the reference section when you need a term, a status or a troubleshooting check.

- **Role chapters:** Part 1 for office, Part 2 for technician and Part 3 for administrator. The customer portal is described alongside the customer card and the roles that administer it.
- **Specialist chapters:** [SSO and SCIM](31-sso-scim.md) and [quotes, invoicing and accounting](40-quotes-invoicing.md) cut across the roles.
- **Reference:** the reference part contains the status glossary, permission matrix, terms and troubleshooting.

### Conventions

- Buttons, tabs, menu items and field names appear in "quotes", as they appear in the interface.
- Paths, file names, codes and technical values appear in `monospace`.
- Menu paths are shown as **Settings → API keys**.
- **Note** explains something that is easy to misunderstand. **Tip** is a shortcut or good practice. **Warning** means the action can lead to data loss or errors.
- Dates and times are shown in Europe/Oslo with a 24-hour clock. "Today" means the day in that time zone.
- When a time or date is missing, the system shows "Time not set" or "No date". That does not mean the value is midnight or that the job has been forgotten.
- Service report PDFs use Norwegian labels in 0.9.0, even when the interface is in English. Contract PDFs can be generated in the selected language.

> **Warning:** A submitted and locked report should not be changed without a good reason. Unlocking requires an administrator and a reason, and every change is recorded in the audit log.

On first sign-in you arrive at your role's home surface. Check the department, notification settings and any 2FA. Technicians should install the field surface as an app, so drafts and recent data are available even with an unstable connection.
