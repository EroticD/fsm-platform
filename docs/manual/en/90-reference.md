# Reference, glossary and troubleshooting

*Applies to FSM Platform version 0.9.6, 13 November 2026.*

This chapter is the reference section. It explains permissions, statuses and terms across roles, shows how features connect, and helps you find where to look when something is missing.

## Roles and permissions in practice

Permissions have more levels than "yes" and "no". **Full** means view, create, edit and administer. **Own department** means the role acts within its own department for areas that are department-scoped. **Own customer** means the portal user only sees their own customer. **No** means the area is not available.

| Area | Administrator | Office | Technician | Customer portal user |
| --- | --- | --- | --- | --- |
| **Work orders and visits** | Full, all departments | View, create, edit, assign and change status in own department | View own department, create their own work orders, claim available work orders, change status and add/remove people | View their own visits |
| **Customers and contacts** | Full | Administer; customers are shared | View | View their own customer and contacts |
| **Equipment and meter readings** | Full | Administer; equipment is shared | View | View their own equipment if delegated |
| **Service contracts** | Full | View and administer in own department | View in own department | View their own contracts if delegated |
| **Administer SLA and business hours** | Full | No | No | No |
| **Bookings** | Full | Confirm, reschedule and cancel in own department | View in own department | Book and cancel their own if delegated |
| **Reports and checklists** | Full, including unlocking and legal hold | View and complete in own department; administer templates | View and fill in reports in own department | View submitted reports and acknowledge if they have document access |
| **Documents** | Full | Administer; documents are shared | View | View their own shared documents if delegated |
| **Employees and roles** | Full | Administer users in own department; can assign roles whose permissions are a subset of their own, never **Administrator**; role definitions and department moves are administrator-only | No | No |
| **Settings and branding** | Full | Administer branding, map, templates and dispatch; departments, roles and API are administrator-only | No | No |
| **Audit log** | Global | Per work order and customer | Per work order | No |
| **Quotes and invoices** | Full | View and administer in own department; send, pay and credit | No | View own invoices and pay |
| **Payments and accounting sync** | Full | Create payment link and sync invoice | No | View and pay own invoice |
| **Inventory and purchasing** | Full, all departments | View and administer in own department; reserve and consume | View and reserve/consume if granted | No |
| **Mileage and expenses** | Full | Approve and export in own department | Record their own | No |
| **Profitability** | Full | View own department | No | No |
| **API keys** | Full | No | No | No |
| **Deletion, restore, unlocking and legal hold** | Full | No | No | No |

> **Note:** An administrator can create custom roles and give individual users tailored permissions. The table shows the standard roles. Check the user's actual permissions in "Settings" → "Employees & Roles" if something looks wrong.

Deletion is deliberately not a normal permission. An administrator can delete customers, files and other records. Work orders can be deleted by an administrator, or by a custom role explicitly granted `workorders.delete`, and only while the work order is open (not completed or cancelled). Reports and attachments are kept on soft deletion. Many deletions are soft, so the record can be restored.

## Status glossary

### Work order status

| Status | Displayed as | Meaning | Set by |
| --- | --- | --- | --- |
| `OPEN` | Open / New | Created but not planned. Used for the customer's date request before the office plans it. | System, office |
| `PENDING` | Waiting to be planned | Starting status for new and cloned work orders. Not selectable manually. | System |
| `PLANNED` | Planned | Has a date or visit and is ready for assignment or execution. | Office, system |
| `WAITING` | Waiting for customer | Work is on hold for the customer, access or clarification. | Office, technician |
| `IN_PROGRESS` | In progress | Work has started. | Technician, office |
| `COMPLETED` | Completed | Closed and treated as history. | Technician, office |
| `CANCELLED` | Cancelled | Closed without being carried out. | Office |

All open statuses can be changed freely, including to `COMPLETED` or `CANCELLED`. `COMPLETED` and `CANCELLED` are closed. Only an administrator can reopen a closed work order, and must give a reason.

### Visit status

| Status | Displayed as | Meaning |
| --- | --- | --- |
| `PLANNED` | Planned | Planned, but no technician is assigned. |
| `ASSIGNED` | Assigned | At least one technician is assigned, but work has not started. |
| `EN_ROUTE` | On the way | The technician has started driving. Records the first response in any SLA. |
| `ON_SITE` | On site | The technician has arrived and is working on site. |
| `DONE` | Completed | The visit is finished. Tracking links are revoked. |
| `CANCELLED` | Cancelled | Cancelled before completion. |

The flow is `PLANNED → ASSIGNED → EN_ROUTE → ON_SITE → DONE`. `CANCELLED` can be used before the visit is completed. `DONE` and `CANCELLED` are closed.

> **Tip:** "On the way" starts the SLA response clock and makes it possible to share position and give the customer an estimated arrival.

### Report, unit and acknowledgement

| Term | Meaning |
| --- | --- |
| **Draft** | Completed fields saved locally or as a `ReportDraft`, but not submitted. A draft is not a report and is not shown to the customer. |
| **Submitted and locked** | The form has been submitted. The report is locked, has a PDF and a revision, and cannot be changed without an administrator. |
| **Open for correction** | An administrator has unlocked it with a reason. Changes are saved as a new revision, and the report locks automatically again. |
| **Acknowledged** | The customer has confirmed receipt. The acknowledgement is visible to the office and can be withdrawn on resubmission or unlocking. |
| **Revision** | An immutable snapshot before a change. Preserves names, units, answers, signatures and acknowledgement. |

| Unit result | Displayed as | Meaning |
| --- | --- | --- |
| `GODKJENT` | Approved / done | The unit has been checked and is in order. |
| `AVVIK` | Deviation found | The unit has a deviation that needs follow-up. |
| Not assessed | Not assessed | The unit has no result. The report cannot be submitted until every unit is assessed. |

The overall report result is derived from the units: at least one deviation gives an overall deviation, all approved gives approved, and otherwise "not assessed" is shown. If the report contains deviations, one automatic remediation work order is created.

### Service contract and SLA

| Contract status | Displayed as | Meaning |
| --- | --- | --- |
| `DRAFT` | Draft | Being set up; does not generate work orders. |
| `ACTIVE` | Active | Valid and can generate work orders when the next service is due. |
| `PAUSED` | Paused | Paused; does not generate work orders. |
| `EXPIRED` | Expired | Passed its end date without renewal. |
| `TERMINATED` | Terminated | Ended before its planned end. |

The renewal mode is `AUTO` (renews automatically) or `MANUAL` (must be renewed by the office). `Next service` is the date the system uses to decide whether to create a new work order.

| SLA state | Displayed as | Meaning |
| --- | --- | --- |
| `ON_TRACK` | On track | Both response and resolution deadlines are within limits. |
| `AT_RISK` | At risk | The deadline is approaching; a notification is sent on the transition. |
| `BREACHED` | Breached | The deadline has passed; a notification is sent on the transition. |
| `MET` | Met | Response and resolution were recorded within the deadline. |
| `CANCELLED` | Cancelled | The work order was cancelled and the clock stopped. |

SLA deadlines are calculated using the department's business hours and holidays. The first "En route" or "On site" records the response. "Done" on the workday records the resolution; "Finish travel" does not move the clock. An SLA clock exists only when the work order has an active, date-valid agreement with an active SLA policy. Without that agreement, no SLA is shown.

> **Note:** Without the `quotes` and `invoicing` modules, the system does not calculate prices or invoices, and price lists are reference data. With the modules on, quotes, invoices, VAT, payments and credit notes are calculated on the server.

### Booking status

| Status | Displayed as | Meaning |
| --- | --- | --- |
| `PENDING` | Pending | In the office's booking queue as a date-only request. Time and technician are not planned. |
| `CONFIRMED` | Confirmed | The office has planned time and technician, and the work order and visit have been created. |
| `CANCELLED` | Cancelled | The booking was cancelled. |
| `EXPIRED` | Expired | A pending request expired without confirmation. |

New bookings are always date-only requests: the customer chooses a date, not a
time block, and the office plans time and technician. No new booking becomes
`CONFIRMED` directly. Every pending request can be confirmed; older rows with a
stored time window may use it, otherwise the office supplies date, start and end.
Overlapping visits are a busy marker, not a hard block. A short hold
(`BookingHold`) is used only when an already confirmed appointment is moved.
The event log uses `CREATED`, `CONFIRMED`, `RESCHEDULED`, `CANCELLED` and
`EXPIRED`.

### Quotes, invoices and payments

| Quote status | Displayed as | Meaning |
| --- | --- | --- |
| `DRAFT` | Draft | Freely editable |
| `SENT` | Sent | Link issued; lines frozen |
| `ACCEPTED` | Accepted | The customer accepted |
| `REJECTED` | Rejected | The customer rejected |
| `EXPIRED` | Expired | Validity has passed |

| Invoice status | Displayed as | Meaning |
| --- | --- | --- |
| `DRAFT` | Draft | Not sent; editable |
| `SENT` | Sent | Number assigned; lines frozen |
| `PARTIALLY_PAID` | Partially paid | Outstanding remains |
| `PAID` | Paid | Outstanding is zero |
| `OVERDUE` | Overdue | Due date passed |
| `CREDITED` | Credited | Credit note registered |

| Payment status | Meaning |
| --- | --- |
| **Pending** | Link created, but payment not confirmed |
| **Paid** | The webhook registered the payment |
| **Failed** | The provider rejected or the payment failed |
| **Expired** | The link expired without payment |

A payment link can be used once and covers one amount. Refunds use a credit note,
not the payment provider. Accounting sync has the statuses **Synced**,
**Exported** (CSV) and **Failed**.

### Inventory, purchasing and expenses

| Purchase status | Displayed as | Meaning |
| --- | --- | --- |
| `DRAFT` | Draft | Editable |
| `ORDERED` | Ordered | No goods received |
| `PARTIALLY_RECEIVED` | Partially received | Some goods in stock |
| `RECEIVED` | Received | Everything received |
| `CANCELLED` | Cancelled | Cancelled before receipt |

Inventory movements are `IN`, `OUT`, `ADJUST`, `RESERVE`, `RELEASE` and
`CONSUME`. A reservation reduces available stock but does not move the item until
it is consumed. Only `ADJUST` can produce negative stock.

| Expense status | Displayed as | Meaning |
| --- | --- | --- |
| `DRAFT` | Draft | Not submitted for approval |
| `PENDING` | Pending | Submitted, not processed |
| `APPROVED` | Approved | Can be exported |
| `REJECTED` | Rejected | Requires a reason; not exported |
| `EXPORTED` | Exported | Locked in a payroll CSV |

### Notifications and audit log

A notification is a message to one user about an event. It appears in the bell and under "Notifications", and can also be sent by email. The user chooses which types appear in the app and which are sent by email.

| Notification type | Typical recipient | Triggered by |
| --- | --- | --- |
| `ASSIGNMENT` | Technician | The work order is assigned |
| `DATE_CHANGED` | Technician | The work order date changes |
| `CANCELLED` | Technician | The work order is cancelled |
| `REPORT_READY` | Technician, office and customer portal | The report is submitted and ready |
| `BOOKING` | Office and assigned technician | A new or confirmed booking |
| `CONTRACT_DUE` | Office | A service contract is due |
| `OVERDUE` | Technician and office | The work order is overdue |
| `CONTACT_UPDATE` | Office | The customer requests updated contact information |
| `SLA_AT_RISK` / `SLA_BREACHED` | Technician and office | The SLA deadline is approaching or has been breached |
| `WARRANTY` | Office | Equipment warranty is about to expire |
| `MESSAGE` | Office or customer | A new message in a conversation |
| `INVOICE_PAID` | Office and customer | The invoice has been paid |

The audit log is a permanent, non-editable history of actions: who created, changed, moved, cancelled, deleted, unlocked or applied a legal hold, with time and metadata. You find it on the work order, on the customer card and under "Settings" → "Activity log" for administrators.

## How features talk together

> **Note:** `WorkOrder`, `VisitTechnician`, `BookingRequest` and
> `MaintenancePlanOccurrence` are internal model names. In the interface they
> are called work order, technician assignment, booking and maintenance
> occurrence.

| Action | Data created or updated | Who sees it |
| --- | --- | --- |
| Customer sends a date request | `BookingRequest(PENDING)`, `WorkOrder(OPEN)`, booking event, `BOOKING` | Office in "Bookings" |
| Office confirms a pending request | `BookingRequest(CONFIRMED)`, `WorkOrder(PLANNED)`, `Visit(PLANNED)`, optional SMS | Customer, office, technician |
| Customer moves a confirmed appointment | New time window, `Visit(PLANNED)`, `RESCHEDULED`; short `BookingHold` only in this flow | Customer, office, technician |
| Office creates a work order | `WorkOrder(PENDING)`, `Visit(PLANNED)` if dated, audit log | Office, calendar |
| Office assigns a technician | `VisitTechnician`, technician list, `ASSIGNMENT`, audit log | Technician, office |
| Technician starts driving | `Visit(EN_ROUTE)`, `enRouteAt`, SLA response, tracking | Office, customer |
| Technician marks "On site" | `Visit(ON_SITE)`, `onSiteAt` | Office, customer |
| Technician completes the visit | `Visit(DONE)`, `doneAt`, tracking revoked | Office, customer |
| Technician submits the report | `Report` locked, revision 0, PDF, units, equipment history, `REPORT_READY`, optional remediation work order | Office, customer, equipment history |
| Customer acknowledges | `customerAcknowledgedAt`, acknowledgement comment | Office, report |
| Service contract becomes due | `WorkOrder(PLANNED)`, `Visit`, previous report as PDF, `CONTRACT_DUE` | Office, calendar |
| A meter reading passes the threshold | `MaintenancePlanOccurrence`, new maintenance work order | Office, customer |
| A document is uploaded | `Document`, `Upload`, OCR job, search index | Staff with document access |
| Role or permissions change | `User.sessionVersion` increases, API keys inherit new permissions | User, administrator |
| Quote sent | `Quote(SENT)`, version, one-time token, `EmailMessage` | Customer, office |
| Customer accepts quote | `Quote(ACCEPTED)`, audit row | Office, customer |
| Quote converted | `WorkOrder`, customer link, equipment | Office, calendar |
| Invoice sent | `Invoice(SENT)`, number, frozen lines, `EmailMessage` | Customer, office |
| Payment received | `Payment`, `Invoice.paidTotal`, status, audit row | Office, customer |
| Payment link created | `Payment` metadata, external ID, audit row | Customer, office |
| Invoice synced | `AccountingSync`, external ID, status | Office, accounting |
| Item reserved | `InventoryReservation`, `StockMovement(RESERVE)` | Inventory, technician |
| Item consumed | `StockMovement(CONSUME)`, reduced stock | Inventory, technician |
| Purchase order received | `PurchaseOrder`, `PurchaseOrderLine`, `StockMovement(IN)` | Inventory, office |
| Expense approved | `Expense`/`MileageTrip`, approver, audit row | Office, technician |
| Payroll CSV exported | `PayrollExport`, locked lines, checksum | Office, payroll |

> **Tip:** When troubleshooting, start with the action and follow the row in the table. You will see which side is missing data, and which role should see it.

## Common cross-role problems

| Problem | Check first | Where to look |
| --- | --- | --- |
| **The customer portal user cannot sign in or see data** | Is the user active and linked to a contact belonging to the right customer? Is the delegation active with the right sub-permissions? Has the invitation been completed and a password set? | "Customers" → customer card → **More → Portal users**; "Settings" → "Employees & Roles" |
| **The customer cannot see documents, contracts or equipment** | Does the contact have `canViewDocuments`, `canViewContracts` or `canViewEquipment`? Is the document owned by the customer and shared? Is the contract in the right department? | Customer card → **More → Portal users** and the portal’s "Documents", "Contracts" and "Equipment" tabs |
| **The work order is missing from the calendar** | Does the work order have a date and a visit? Undated work orders have no visit. Is the visit cancelled or completed? Is the date outside the ±6-month window? Is a filter hiding it? | "Work orders" → visit section; "Calendar"; "Dispatch" |
| **The report is not visible** | Was the form submitted, or is it only a draft? Is the report locked and submitted? Do the date, customer and department filters match? Is it deleted? Has the PDF been generated? | "Work orders" → "Checklists"; "Reports"; customer portal → "Reports" |
| **The service contract is not generating a work order** | Is the contract `ACTIVE`, not `PAUSED` or `EXPIRED`? Is `Next service` due? Has the end date passed? Is the customer deleted? Has the work order already been generated? Is the scheduled job running? | "Contracts" → contract; customer card; operations log for recurring jobs |
| **The notification does not arrive** | Is the type enabled for the app or email? Is the user active and actually a recipient? Is the email in spam? Was the notification deduplicated? Is the email queue being processed? | "Notifications" → "Settings"; "Notifications"; operations log for email |
| **The offline draft is not syncing** | Are you on the same device, in the same browser and signed in as the same user? Has the app been reopened with a connection? Is the draft in the outbox? Is it older than seven days, too large, or rejected because the report is locked? | Field surface → offline banner and draft list; browser storage |
| **The technician cannot see the work order** | Is the work order in the technician's department? Is it assigned, or available? Is it completed or cancelled? Is the date correct? Does the technician have "Take work order" access? | "Today"; "Work orders"; "Calendar" |
| **An action is rejected with "no access"** | Does the user have the right role and permission? Is the user in the right department? Is the account active? Is the work order locked or under legal hold? | "Settings" → "Employees & Roles"; the work order's audit log |
| **Sites or units from the wrong customer appear** | Wrong customer selected, or the page was not reloaded after switching customer | Switch customer again, reload the page and check the saved selection |
| **A unit cannot be moved** | Active contract lines, number conflict, cross-customer reference or invalid target | Read the blocker in the preview, clear the contract line, or choose the right customer/site |
| **An upload is rejected** | File too large, user/customer quota reached, or proxy limit | Check file size, `UPLOAD_QUOTA_*`, disk and the proxy body limit |
| **Customer transfer does not start** | 10 starts per hour used up, an existing job is reused, or the preview expired | Wait, follow the existing job, or upload and preview the package again |
| **Quote or invoice page returns 404** | The `quotes`/`invoicing` module is off | Enable the module under **Settings → Modules** |
| **Payment button does not appear** | Provider or webhook secret missing, or the amount is paid | Check `PAYMENTS_PROVIDER` and keys, and create a new link |
| **Payment is not recorded** | Webhook rejected, or currency/amount mismatch | Check signature and audit log; reconcile manually |
| **Accounting sync fails** | Wrong key, account or VAT setup | Read `lastError`, fix the cause and sync again |
| **Stock does not match** | Reservation not consumed, or adjustment missing | Check movements and reservations on the item |
| **Expenses cannot be exported** | Period overlaps, or the row is not approved | Choose a new period and approve the row |
| **Email stays queued** | SMTP missing, or the event is off | Check `SMTP_*` and **Automatic email** |
| **Push does not arrive** | Device unregistered, notifications denied, or provider not configured | Register the device again and check FCM/APNs |

### Customer portal: access is more than signing in

A portal user is always linked to a contact at a customer. The contact can have a delegation with separate choices for booking, documents, contracts and equipment. An inactive delegation closes the portal completely for that contact. A contact without a delegation row has full portal access for backward compatibility.

Check therefore that the user is active and belongs to the right customer, that the contact belongs to the same customer, that the delegation is active, and that the sub-permission for the missing area is enabled.

> **Note:** In 0.9.5 there is no dedicated form in the interface for editing the delegation. Restricted portal access must be configured and tested with the actual account.

### Calendar: date, visit and window

The calendar shows visits, not work orders themselves. A work order without a date has no visit and cannot appear. The calendar loads a limited window around the period you are viewing, and the list may be truncated. If a work order is missing, it is almost always because the work order is undated, the visit is deleted, cancelled or completed, the date is outside the window, a filter hides it, or it belongs to another department.

### Reports: draft, submitted and published

A report does not become visible to the customer just because the technician has started filling it in. The sequence is: draft → submit → the server locks and generates a PDF → the report becomes available under "Reports" and in the customer portal → the customer can acknowledge it. If the report is missing, find out where in this chain it stopped. A draft that only exists locally is not a report.

### Service contracts: only active and due contracts generate work orders

A service contract does not generate work orders just because it exists. It must be `ACTIVE`, `Next service` must be due, and the contract must not have passed its end date. The system also does not create a new work order for the same contract and date twice. If the contract is `PAUSED`, `EXPIRED` or `TERMINATED`, the office must activate or renew it first.

### Notifications: app, email and recipients

Notifications are both in-app and email. A missing notification in the inbox does not necessarily mean it was not created. Check whether the user has disabled the type, whether the user is active and actually a recipient, whether the notification is under "Notifications" without an email, whether the email is delayed or in spam, and whether the same event was already notified with a deduplication key.

### Offline: a draft is not the same as sent

The field surface saves drafts locally when the connection disappears. The draft is sent when the app is open and the connection returns. It cannot be sent if the report is locked or under legal hold, if the draft is older than seven days or larger than the limit, if the device has lost its storage, or if a different user or browser opens the app. Submission requires a connection; signature is optional.

## Norwegian/English glossary

| Norwegian | English | Meaning |
| --- | --- | --- |
| Avdeling | Department | Organisational unit that scopes access |
| Oppdrag | Work order | The service job that is planned and followed up |
| Visitt | Visit | Time block within a work order, with technicians |
| Montør | Technician | The person carrying out field work |
| Kontor | Office | The planning and administration role |
| Kunde | Customer | The company receiving service |
| Kontaktperson | Contact | The person at the customer |
| Sted | Site | Physical address or facility |
| Utstyr / enhet | Equipment / unit | The machine or system being serviced |
| Rapportenhet | Report unit | The unit as it appears in a report |
| Sjekkliste | Checklist | The points being checked |
| Mal | Template | Reusable checklist or HMS form |
| Rapport | Report | Completed and submitted checklist |
| Avvik | Deviation | A finding that needs follow-up |
| Godkjent | Approved | The unit has been checked and is in order |
| Revisjon | Revision | Immutable snapshot before a change |
| Kvittering | Acknowledgement | Customer confirmation of receipt |
| Låst | Locked | Cannot be changed without an administrator |
| Serviceavtale | Service contract | Agreement for recurring service |
| Fornyelse | Renewal | Automatic or manual extension |
| SLA | Service level agreement | Agreed response and resolution time |
| Åpningstider | Business hours | The hours within which SLA deadlines are calculated |
| Bestilling | Booking | The customer's request or confirmed appointment |
| Ledig time | Available slot | Suggested time in the slot picker; used only when moving a confirmed appointment, not for new bookings |
| Reservasjon | Hold | Short-term reservation of an available slot in the legacy reschedule flow |
| Varsel | Notification | Message about an event |
| Aktivitetslogg | Audit log | Traceable history of actions |
| Rettighet | Permission | What a role or user can do |
| Bevaringsplikt | Legal hold | Freezes data against deletion and change |
| Dokumentbibliotek | Document library | Shared file area with folders and tags |
| HMS | HMS | Health, safety and environment |
| Måler | Meter | Equipment reading, for example hours |
| Vedlikeholdsplan | Maintenance plan | Calendar- or meter-based maintenance |
| Sporing | Tracking | Temporary sharing of status and arrival |
| Omtale | Review | Internal customer feedback after a visit |
| Kundeportal | Customer portal | The customer's own surface |
| Kladd | Draft | Locally saved, unsubmitted form |
| Kundeadskillelse | Customer scoping | Site and unit choices are limited to the selected customer |
| Enhetsflytting | Equipment move | Moving a unit with its service history to a new customer |
| Kundeoverføring | Customer transfer | The administrator's export/import of a customer package |
| Kontorinnboks | Office inbox | Collected SMS conversations for the office |
| Tilbud | Quote | Price proposal with lines, versions and approval |
| Faktura | Invoice | Invoiced amount with lines, payment and credit note |
| Kreditnota | Credit note | Reduction of outstanding amount, never above it |
| Betalingslenke | Payment link | One-time link to Stripe Checkout or Vipps |
| Regnskapssynk | Accounting sync | Manual transfer of customer, invoice and payment |
| Lager | Inventory | Items, stock and locations |
| Innkjøpsordre | Purchase order | Supplier order with goods receipt |
| Varemottak | Goods receipt | Registration of received goods against an order |
| Reservasjon | Reservation | Part held for a work order |
| Forbruk | Consumption | Physical deduction of a reserved item |
| Kjøretur | Mileage trip | Mileage allowance with kilometres and rate |
| Utlegg | Expense | Expense with receipt and VAT |
| Lønns-CSV | Payroll CSV | Locked export of approved time, mileage and expenses |
| Lønnsomhet | Profitability | Estimated and actual revenue by department, customer and technician |
| Utboks | Outbox | Durable queue for email and push |
| Pushvarsel | Push notification | Notification to mobile via FCM or APNs |
| SAML | SAML | Federated sign-in with signed assertion |
| SCIM-gruppe | SCIM group | Group granting role/department through explicit mapping |
| Feltmaskering | Field redaction | Server-side hiding of sensitive fields |
| S3 | S3 | Object storage for uploads |
| Redis | Redis | Wake-up channel and cache, with database fallback |
| PITR | PITR | Restore to a chosen point in time |
| RPO/RTO | RPO/RTO | Maximum data loss and maximum downtime |

## Support information to collect

When you report a problem, it helps to collect the information below. Write briefly what you did, what you expected, and what actually happened.

- **Version:** FSM Platform 0.9.5, and where you saw the problem (office surface, field surface, customer portal, PDF or API).
- **Time:** Date and time with time zone, preferably Europe/Oslo.
- **User:** Email, role, department and any customer. Never provide passwords or one-time codes.
- **Case:** Work order number or ID, title, customer and date. For a report: report number or ID. For a booking: reference. For a contract: contract number.
- **Environment:** Browser and version, operating system, phone or PC, and whether the field surface is installed as an app.
- **Network:** Were you online or offline? Did it happen in a draft, during submission or afterwards?
- **Error message:** Reproduce the text exactly, and take a screenshot showing the time, user and error message.
- **Reproduction:** Write down the steps you took, and whether the problem happens every time or only sometimes.
- **Notification:** For notification problems, provide the type, recipient, app or email, and whether the notification exists under "Notifications".
- **API:** Provide the key prefix (never the full key), endpoint, time, HTTP status, `error.code` and any `requestId`.
- **PDF and email:** State whether it concerns generation, display, download or sending, and whether it concerns a report or a contract.
- **Offline:** State whether the draft is in the outbox, whether it is older than seven days, and whether the same user and device were used.
- **Payments and accounting:** Provide invoice number, provider, amount, currency and whether the failure occurred at the link, webhook or sync. Never full keys.
- **Email and push:** Provide event type, recipient, whether it concerns app or email, and whether the row is `PENDING`, `FAILED` or `DEAD_LETTER`.

> **Warning:** Never send passwords, one-time codes, full API keys or complete personal data in a support case. Mask screenshots where possible.
