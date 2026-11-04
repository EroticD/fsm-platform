# Office: planning, dispatch and follow-up

This chapter is for office staff: you receive enquiries, create and plan work
orders, assign technicians, follow up reports and keep customer, equipment and
agreement data up to date. It applies to FSM Platform 0.8.9 (4 November 2026).

Work orders and service agreements belong to a department: you normally see only
your own department, while an administrator sees everything. Customers,
equipment and documents are shared, but every action requires the right
permission. The platform does not issue invoices and does not record hours or
materials. Price lists are reference data; invoicing happens outside the
platform.

## Dashboard

The dashboard is at `/` and is titled **Planning**.

### List and board

**List** (`/?vis=liste`) is the default and shows one prioritised queue with
**Overdue**, **Today** and **Unassigned**.

**Board** (`/?vis=tavle`) has the columns **Overdue**, **Today**, **In progress**
and **Unassigned**. These are priority buckets, not statuses; the status is a
pill on the card.

| Card | Meaning | Click |
| --- | --- | --- |
| **Overdue** | Scheduled before today, not completed | `/oppdrag?vis=forfalte` |
| **Today** | Scheduled today, including multi-day work orders | `/oppdrag?vis=idag` |
| **Unassigned** | Active work order without a technician | `/oppdrag?vis=ikke-tildelt` |
| **In progress** | Status **In progress** | `/oppdrag?vis=pagaaende` |

The **Queue** can be sorted by **Date**, **Customer**, **Status** or **Title**;
the default is **Oldest first**. The right-hand rail shows **Next action** with
**Assign technician** or **Open work order**, **Today's progress** and **Team
today**.

### Exceptions, quick actions and activity

At the top of the dashboard, **Exceptions needing action** shows the cards
**Unassigned today**, **Visits without technician**, **Double booked**,
**Overdue**, **Missing coordinates**, **Unsigned reports** and **Stale
bookings**. Each card shows a count and opens the relevant list or dispatch.
**Quick actions** gives **New work order**, **Calendar**, **Dispatch**,
**Search**, **My work orders**, **All work orders**, **Customers**,
**Documents**, **Checklists**, **Statistics** and **Map**. **Recent activity**
shows the latest events with **View all activity**.

### Quick assignment

1. Go to **Work orders** (`/oppdrag`).
2. Find the row that says **No technician assigned**.
3. Choose a technician in **Choose technician** and press **Assign**.

The technician appears in the row. The assignment applies to the work order; if
only one visit needs a different technician, do it in **Planning**.

### Drag and drop

Drag a card from the board to a technician in **Team today**, or from **Resource
overview** to the technician's column. Drag and drop assigns a technician,
**not** a date; use the calendar or **Planning** to move time.

### Global search

**Search** in the top bar searches customers, work orders, documents, units and
reports. Results show their type, and the search tolerates typos. Document hits
open the document in the library. Use search when you only have a name, an order
number or a keyword.

## Work orders

The work order list is at `/oppdrag` with the views **Active**, **New**, **Not
started**, **In progress**, **Today**, **Overdue**, **Unassigned**,
**Completed** and **Cancelled**.

### Create

1. Press **New work order** (`/oppdrag/ny`). The department is fixed to your
   own; only an administrator can choose another. Enter **Work order title** and
   optionally **Order number** (unique in the department).
2. Enter **Description / Instructions**.
3. Choose **Customer** and **Contact person**, or leave the customer empty for
   an **Internal work order**. **Address**, **Postal code** and **City** override
   the customer address.
4. Set **Date of execution** and optionally **End date (optional)**.
5. Choose technicians under **Assign technicians** and templates under **Add
   checklists / forms**, and add **Tags** if needed.
6. Press **Save work order**. You return to **Calendar**.

**Edit work order** changes title, customer, contact, date, technicians and
description.

### Priority and status

There is no separate priority field; priority comes from the date, the status
and whether a technician is missing. The statuses are **Open / New**, **Waiting
to be planned**, **Planned**, **In progress**, **Waiting for customer**,
**Completed** and **Cancelled**. Only an administrator can reopen a completed or
cancelled work order.

### Checklists, technicians and visits

On the create page, templates are grouped under **Service / checklists** and
**HMS documentation**. Each template produces its own report, which is always
new and empty.

You can assign several technicians; **Remove** takes one off. The work order has
a date; the time is set on the visit:

1. Open **Planning** and press **Add visit**.
2. Choose **From date**, optionally **Through**, and enter **Start time** and
   **End time** in 24-hour format, for example `09:00` and `11:30`.
3. Tick **All day** if the job has no fixed time, choose **Technicians on the
   visit**, and add a **Note** if needed.
4. Press **Save visit**.

A visit lasts at most 31 days, and the end time must be after the start time.
Overlapping visits are allowed. The technician is shown as busy, but can still
be assigned another job; use the calendar and capacity view to judge the load.

### HMS library and QR labels

**HMS** (`/hms`) collects HMS forms by type: **Safe Job Analysis (SJA)**,
**Hot work**, **Internal control**, **Deviations**, **Safety round**, **Written
instruction** and **General**. Under **Link HMS form to work order**, choose an
**HMS form** and an active **Work order**, then select **Link form to work
order**. The form is added to the work order and filled in there. **Recent HMS
documentation** shows completed HMS forms you have access to.

QR label: open the unit at `/enheter/<id>`, select **Print label**, and use
**Print** on the label page (`/enheter/<id>/etikett`). Scanning the label opens
the unit. **Rotate QR token** if the label is lost or shared; the old label stops
working immediately.

**Existing QR codes:** If the customer already has labels from another system,
register the value under **Existing QR codes** on the asset page. Paste or scan
the value, optionally give it a name (for example “Old QR – gate 3”), and save.
The label stays physically on the equipment and is never changed. Each value can
be linked to only one asset. Deleting removes only the mapping in FSM, not the
physical label, and is recorded in the audit log.

### Attachments, comments and completion

**Attachments** accepts images and PDFs, up to 15 MB per image and 50 MB per PDF, and is internal.
A rolling 24-hour quota of 2 GiB per user and 10 GiB total storage per customer
also applies; adjust it with `UPLOAD_QUOTA_USER_MB` and
`UPLOAD_QUOTA_CUSTOMER_MB`. **Comments** are the dialogue between office and
technician; write in the field and press **Add comment**.

**Complete** sets the status to **Completed** after the confirmation **Complete
this work order? The work order and report are locked for editing.** **Cancel
work order** requires a **Reason for cancellation**; the customer is notified,
and only an administrator can reopen it.

### Clone, related data and trash

**Clone work order** copies the details, customer, equipment, technicians,
templates, tags and visits. The clone gets the status **Waiting to be planned**,
and the **order number is cleared**. Reports and attachments are not copied.

| Data | Where | Note |
| --- | --- | --- |
| Customer/contact | Header and **Location and contact** | Locked when a report or booking exists |
| Equipment | Customer card → **Equipment** | The report remembers the units checked |
| Reports | **Checklists and reports** | Locked when submitted |
| Visits | **Planning** | Control the date period |
| Agreement/booking | The agreement's latest work order / booking queue | One booking per work order |

**Move to trash** is administrator-only by default; the button is shown only to
roles with `workorders.delete` and only for work orders that are not closed. An administrator can restore it from **Trash**
(`/oppdrag/slettede`). Work orders without reports can be removed after 365
days; work orders with reports are retained. **Legal hold** stops all automatic
deletion.

## Customers and contacts

The customer directory is at `/kunder`. Search by name, org. number, city or
email, or press **New customer**.

The customer card has the tabs **Overview**, **Work orders**, **Agreements**,
**Equipment** and **More**. At the top you find **New work order**, **Messages**,
**Edit** and, for an administrator, **Delete customer**. **Overview** shows
company information, contacts, portal users, overdue and upcoming work orders.

### Contacts

1. Open the customer card → **More** → **Contacts**.
2. Press **Add contact**.
3. Enter **Name**, **Role (optional)**, **Email (optional)** and **Phone
   (optional)**, and save.

A portal user must always be linked to a contact. If you delete the contact, any
portal users linked to it are deactivated.

### Department and responsible technician

**Edit customer** has **Department (optional)** and **Responsible technician
(optional)**. The responsible technician is shown as the customer's direct
contact.

### Portal users

Customer card → **More** → **Portal users**.

1. Press **Create and send invitation**.
2. Enter **Name**, **Email** and choose **Contact**.
3. Send the invitation; the user sets a password via the link.
4. Press **Activate** once the password is set.

If the email cannot be sent, the system shows **Invitation ready for {name}**
with **Copy link**; send it manually. **Deactivate** closes the portal and signs
the user out.

### Equipment, documents and agreements

**Equipment** shows units and service history. **More** → **Attachments**
holds documents, agreements and images belonging to the customer. **Agreements**
shows service agreements, coverage lines, next service, SLA and price lists.

**Sites** and **Equipment** on the customer card have their own search fields.
The search runs on the server and is limited to the open customer, so you can
search by name, address, postal code, city, model or serial number without
other customers' rows appearing. **Reset** clears the search, and the counter
shows how many matches the customer has.

## Equipment and assets

The asset register is at `/enheter`. Search by model, serial number, location or
customer, filter by status and category, or turn on **Show hierarchy**.

### Create and edit

1. Press **New asset** (`/enheter/ny`).
2. Choose **Customer**, and enter **Model** and **Serial number**.
3. Enter **Location**, **Category**, optional **Parent asset**, **Status** and
   **Criticality**.
4. Set **Installation date**, **Warranty until** and **Meter unit** if relevant.
5. Press **Register asset**.

Once a **Customer** is selected, only that customer's **Sites** and **Parent
asset** are loaded from the server. Changing customer clears and reloads the
lists, so you cannot select a site or asset belonging to another customer. The
same applies to **New work order** and **Edit work order**.

**Edit asset** changes the same fields.

The statuses are **Active**, **Out of service** and **Retired**; criticality is
**Critical**, **Normal** or **Low**. **Parent asset** builds a hierarchy, and
**Move in hierarchy** changes placement.

### Move a unit to another customer

When equipment changes owner or customer, the whole unit can be moved with its
service history. The move requires **Manage equipment** and **Manage
customers**, or an administrator.

1. Open the unit at `/enheter/<id>` and select **Move to another customer**.
2. Search for the target customer and optionally choose a target site. If you
   choose no site, the unit stays without a site at the new customer.
3. Review **What moves** and the preview. It shows the number of work orders,
   visits, reports, revisions, readings, plans, documents, attachments and QR
   codes that will follow.
4. Type the target customer's name to confirm, or tick the confirmation, and
   select **Move the unit**.

**This moves:** the unit and any child units (up to 1000), the hierarchy between
them, work orders and visits, reports with revisions, report units and PDFs,
readings, maintenance plans and occurrences, documents with versions,
attachments/uploads, registered QR codes and comments. The root unit receives
the target site. Child units lose the old site because it belonged to the
previous customer and must be placed again after the move. The root unit is no
longer linked to any former parent unit.

**This blocks the move:**

- **Contract lines belonging to another customer's agreement** that point to
  the unit or a child unit. A move cannot silently change who a financial
  obligation points to. Clear or end the contract lines first.
- Child units that already belong to another customer.
- Order numbers that collide with a number in the target customer's department.
- A missing or deleted target customer, or a target site that does not belong to
  the customer.
- More than 1000 units in the subtree.

**This does not move:** contract lines, the old customer's portal users, global
documents without a customer or unit link, or the audit log itself. Contacts
from the old customer are cleared on the work orders, and work orders that point
to another customer's agreement lose the contract link. The preview warns you
in advance. The target customer's department is used when it exists; otherwise
your own department is used, and you are told.

The move is idempotent: repeating it after the unit is at the target customer
reports that nothing changed. All validation runs before the first write, so a
rejected move leaves no half-finished changes. The action is audit-logged. To
undo it, move the unit back manually.

### Readings

1. Open the asset and find **Meter**.
2. Press **Register reading**.
3. Enter **Value**, **Date**, **Source** and optionally **Note**.
4. Press **Save reading**.

### Maintenance plans

1. Press **New maintenance plan**.
2. Enter **Title** and choose **Trigger**: **Calendar** or **Meter**.
3. For calendar: set **Interval (months)** and optionally **Lead time (days)**.
   For meter: set **Meter interval**.
4. Check **Next due** and save.

**Pause** stops the plan, and **Activate** starts it again; **Timeline** shows
occurrences. When the plan falls due, the scheduled job creates a work order for
the office to follow up.

### Service history and reports

**Service history** shows every report in which the asset was checked, with
date, result, comments, checkpoints and images.

In the form, the technician chooses **Get from the customer equipment**. Each
registered asset can be used only once in the same report. The report remembers
the asset, serial number and answers, so the customer card and asset page show
exactly what was checked.

## Calendar and dispatch

The calendar is at `/kalender` with the tabs **Resource overview**, **Month**,
**Week**, **2 weeks**, **Week (time)**, **Day**, **Dispatch**, **Capacity**,
**Route** and **Reports**.

| Tab | URL |
| --- | --- |
| **Month** | `/kalender?vis=maned` |
| **Week** | `/kalender?vis=uke` |
| **2 weeks** | `/kalender?vis=2uker` |
| **Week (time)** | `/kalender?vis=timegrid` |
| **Day** | `/kalender?vis=dag` |

At the top, **Period** shows the month or date range right next to the navigation
arrows and **Today**. The calendar loads about six months back and forward, and a
maximum of 1000 visits; visits outside the window may be missing.

**Filter the calendar** has **Technician**, **Status** and **No technician**.
**Apply filter** and **Reset** apply to all date views.

### Visits and drag and drop

The calendar shows visits with the status **Planned**, **Assigned**, **On the
way**, **On site**, **Completed** or **Cancelled**. Drag a visit to another day
or time range to move it. On conflict the move is not saved, and you are told
about the overlapping assignment.

**Resource overview** shows technicians, active work, unassigned work and recent
completions. **Unassigned work orders** have **Assign technician**. You can drag
cards between technicians to assign.

### Dispatch and capacity

**Dispatch** (`/kalender/dispatch`) assigns technicians to visits, with a
separate **No technician** column. **Overdue / Unassigned** is always shown,
regardless of the date. Drag a visit to a technician's column to move it. Drop
it on **No technician** to remove the source technician; other technicians are
kept.

**Automatic assignment** is dry-run with **Dry run**; **Use {count} suggestions**
saves only when you choose it. **Suggest technician** ranks candidates by
**Skills**, **Distance**, **Travel**, **Free**, **SLA** and **Load**.

**Capacity** (`/kalender/kapasitet`) shows **Planned capacity against actual load
per department, day and technician**. Choose **From** and **To**, press **Show**,
and read **Capacity**, **Load** and **Utilisation**.

### Route plan

**Route** (`/kalender/rute`) suggests a driving order for one day, per
technician. Choose **Date** and optionally **Technician**, then **Show route**.
The page shows a map, stop numbers, **Arrival**, **Planned**, **Driving**,
**Waiting**, and total **Drive time**, **Distance** and **Waiting time** per
technician.

The route starts at the technician's earliest located visit. Visits without
coordinates, or that do not fit within the time window, are listed under
**Visits not included in the route** and are not moved. The calculation uses an
external routing provider when configured; otherwise straight-line distance ×
1.35 and average speed. **Calculation** shows which method was used.

**Use order** moves the visits to the suggested times in one transaction. The
action requires `workorders.assign`, is audit-logged per visit, and is cancelled
entirely on overlap with a fixed visit or registered holiday/sickness. Completed
and cancelled visits are never moved. If the plan has changed since it was
shown, you are asked to reload the page.

**Assignment rules** and **Territories** are configured under **Settings →
Dispatch**. There you choose a **Mode**, adjust the **Weights** for **Skills**,
**Distance**, **Travel time**, **Free time**, **SLA** and **Load**, and add
territories with **Postal prefixes**, **Municipality codes** and **Radius (km)**.
**Capacity plans** are shown in the capacity view but are not edited in
**Settings** in 0.8.9. The same applies to skills, absence and working hours:
dispatch and booking use them, but they have no separate form in **Settings**.

## Agreements, SLA and price lists

Agreements are at `/avtaler` and on the customer card's **Agreements** tab.

### Create

1. Open the customer card → **Agreements**.
2. Enter **Title**, optional **Agreement number**, **Department**, **Start date**
   and **End date**.
3. Choose **Interval** (3, 6, 12 or 24 months), **Status** (**Draft** or
   **Active**) and **Renewal** (**Manual** or **Automatic**).
4. Set **Notice before expiry (days)** and optionally **Price adjustment (%)**.
5. Choose **Contact**, **Checklist**, **SLA policy** and **Price list**, and add
   a line with **Equipment**, **Coverage**, **Visits/year**, **Response (min)**
   and **Resolution (min)**.
6. Press **Create service agreement**.

### Lines and coverage

**Coverage ({count})** shows the agreement lines. An agreement **without lines**
covers all equipment; a line **without equipment** covers all equipment; a line
**with equipment** covers only that unit. Read equipment, coverage, visits per
year and response times. Only **Active** agreements within the start and end
dates count. No automatic “covered” badge is shown, so check manually before
promising cover.

### Interval, renewal and lifecycle

**Next service** is calculated from the start date and interval. **Renew**
extends; **Pause** and **Activate** stop and start new work orders. **Automatic**
renewal is run by the scheduled service agreement job. **Manual** renewal
becomes **Expired** after the end date.

### SLA

An SLA policy sets **Response time (minutes)** and **Resolution time
(minutes)**. It can be department-specific or global, and limited to **Count
business hours only**. **Business hours** and **Holidays** decide when the clock
runs; without saved business hours, weekdays 08–16 are used. Policies, business
hours, holidays and price lists are maintained by an administrator under
**Settings → SLA and business hours**.

An agreement can point to a policy; otherwise the department default is used. On
the work order, **SLA** shows **Respond by**, **Resolve by** and **On track**,
**At risk**, **Breached**, **Met** or **Cancelled**. **On the way** or **On
site** records response; **Completed** records resolution.

### Price lists

**Price lists are reference data for display. The system does not invoice or
calculate amounts.**

### Recurring work orders

At each interval a new **Planned** work order is created with the agreement's
customer, contact, department and checklist, plus a four-hour default visit without
technicians (08:00–12:00). Expired agreements do not generate new work orders.

## Bookings

The booking queue is at `/bookinger` with **All**, **Pending**, **Confirmed** and
**Closed**. Each card shows **Reference**, **Customer**, **Requested time**,
**Location**, **Service**, **Technician** and status.

1. Open `/bookinger` and filter on **Pending**.
2. Choose **Technician** in **Choose technician**.
3. Press **Confirm booking**, or **Cancel** to decline.

On confirmation the work order becomes **Planned**, the visit is created or
updated, and the customer receives an SMS if the contact has consented.

The customer chooses a site, service and requested date in the portal, and
writes the desired time in the description. The customer cannot select a time
block, and the booking always creates a new work order with status
**Open/New**. No visit or confirmed time is created.

The office or technician plans the work order and sets the status to
**Planned**. If the time does not fit, it is set to **Waiting** for
replanning. The customer receives the final confirmation only then. A customer
booking is already a work order; there is no separate **Convert to work order**
button.

## Reports

The report list is at `/rapporter` and shows **Service reports** – completed
checklists with signatures and photos.

### List and filters

Choose **This month**, **Last month** or **All**, and filter on **Free text**,
**Customer**, **Technician**, **Deviations only** and **Acknowledgement**
(**All**, **Acknowledged**, **Not acknowledged**). **Sorting** is **Newest
first**, **Oldest first**, **Customer (A–Z)** or **Technician (A–Z)**. Press
**Filter** or **Reset filters**. The list shows **Locked**, **Open for
correction** or **Unsigned**, and **Report no.** when numbered.

### Open, PDF and content

**Open form** opens the report with **Main result**, **Signed by**, **Units that
were checked**, **Answers to checkpoints** and **General notes from the
technician**. The PDF is shown in the app's own PDF viewer. **Open in new tab**
shows the same PDF in the browser, **Download PDF** creates an attachment, and
**Close PDF** goes back. If the PDF cannot be shown, for example because it
contains active content that cannot be removed, the viewer shows an error with
**Try again** and download. Revisions are opened the same way from
**Revisions** using **Open revision (PDF)**.

A report can have a **Technician** and a **Customer** signature. Photos are added
per checkpoint or unit. Deviations appear as **Deviation found**. When a report
contains at least one deviation, the system automatically creates **one undated
remediation work order** titled “Utbedring av avvik – …”. It inherits customer,
department and contact, gets the submitter as technician, and describes the
units and checkpoints. The generated title is Norwegian (“Utbedring av avvik –
…”) in 0.8.9, even when the interface is English.

> **Note:** If a photo or signature is missing from the finished PDF, the PDF
> shows a warning with the number of images that could not be loaded. The usual
> causes are missing `Upload` metadata, a file removed from storage, or a file
> owned by another work order. Re-upload the image from the report and generate
> the PDF again. The operations log shows `report_pdf_images_missing` with a
> count, without file names or personal data.

### Status and locking

A submitted report is locked. **Unlock for editing** requires a **Reason for
unlocking** and is an administrator action.

### Customer portal and equipment history

Only submitted, locked reports can be opened. **View report** opens the PDF in
the app, and **Download PDF** creates an attachment. An unlocked report is
unavailable until it is locked again. The customer can **Acknowledge receipt**
and **Request a contact information update**; the latter does not update the
customer card automatically.

The report's units are linked to the customer's equipment. **Service history** on
the asset shows every check with date, result, comments, checkpoints and images.

## Documents

The document library is at `/dokumenter` and is internal documentation with
folders, tags, versions and full-text search.

### Folders and upload

1. Press **New folder**, or **Import folder structure** for a whole folder of
   PDFs.
2. Press **Upload PDF**, choose the **PDF file**, and enter **Title**, optional
   **Description** and **Tags**.
3. Press **Save document**.

Only PDFs are allowed. **Move to folder** and **Add tag** work on several
documents at once. **Delete selected** is an administrator action.

### Tags, search and OCR

Document tags are separate from work order tags. Search **title, description,
file name or tags**, and choose **This folder** or **Whole library**; **Filter by
tag:** narrows further. Text is extracted on upload, and scanned PDFs are run
through OCR. **Index all PDFs for search** fills in missing content.

### Versions and sharing

**Edit** → **Replace file (optional)** creates a new version. Previous versions
are under **Previous versions ({count})** with **Download** and **Restore**.

The library is internal and controlled by **View documents** and **Manage
documents**. To share with a customer, add the file to the customer card under
**More** → **Attachments**; it appears in the customer's **Documents**. Work
order attachments are internal. Reports are shown only when submitted and locked.

## Map, search, notifications and messages

**Map** (`/kart`) shows active work orders grouped by location. Filter by
**Technician**, **From date** and **To date**. **Open in Maps** gives directions.
Markers are placed at the address when geocoded; otherwise the work order is
shown at the customer's city.

**Search** (`/sok`) finds customers, work orders, equipment, contacts, reports,
comments, employees, checklists, folders and documents. Use the top bar,
**Ctrl+K** (⌘K on macOS) or **/**. Enter at least two characters. **Best
matches** appears first, **See all ({count})** opens the full list, and
**Filters** narrows by type, status, customer, technician, date, tag and HMS
type. Search is fuzzy and tolerates typos; document hits open the document in
the library. **Save this search** stores a saved search.

**Notifications** (`/varsler`) shows **{unread} unread of {total} total**,
**Unread only** and **Mark all as read**. The types are **Assignment**, **Date
change**, **Cancellation**, **Report**, **Booking**, **Service agreement**,
**Overdue** and **Contact update**. **Settings** lets you choose **In app** and
**Email** per event, and turn **Notification sound** on or off.

**Messages** (`/meldinger`) collects SMS conversations. Filter on **All** or
**Unread only**, search by customer, contact or work order, and **Start
conversation** from a work order. **Quick messages** sends
**Send booking confirmation**, **Send reminder**, **Send on my way**,
**Send completed** or **Request review**. **Consent and opt-out** shows
**Consent registered** or **Not registered**; without consent no SMS is sent.
Each outgoing message shows **Status** (Queued, Sent, Delivered or Failed).
Threads are scoped to your department; portal users see only their own.

An administrator can configure **Automatic reminders** under **Settings → SMS**.
Rules send SMS, email or both a chosen number of hours before the visit, with
quiet hours and a maximum per visit. **Recent reminders** shows what is planned,
sent or skipped — without the message text.

## Customer portal from the office

The customer sees **My Company: {customerName}** and the tabs **Overview**,
**Bookings**, **Reports**, **Documents**, **Equipment**, **Contracts**,
**Visits**, **Messages** and **Contact**.

1. Open the customer card → **More** → **Portal users**.
2. Press **Create and send invitation**, and enter name, email and contact.
3. Send the invitation; the user sets a password.
4. Press **Activate** once the password is set.

**Deactivate** revokes access immediately. A portal user must be linked to a
contact at the same customer.

**Bookings** shows requests and confirmed appointments. **Reports** lets the
customer acknowledge. **Documents** shows files you have shared through the
customer card's **Attachments**. **Equipment** shows status, warranty, latest
reading and plans. **Contracts** shows service agreements and coverage lines.
**Visits** shows tracking links and reviews. The tracking page shows the planned
time when the technician has not shared a location, and a live ETA only when the
latest position is fresh (under ten minutes). If the position is older, it says
explicitly how old it is; the page never pretends an old ping is live. The ETA
refreshes automatically every 30 seconds. **Messages** lets the customer reply by
SMS with consent.

The customer can **Book an available time**, **Request a new time**, **Cancel
request**, **Acknowledge receipt** and **Request a contact information update**.
Booking and cancellation notify the office; contact updates must be made manually
on the customer card.

## Daily and periodic routines

**Morning:** Check **Overdue**, **Today**, **Unassigned**. Assign anything that
is without a technician today, and check double bookings and visits without a
technician.

**During the day:** Follow **In progress** and **Overdue**. Move visits in the
calendar, use dispatch for sickness or urgent work, and answer customers in
**Messages**. Register consent before sending SMS.

**End of day:** Check that today's work orders are **Completed** or have a
follow-up. Review **Unsigned reports**, check tomorrow's visits, and clear
**Bookings** and **Notifications**.

**Weekly:** Review **Overdue** and **Unassigned**, next week's **Capacity**,
**Expires within 60 days**, **Reports** with **Deviations only**, and customer
portal users.

**Monthly:** Review expired agreements and agreement lines. Deactivate portal
users who have left, and review equipment without readings or with expired
warranty. SLA policies, business hours, holidays and price lists are managed by
an administrator; ask for changes when needed.

## Customer transfer (administrator only)

The **Customer transfer** tab is under **Settings** and is shown only to an
active administrator who also has **Manage settings**. Office staff,
technicians and portal users get `403` even if they call the route directly. The
tab moves one or more customers between installations; it is not a backup.

**Export**

1. Open **Settings → Customer transfer**, search for the customer and tick it.
2. Choose whether files, revision snapshots, deleted rows and legal hold should
   be included. Signature images are off by default and require a documented
   assessment.
3. Read the personal-data notice and tick the confirmation.
4. Select **Start export**. You get a ZIP with `manifest.json`,
   `checksums.sha256`, data files and files. The package is available for 24
   hours and can only be downloaded by you.
5. Optionally verify manually with `sha256sum -c checksums.sha256`. The
   checksums detect corruption but do not prove who created the package.

The package never contains passwords, password hashes, 2FA secrets, sessions or
API keys. Portal users follow as metadata and are imported deactivated without
a password.

**Import**

1. Upload the ZIP. The server validates structure, checksums, file types and
   references, and shows a preview. Nothing is written yet.
2. Review counts, warnings and errors. Errors block the import. For conflicts,
   choose **skip** (default), **create new** or — for customer and equipment —
   **update**. Reports are never updated.
3. Tick the confirmation and select **Import the package**. All rows and files
   are written in one transaction; if anything fails, the database is unchanged
   and temporary files are cleaned up.
4. After import, each portal user has a new id, is deactivated and has no
   password. Send a normal invitation or reset the password before sign-in.
   Employees and templates are never created automatically.

**Repeated attempts and errors:** export is idempotent. The same administrator,
the same customer selection and the same choices within ten minutes reuse the
same job instead of starting a new one, so a double click does not consume
another attempt. There are at most 10 export starts per hour; exceeding the
limit gives a clear message to wait. Errors are stored on the job and shown in
the interface, so you can correct the cause and try again without guessing. The
preview is valid for 30 minutes; if the package or selection changed since it
was shown, upload and preview again. Import errors block writing, and an
aborted import rolls back the whole transaction and cleans up temporary files.

**Limits:** the package is limited to 500 MiB and 50 MiB per file, and the
export runs synchronously. Global documents without a customer or unit owner
are not included. Signatures, SLA clocks, bookings, notifications, SMS,
tracking and report drafts are deliberately excluded. See
`docs/backlog-customer-export-import.md` for the full list.

## Interface with the technician and administrator parts

| The office does | The technician does | Where it is described |
| --- | --- | --- |
| Creates work orders with customer, contact, equipment and checklists | Takes the work order, opens the form and completes checkpoints | Technician part (Part 2) |
| Plans a visit with date, time and technician | Starts driving, marks **On site**, completes | Technician part |
| Reads reports, deviations and signatures | Signs, attaches images, submits the report | Technician part |

The administrator part describes **Employees & Roles**,
**Roles & permissions**, **Departments**, **Checklists / Templates**,
**SLA and business hours**, branding, API keys, audit log, legal hold and
restoration. See the administrator part (Part 3).

## Common mistakes and troubleshooting

| Symptom | Common cause | Do this |
| --- | --- | --- |
| Cannot find the work order | Wrong department, view or filter | Reset search/filter, check department |
| Cannot assign | Missing **Assign technicians**, locked or legal hold | Request permission, or reopen as administrator |
| Drag and drop did not change the date | Drag and drop assigns a technician | Move the visit in the calendar |
| Calendar is empty | No visits, filter or outside ±6 months | Reset filter, choose **Today**, check visit |
| Overlapping visit | Technician has several jobs at the same time | Check capacity and move one of the visits if needed |
| Report is locked | Submitted report | Ask an administrator to **Unlock for editing** |
| Customer cannot see the report | Not locked, or missing portal/document access | Lock the report, check portal user |
| Customer cannot book | Missing contact, active user or available time | Check contact, user, 24 hours and available time slots |
| SMS is not sent | Missing consent, phone, quota or dry run | Register consent, check number/settings |
| Agreement creates no work orders | Paused/expired, future start or job not running | Activate, check start date and job |
| SLA is not shown | No active policy | Link a policy to the agreement or department |
| Price list does not invoice | Reference data | Invoice outside the platform |
| Attachment is not in the portal | Work order attachments are internal | Add the file to the customer card → **More** → **Attachments** |
| Unit cannot be moved | Active contract lines, number conflict, cross-customer reference or invalid target | Read the blocker in the preview, clear the contract line, or choose the right customer/site |
| Upload is rejected | File too large, user/customer quota reached, or proxy limit | Check file size, `UPLOAD_QUOTA_*`, disk and the proxy body limit |
| Customer transfer does not start | 10 starts per hour used up, an existing job is reused, or the preview expired | Wait, follow the existing job, or upload and preview the package again |
