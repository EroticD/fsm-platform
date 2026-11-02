# Office: planning, dispatch and follow-up

This chapter is for office staff: you receive enquiries, create and plan work
orders, assign technicians, follow up reports and keep customer, equipment and
agreement data up to date. It applies to FSM Platform 0.8.5 (31 October 2026).

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
An overlap gives **One or more technicians are already assigned to an
overlapping visit.**

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

### Attachments, comments and completion

**Attachments** accepts images and PDFs, up to 15 MB per image and 50 MB per PDF, and is internal.
**Comments** are the dialogue between office and technician; write in the field
and press **Add comment**.

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

**Edit asset** changes the same fields.

The statuses are **Active**, **Out of service** and **Retired**; criticality is
**Critical**, **Normal** or **Low**. **Parent asset** builds a hierarchy, and
**Move in hierarchy** changes placement.

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
**Week**, **2 weeks**, **Week (time)**, **Day**, **Dispatch**, **Capacity** and
**Reports**.

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
about the overlap.

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

**Assignment rules** and **Territories** are configured under **Settings →
Dispatch**. There you choose a **Mode**, adjust the **Weights** for **Skills**,
**Distance**, **Travel time**, **Free time**, **SLA** and **Load**, and add
territories with **Postal prefixes**, **Municipality codes** and **Radius (km)**.
**Capacity plans** are shown in the capacity view but are not edited in
**Settings** in 0.8.5. The same applies to skills, absence and working hours:
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

The customer books in the portal. Available times are 30-minute slots up to 60
days ahead, with at least 24 hours' lead time. Working hours, absence, visits and
unconfirmed reservations are deducted; the default is at most three suggested
slots per technician per day. If working hours are missing, the department's opening hours
are used, then weekdays 08–16. A selected time is held for five minutes while the
customer completes the form.

A customer booking already creates a work order; there is no separate **Convert
to work order** button. New bookings are confirmed directly. Older **Pending**
requests become **Planned** with a visit when you confirm them.

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
technician**. **Download PDF** creates the PDF; **Close PDF** goes back.

A report can have a **Technician** and a **Customer** signature. Photos are added
per checkpoint or unit. Deviations appear as **Deviation found**. When a report
contains at least one deviation, the system automatically creates **one undated
remediation work order** titled “Utbedring av avvik – …”. It inherits customer,
department and contact, gets the submitter as technician, and describes the
units and checkpoints. The generated title is Norwegian (“Utbedring av avvik –
…”) in 0.8.5, even when the interface is English.

### Status and locking

A submitted report is locked. **Unlock for editing** requires a **Reason for
unlocking** and is an administrator action.

### Customer portal and equipment history

Only submitted, locked reports can be opened as PDF; an unlocked report is
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
**Messages** lets the customer reply by SMS with consent.

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
| Overlapping visit | Technician is double-booked | Move the visit or choose another technician |
| Report is locked | Submitted report | Ask an administrator to **Unlock for editing** |
| Customer cannot see the report | Not locked, or missing portal/document access | Lock the report, check portal user |
| Customer cannot book | Missing contact, active user or available time | Check contact, user, 24 hours and available time slots |
| SMS is not sent | Missing consent, phone, quota or dry run | Register consent, check number/settings |
| Agreement creates no work orders | Paused/expired, future start or job not running | Activate, check start date and job |
| SLA is not shown | No active policy | Link a policy to the agreement or department |
| Price list does not invoice | Reference data | Invoice outside the platform |
| Attachment is not in the portal | Work order attachments are internal | Add the file to the customer card → **More** → **Attachments** |
