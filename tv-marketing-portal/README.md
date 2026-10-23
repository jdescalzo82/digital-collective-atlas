# Production Portal

Project tracking, onboarding, ticketing and hands-off time logging for a TV / entertainment marketing post house.

One **“Go to…”** menu at the top takes each person to the right part of the portal, and it only lists the sections they have access to.

## Run it

Requires Node 22.13 or newer. There's no build step and no external database, since SQLite is built into Node.

```bash
cd tv-marketing-portal
npm install
npm run demo     # with sample clients, projects, people and tickets
# or
npm start        # empty system, just the dropdown lists and an admin login
```

Open http://localhost:3000 and sign in as `admin` / `admin`. Set `ADMIN_PASSWORD` before the first run to choose a different password.

Demo logins (password `password`): `maya` (producer, editorial manager, can see financials), `sam` (AE lead), `jo` (assistant editor), `leo` and `priya` (editors), `rae` (finishing lead), `dev` (mixer), `hr`, `it`.

| Setting | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/portal.db` | SQLite file. Back this file up. |
| `ADMIN_PASSWORD` | `admin` | Password for the first admin account |
| `ANTHROPIC_API_KEY` | (none) | Turns on importing from screenshots, photos and PDFs |

`npm test` runs the API tests: billing codes, permissions, timers, unarchive, cut-down, finishing, project kill, HR→IT handoff, scanning and import.

## What's in it

### 1. Onboarding (databases)
| Portal | Highlights |
|---|---|
| **Personnel** (Rolodex) | Contact details, emergency contact, title, department, staff/freelance, rate and frequency (only HR and people with financial access see these), start/end dates, projects they're on, equipment needed. Taggable. |
| **Clients** | Point of contact, department, sector, accounting contact, optional birthday, notes, and a unique **billing prefix**. The detail page shows the client's full project history with ticket counts and hours. When a client is tagged on work, only the client's name is shown. Taggable. |
| **Project titles** | Official name, code name, client, estimated start, lock and final delivery dates, producer, and scope of work (multi-select). **Budget, estimated cost and differential** are visible only to users with `view_financials`. Projects can be put on hold, completed, **cancelled or killed**. |
| **Accounts** | Clients and projects in one filterable view, with billing numbers. A billing number is `CLIENTPREFIX-DEPTCODE-0001` (for example `NOVA-ED-0001`), numbered in sequence per client and department and generated automatically. |
| **Physical media** | Item number (barcode), name, media type, project, location, and associated tickets. Taggable. |
| **Equipment** | Item number (barcode), name, type, model, year, model number, serial number, specs, and assigned person. Taggable. |
| **Import** | Upload a CSV, TSV or JSON file, or paste rows. Screenshots, photos and PDFs are read by Claude when `ANTHROPIC_API_KEY` is set. Every row appears in an editable preview, and nothing is saved until someone clicks Import. |

Every standardized field is a dropdown. Admins manage the lists under **Admin → Dropdown options**, including each department's billing code.

All records are linked rather than copied. If you rename a person, change a project's producer or edit a client, every board, ticket and report shows the change right away.

### 2. Tickets
Requests start from **New request** (the entry switchboard). You pick a project, and its client, producer, dates, billing numbers and media fill in automatically. Every field can still be changed by hand, and you can pick a billing number from another project.

| Board | Statuses | Clock runs during |
|---|---|---|
| **Assistant editor** (categories: Ingest, Cue Sheets, Screeners, Clip Pulls, Creative, Preps, Other) | Draft, Queued, In Progress, On Hold, Out for Approval, Completed | In Progress |
| **Editorial scheduling** | Draft, Scheduled, In Progress, On Hold, Out to Creative Review, Out for Client Review, Out for Legal Review, Applying Client Notes, Applying Legal, Out for Final Approval, Final Notes, Final Lock, Shipped, Ready for Backup, Archived | In Progress, Applying Client Notes, Applying Legal, Final Notes |
| **Finishing** (separate tracks for picture and sound) | Each track: Prep Requested, Prep In Progress, Ready for Review, Ready for Delivery, Prep Sent, Ready to Review, Under Review, Approved, On Hold, Completed | Prep In Progress, timed separately for each track |

- **The flow:** a new request lands as **Draft**, and the managers of that board are notified. They assign it from **Needs assignment** or from the ticket itself. The ticket then moves to the assignee's queue (Queued on the AE board, Scheduled on the editorial board), and the AE board can show one section per assignee.
- **Time tracking:** the clock starts when the status becomes a "working" status and stops on hold, during any review, and when completed. Time entries can be added or corrected by hand only while the clock is stopped, and hand edits are marked as edited.
- **Ticket page:** a **project wall** with the brief, media and tags, then a **message board** for review links, approval requests and notes. Each post has a status column (Pending, Approved, Changes Requested and so on), and tagging someone sends them a notification.
- **Editor booking** runs from the start date to final lock **plus 2 days**. The **Editor schedule** shows this as a timeline and flags double bookings.
- **Unarchive** (in the status menu) creates a new Draft named `Unarchive - <name>` with all the details. The original keeps its status.
- **Cut-Down** (in the status menu) asks for the new duration, then creates a Draft named `Cut-Down :15 - <creative>`. It keeps the billing number and links back to the original, but leaves out the rest of the project details.
- **Request finishing** (a button on editorial tickets) builds a finishing ticket from the editorial one, linked to it. The picture and sound statuses then show on the editorial ticket. The finishing ticket bills to the project's Finishing billing number if one exists, and otherwise to the editorial one.
- Every ticket carries a billing number. Killing or cancelling a project closes its billing numbers, cancels its open tickets and stops their clocks.

### 3. People ops
- **HR board:** HR verifies each record, confirms dates and pay, and then clicks **Send to IT**, which notifies IT.
- **IT board:** IT sees everything except pay and HR notes, and records the system, software, hardware, workstation location and accounts it set up.

### Barcode scanning
Use **Scan a barcode**, or the 📷 button next to any item-number field, to scan with a phone camera. The browser's built-in BarcodeDetector is used where it exists (Android Chrome); other browsers, including iPhone Safari, use the bundled ZXing library. **Phone cameras only work over HTTPS**, so put the portal behind HTTPS (a reverse proxy or your hosting provider) before scanning from phones. USB and Bluetooth handheld scanners work everywhere because they type into the field like a keyboard. Scanning an unknown number offers to register it as new media or equipment.

## Permissions
Assign these per user under **Admin → Users & permissions**:
`admin`, `onboarding`, `view_financials`, `manage_ae`, `manage_editorial`, `manage_finishing`, `hr`, `it`, `import`.

Link each login to its personnel record. That link is how the portal knows which tickets are "mine" and whose time is being logged.

## Code map
```
server/
  index.js      start-up
  db.js         SQLite schema
  workflow.js   statuses, timed statuses, default dropdowns, permissions
  services.js   business rules (billing numbers, timers, assignment, unarchive, cut-down, finishing, project kill)
  app.js        HTTP API
  importer.js   CSV/JSON parsing and Claude extraction for screenshots and PDFs
  seed.js       first-run setup and demo data
public/          front end (plain JavaScript modules, no build step)
test/            API tests (node --test)
```

## Next
- Reports panel (planned as the next phase)
- Printing barcode labels for newly registered items
- Email or Slack delivery of notifications (they currently appear in the portal)
