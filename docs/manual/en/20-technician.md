# Technician

The field app for the **Technician** role: sign-in, My work orders, work order details, checklists, units, offline drafts and submission. Version 0.8.9 (2026-11-04).

The bottom bar has **Today** (`/mine-oppdrag`), **Work orders**, **Notifications** and **More**. **More** opens the same menu as the hamburger button at the top. Language, notification sound, reports, customers/equipment and settings are in that menu.

## First time: sign-in, 2FA and language

### Sign in

1. Open `/logg-inn`.
2. Enter **Email** and **Password**.
3. Select **Log in**.

You land on **Today**. A wrong password gives “Wrong email or password.” An account that has not been activated gives “Your account has not been activated yet. An administrator must activate it before you can log in.”

The session normally lasts 12 hours. Local drafts remain when the session expires, but are not sent until you sign in again.

### Two-factor authentication

2FA is optional but recommended. If enabled, you go to `/logg-inn/2fa` after your password.

1. Open your authenticator app.
2. Enter the 6-digit **One-time code** for the company.
3. Select **Verify**.

If you get “Incorrect one-time code. Try again.”, wait for the next code. If you have lost your phone, select **Sign in with a recovery code**, enter one of the codes you saved when you enabled 2FA, and select **Sign in with code**. An administrator can reset 2FA.

You cannot change your password in the field app. Sign out and use **Forgot password** on the sign-in page, or ask an administrator to send a new link. 2FA and recovery codes are managed under **Settings → Security**.

### Change language

1. Open **Menu** with the hamburger button at the top, or select **More** in the bottom bar.
2. Scroll to the bottom. **Change language** is there.
3. Choose **Norsk**, **English**, **Polski** or **Deutsch**.

The choice is stored in the `NEXT_LOCALE` cookie and takes effect without changing the URL. Dates and numbers follow the language. The fixed labels in the report PDF remain Norwegian in 0.8.9.

### Install the field app (PWA)

The field app is installable. It opens in its own window, starts at `/mine-oppdrag` and is locked to portrait orientation.

- **Android/Chrome:** Browser menu → **Install app** or **Add to Home screen**.
- **iPhone/iPad/Safari:** Share icon → **Add to Home Screen**.
- **Chrome/Edge on desktop:** The install icon in the address bar, or the menu → **Install**.

There is no separate “Install” button inside the app. Installation uses the manifest and requires HTTPS. The service worker is registered in production builds only.

### Scan QR and barcode

1. Select **Scan** on **Today**, in the top bar or in the menu.
2. Select **Start camera** and allow camera access the first time.
3. Hold the QR code on the equipment label steady inside the frame. The app opens the unit or work order if you have access.
4. If the camera does not work, enter the code in **Code or reference** and select **Look up**. You can paste the full link from the label.

The camera requires the app to be opened over **HTTPS** (a secure address). On a plain `http://` address, such as a LAN address during development, the browser blocks the camera and the app shows a separate HTTPS message. Use the installed app or the `https://` address in production.

- **iPhone/iPad (Safari):** Allow camera access when Safari asks. If you declined, go to **Settings → Safari → Camera** (or **Settings → the app**) and choose **Ask** or **Allow**. Camera scanning works in iOS Safari even without the browser's built-in barcode API; the app then uses a fallback scanner.
- **Android (Chrome):** Select **Allow** on the camera prompt. If you declined, open the lock icon by the address → **Permissions** → **Camera**, or **Settings → Apps → Chrome → Permissions → Camera**.
- **Camera is busy:** Close other apps that use the camera and select **Start camera** again.
- **The code is not read:** Hold the label steadier, avoid backlight and make sure there is enough light. The app keeps looking and shows a separate message if the image cannot be decoded.

If the browser has no camera support at all, a message says so – but on iPhone and Android the fallback scanner should be available as long as the app runs over HTTPS and you have granted camera access.

The app accepts unit QR codes, unit IDs, work order references (for example
`O-261103-ABCD1234`) and order numbers. An unknown code, missing access and
repeated scans give an explanation instead of opening the wrong page. Access
is checked again on the server; a scan never grants more access than you
already have.

If the customer already has QR labels from another system, they work too: the
office registers the existing value under **Existing QR codes** on the unit.
You scan the label the same way as our own, and the app opens the unit if you
have access. The value is an opaque string – the app never follows a link or
fetches content from the internet.

### Before you lose the network

1. Open **Today** and every work order you will perform.
2. Open every report form you need, so the page enters the offline cache.
3. Wait until the draft status shows **draft saved**.
4. Take and upload photos while online; a required photo field is not complete until the photo is uploaded.
5. Open any report PDFs you need while online.
6. Do not clear browser or app data.

The page cache lasts eight hours; local drafts last seven days.

## My work orders / Today

`/mine-oppdrag` is the home screen. At the top you see your name, **On duty**, **Online** or **Offline**, today's date, the number of jobs today, the number of **Overdue** jobs, and an estimated route distance when today's work orders have coordinates. If coordinates are missing, it says **Calculating route** or nothing – the app does not invent a distance.

The search field searches title, description, order number, customer name, city, address and contact person. **Search** runs it; **Reset** clears it.

### Next job

The **Next job** card shows the first remaining job today, or the next upcoming job if today is empty. It shows the date and the status of today's session, title, customer, order number, address, contact person, **Job 1 of N**, and **Start form**, **Continue form** or **Open job**, **Call** and **Map**.

**Start form** opens the first checklist without a locked report. **Continue form** is used when a draft or unlocked report exists. If the work order has no template, the button says **Open job**.

### Overdue, available and later

- **Overdue** shows your open work orders with a scheduled date before today, oldest first.
- **Available** shows open work orders without a technician. With update permission, each card gets **Take work order**; you are assigned and see “Work order claimed and now under your work orders.” Without permission the button is hidden. Completed or cancelled work orders cannot be claimed.
- **Later today** shows the rest of the day, **Today's route list** shows the full list, and **Completed work orders / History** shows completed jobs with **Show more**.

### Job cards and status chips

The card shows title, status chip, customer, order number, contact, address, tags and date. A draft shows **Draft 14:32 · Continue**. **Call** and **Map** start the phone or Google Maps without opening the work order.

| Chip | Meaning |
| --- | --- |
| **Open / New** | Created, not planned or started |
| **Waiting to be planned** | The system's starting status; not selected manually |
| **Planned** | Has a planned date and workday |
| **In progress** | Work is underway |
| **Waiting for customer** | Work is waiting for the customer |
| **Completed** | Closed and locked |
| **Cancelled** | Closed; not shown in the field app |

### Notifications

The **Notifications** tab in the bottom bar opens `/varsler`, with **Unread only**, **Mark all as read**, **Mark as read** and **Open**. The bell at the top shows the unread count. In the menu you can turn notification sound on or off with **Turn on notification sound** / **Turn off notification sound**.

### No jobs?

If it says **No active work orders in your calendar right now**:

1. Select **Reset** if a search is active.
2. Select the refresh icon at the top.
3. Check **Available** – there may be work orders you can take.
4. Check that you are in the right department; department scoping hides other departments' work orders.
5. Contact the office if the job is missing a technician or has the wrong date.

## Work order details

Open a card to reach `/mine-oppdrag/<work-order-id>`. At the top is a dark job panel with status chip, title, customer, address, department, order number, planned date, assigned technicians, contact person and checklist count.

### Customer, contact, address and map

**Quick actions** give you **Call contact**, **Map**, **Customer**, **Equipment** and **Documents**. **Call contact** uses the work order contact first, then the customer contact or main phone. **Map** opens the device's map app: Apple Maps on iPhone/iPad, Google Maps or the chosen map app on Android, and Google Maps in the browser on a desktop. It uses coordinates when available, otherwise a URL-encoded address, and is hidden when both are missing.

**Copy address** puts the full address on the clipboard. **Location and contact** shows the full address, company phone, the work order contact and the customer's other contacts with phone and email. If data is missing, it says **Not provided** or **No specific contact person is registered on this work order or customer.**

### Today's session: en route, on site, done

The session card shows **Today's session** or **Next session** with date, status and technicians. Each calendar day is one session; a multi-day work order continues on the next day even when today is done. The flow is **En route** → **On site** → **Done**. Each tap records the time on the server. Tap only when you actually start driving, arrive or finish.

After **Done** the card shows **Finish travel** until the return travel is finished. Then the day is locked and it says **The day is finished.** The next day's session can be started with **En route** even while an earlier day is still waiting for **Finish travel**; the previous travel segment is then closed automatically.

The card shows today's **Travel to**, **Work**, **Travel from** and **Total** time, plus total time for the whole work order with the breakdown. **Days** lists every workday in the work order with status and time, so you can see which days are completed and which remain. A completed day that still needs **Finish travel** has the button in the day list.

With live tracking enabled, you can share your position while **En route**: **Share position** / **Stop sharing**. The position is deleted after 24 hours.

### Status, work description and comments

**Work order status** lets you choose a new status and select **Update**. **Complete** requires confirmation: “Complete this work order? The work order and report are locked for editing.” Cancellation is under **More actions** for roles with edit permission. Completed work orders are locked; reopening is done by an administrator.

**Work description / Instructions** is shown as Markdown. **Comments and updates** is a Markdown log: **Write comment** → **Add comment**.

### Attachments, personnel and history

**Attachments** handles photos and PDFs via **Add files**. Files upload one at a time; if one fails, its name is shown and you can try again.

**Assigned personnel and office** show who is on the work order. **Remove me** removes you, with **Undo** in the toast. **Add a colleague or office for follow-up** is used when someone else needs to see or take over.

**Activity log** shows status changes, assignments, comments, reports and locking. Service history lives on the individual unit; see “Units at the top of each checklist”.

### Checklists and reports

**Checklists for the work order** lists every template, with HMS type, **Report no.** when one exists, **Locked**/**Unlocked**, **Fill in form →**, **Edit** when unlocked for correction, and **View report (PDF)** when a report exists.

The progress ring shows answered checkpoints, deviations and draft status. **Do you need an extra form?** adds a template you have access to; otherwise the office must do it.

If it says **No checklists are linked to this work order yet**, you cannot fill in anything until the office adds a template.

## The report form

The form opens at `/mine-oppdrag/<work-order-id>/skjema/<template-id>`.

The fixed step strip shows **Checkpoints**, **Photos** and **Sign**, plus draft status and **Save draft now**.

### Locked report and draft restore

If the report is submitted and locked, the page shows **The report is locked**. You can open **View the report (PDF)** or go back. Only an administrator can unlock it for correction.

If a saved draft exists, the form opens with the fields as you left them, and you see “📝 A saved draft has been restored with all fields as you left them.” A submitted report is never overwritten by a local draft.

### Units at the top of each checklist

Each unit is a block; details sit at the top:

- **Get from the customer equipment** – choose a registered unit; designation, serial number and location are filled in.
- **New unit (not registered before)** – when the equipment is not on the customer record.
- **Designation** \* – required; enter what you see, for example “North gate”.
- **Serial number** and **Location** – optional, but important for history.

A linked unit shows **🔗 Linked to a registered unit on the customer record**. A new unit with a name shows **＋ Saved as a new unit for the customer**. On submission, the unit is created or reused on the customer.

**Each registered unit can only be used once in the same report.** A duplicate choice is rejected with “This unit is already selected in another unit row. Choose a different unit.”

**Add unit** adds a row; **Remove unit** confirms and deletes its checkpoints. Use **New unit** only for new equipment, not to bypass the duplicate check.

Units provide service history, the customer's equipment list, the office overview and the basis for QR labels.

### Checkpoints

Each checkpoint comes from the template:

- **Status choice** – OK / Deviation / Correction needed / Not applicable. A follow-up choice opens a required comment: “💬 Comment for “…” – required”.
- **Checkbox** – must be checked when required.
- **Free text / text area** – the text area supports Markdown.
- **Number, date and dropdown** – ordinary required fields.
- **Photo** – **Take photo** / **Choose photo**. Compressed and uploaded immediately; offline they stay **Ready to upload** or **Upload failed** and retry when online.
- **Signature** – a text field where you enter your full name.

Fields marked `*` need a real value; a checkbox must be checked and a photo field needs an uploaded photo.

**Conditional fields** appear only when another field has a specific value. If you change the source, the field may disappear. Answer every visible required field; hidden fields are not required.

Follow-up shows “One checkpoint requires follow-up” or “{count} checkpoints require follow-up”. If the unit is still **Approved / done**, the app asks you to confirm, and you can select **Set the result to “Deviation found”**.

Photos are evidence: photograph the deviation, meter, damage or completed correction.

### Signatures

**Signatures** at the bottom are optional – technician, customer or both. Draw with a finger or mouse, use **Full screen**, and **Clear** to start again. **Technician** is pre-filled with your name; **Customer** with the work order contact.

An earlier signature is kept if you do not sign again: **Kept if you do not sign again.** If you enter a name, it must be one of the work order's contact persons or technicians. Otherwise submission is rejected with “The signer name must be one of the work order's contact persons or technicians.”

### Markdown in notes and comments

Free-text fields, unit comments, general notes and work order comments use Markdown. The toolbar has bold, italic, strikethrough, highlight, heading, lists, task list, quote, callout, code, link, table, footnote and hidden comment. **Preview** shows the result.

Markdown is sanitised on the server and rendered the same way in the browser and the PDF. Use **General notes for the job** for the overall picture, and **Comment for this unit** for what applies to one unit.

### Mobile swipe-to-complete

On mobile you can approve a unit with a swipe:

1. Swipe **right** on the unit header. You see a percentage and **keep swiping**.
2. At the threshold it says **Release to complete**.
3. Release. The unit is set to **Approved / done**.

The swipe requires 84 pixels; vertical movement scrolls and cancels. The fallback **Complete unit** button is at least 48 pixels high and does the same.

After approval you get **Undo** for three seconds: “Unit N is approved. Undo is available for 3 seconds.” **Undo** restores exactly the previous status.

Swipe and button are blocked when the unit is **Approved**, set to **Deviation found**, missing **Designation**, missing a required answer, photo or checkbox, or has a status choice that requires follow-up (“Cannot complete: “…” is set to “…”. Use the Approved/Deviation options.”).

Therefore a quick gesture cannot approve an incomplete or deviating unit. The swipe uses the same validation as the form and the server.

## Submit and sign

### Review

**Sign and submit report** opens **Sign and submit the report?** with **Units: N**, **Deviations: N**, **Photos: N**, **Signatures: technician … , customer …**, and **When you submit, the report is locked and cannot be changed unless an administrator unlocks it.**

Clear **Mark the work order as completed** if the work order should stay open. It is checked by default and sets the work order to **Completed** on submission.

Select **Sign and submit report**, or **Back to the form** to correct something.

### Submission requirements

Submit when online, the template belongs to the work order, you have `reports.write` in the right department, and the report is not locked or under legal hold. When the template requires units, the report must have at least one unit, and every unit must have a **Designation** and be assessed as **Approved / done** or **Deviation found**.

Answer every visible required checkpoint; upload required photos and check required boxes. The same registered unit cannot appear in several rows. Cancelled work orders cannot be completed by technicians. Any signer names must be people linked to the work order.

A signature is optional; the report can be submitted without one. If an administrator has unlocked the report, it locks again automatically when you save.

### After submission

The server confirms with **The report has been submitted and locked**, **Open report (PDF)**, **Open work order** and, in the field app, **Next assignment**.

The report is locked, local draft and outbox entries are cleared, and the form page leaves the offline cache. The office sees the report, the customer can see the submitted report and acknowledge it, and the units update service history. If the report has deviations, one undated remediation work order is created with you as technician.

If **Mark the work order as completed** is checked, the work order is set to **Completed** in the same transaction. Correction requires an administrator to unlock the report with a reason. A new submission creates a revision and resets any customer acknowledgement.

### PDF in the app or as a download

**View report (PDF)** opens the report in the app's own PDF viewer. There you can
scroll, zoom and close without leaving the work order. **Download PDF** creates a
file you can send or save. A direct link to the PDF route always downloads,
because only the app's own viewer asks for inline display.

The PDF is sanitised before it is shown. If it contains active content that
cannot be removed safely, the viewer shows an error with **Try again** and
download instead of opening anything unsafe. The report data and the lock are
unchanged. If an image or signature is missing, the PDF shows a warning with the
number of images that could not be loaded; re-upload the image from the report
and generate the PDF again.

Open any PDFs you need while online. PDF viewing requires a connection, and a
direct download should be made before you lose coverage.

## Offline, drafts and the outbox

### Autosave

The form saves locally about 200 ms after a change, on the server after about 1.2 seconds, when the tab is hidden or closed, and on **Save draft now**.

The local draft contains units, answers, conditions, notes, names and signatures, and survives network loss, tab closure and restart. The server draft follows the user to another device. If the local draft is newer, it is restored when the form opens.

Drafts are per user, work order and template, and expire after seven days.

### The offline banner

The banner at the top is visible when you are offline or have pending drafts:

- **📴 You are offline – drafts are stored on this device and sent when the app is open and the network returns**
- **📴 Offline · {count} draft(s) waiting**
- **📤 {count} draft(s) waiting to sync**
- **⚠️ {count} draft(s) could not be sent**
- **🔄 Syncing drafts …**
- **✓ {count} sent**

**Open the draft list** goes to `/offline.html` with stored pages, drafts, failed sends and **Discard my drafts**.

### Outbox and background sync

Only the newest draft per report is kept. The outbox is the browser's local send queue, the payload is the content sent to the server, and backoff is the waiting time between retries.

- **Chromium** can use Background Sync: the browser wakes the service worker and sends even without an open tab.
- **Safari/Firefox** do not support Background Sync. Drafts are sent when the app is open and the network returns, when the tab becomes visible, or by the 30-second timer. Keep the app open until **✓ sent**.

Backoff runs 15 seconds to 30 minutes, maximum 10 attempts, then terminal **could not be sent**. Payloads over 2 MB are rejected; 400/413 are terminal; 429/5xx stop the queue and back off.

### 401/403 and expired sessions

A 401/403 means the session or access is gone, not that the draft is broken. The service worker stops replay, page caches and the offline marker are cleared, and the draft/outbox entry is kept. Sign in again, then select **Send now** or save the form. A 403 can also mean lost permission; the office must restore access.

**Discard my drafts** deletes all local drafts and pending uploads for the user on the device. Use it only when sure, and always on a shared device before leaving.

## Safety and quality in the field

- **Swipe or “Complete unit” is only for fully documented, non-deviating units.** Use **Deviation found** when something is wrong, missing or needs correction.
- **Never approve something you intend to fix later.** “Approved” means checked and in order now; correction belongs in the deviation or a separate work order.
- **Describe the deviation concretely:** what, where, measurement and what must be done. Attach a photo when relevant.
- **Use the recorded timestamps.** Start driving, on site and done are recorded when you tap; do not tidy them up afterwards.
- **Check unit identity.** Correct designation, serial number and location make the history useful; one registered unit is used once per report.
- **Only sign what you have reviewed.** A signature is optional, but the name must belong to a person on the work order.
- **The report locks on submission.** Corrections require an administrator unlock and are logged as a revision.
- **Legal hold stops everything.** A frozen report cannot be submitted or changed.
- **Do not share your sign-in.** Drafts and the page cache are per user; sign out and discard drafts on a shared device.
- **Do not invent time, distance or data.** **Time not set** means the time is not set.

## Common field problems

| Problem | Likely cause | Fix |
| --- | --- | --- |
| **No active work orders** | Search, wrong department, no assignment, or no jobs | Reset search, refresh, check **Available**, ask the office |
| **The report is locked** | The report is submitted and locked | Open the PDF or ask an administrator to unlock it |
| **No checklists** | The template has not been added | Ask the office to add it. If you have access, use **Do you need an extra form?** |
| **Upload failed** | Network, large file, camera/storage | Check network, **Try again**, or use **Choose photo** |
| **Draft waiting / sync stuck** | Offline, expired session, 429/5xx or terminal | Get online, keep the app open, **Send now**. On 401/403, sign in. On **could not be sent**, **Try again** or discard |
| **Wrong or duplicate unit** | Wrong row or duplicate registered unit | **Remove unit**, add the right one. For duplicates, choose another or **New unit** |
| **Cannot submit** | Missing unit, assessment, required answer, photo, checkbox or name; locked; offline; no checklist | Read the message, correct the field, try again. **Missing assessment** means **Approved** or **Deviation** per unit |
| **Cannot complete with swipe** | No name, deviation, or missing required field | Fill in the field, upload the photo, or use **Deviation found** |
| **2FA code fails** | Wrong code, clock drift, used code | Wait for a new code, check the clock, use an unused recovery code, or ask for a reset |
| **Session buttons missing / status locked** | Day or work order closed, or no permission | Contact the office; only open days and work orders can be changed |
| **PDF or offline page missing** | No network, report, access, cache, or active content that cannot be sanitised | Get online, open **View report (PDF)**, download the file, reopen the job online |
| **Image missing from the PDF** | File deleted, missing metadata, or owned by another work order | Re-upload the image from the report and generate the PDF again |

## How technician work connects to the rest

| Area | What you do in the field | Where others see it |
| --- | --- | --- |
| **Office** | Update status, comment, submit reports | `/oppdrag`, `/rapporter`, dashboard, notifications. The office assigns, reschedules and adds templates; an administrator unlocks reports. |
| **Customer portal** | Sign and submit a report | The customer sees submitted, locked reports in `/kundeportal/rapporter`; PDF download and **Acknowledge receipt** |
| **Equipment module** | Choose or create a unit, record serial and location | Service history, timeline, readings, QR label on `/enheter/<id>` and **Equipment** tab |
| **Administrator** | Follow template requirements, use right department and user | Manages **Checklists / Templates**, **Employees**, departments, permissions, 2FA and unlocks in **Settings** |
