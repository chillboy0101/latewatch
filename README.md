<div align="center">

<img src="public/latewatch-logo.png" alt="LateWatch logo" width="96" height="96" />

# LateWatch

**Attendance and lateness management for the Ghana Revenue Authority**

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000000?logo=vercel&logoColor=white)
![Status](https://img.shields.io/badge/Distribution-Internal-6B7280)

[Overview](#overview) · [Capabilities](#capabilities) · [Business rules](#business-rules) ·
[Architecture](#architecture) · [Getting started](#getting-started) · [Operations](#operations) ·
[Security](#security)

</div>

---

## Overview

LateWatch records when staff arrive and leave, applies the office's lateness policy, and keeps
an auditable account of every penalty, payment, pardon and correction. Staff check in from a
mobile web app that verifies the device, location and network they use. Administrators work
from a desktop console covering staff records, attendance, permissions, leave, payments and
reporting.

| Portal | Audience | Purpose |
|---|---|---|
| **Home** (`/`) | Everyone | Entry point to the two portals |
| **Attendance portal** (`/check-in`) | Staff | Check in and out, see penalties and receipts. Installable as a PWA |
| **Admin console** (`/dashboard` and related pages) | Administrators, HR | Run attendance, permissions, leave, payments and reports |

Internal software, operated by the office it serves. Not intended for redistribution or reuse.

---

## Capabilities

### Attendance portal (staff)

- **Verified check-in and check-out** against the office's registered location and network
- **One trusted device per staff member**; moving to a new phone requires an approved transfer
- **Check-in on excused days** is allowed and recorded without a penalty
- **Reminders** by push notification before the sign-in and sign-out deadlines
- **Penalty history** by week, with amounts outstanding, paid and pardoned
- **Payment receipts**, viewable in the app and printable as PDF

### Attendance and permissions (admin)

- **Daily entry grid** for reviewing and correcting sign-in and sign-out times; penalties are
  recomputed on save
- **Permissions over a date range.** Approved late arrivals and excused absences can cover any
  span of days in one step; weekends and holidays in the span are skipped
- **General pardons** for the whole office on a given day (full-day excuse or late-only)
- **Targeted waivers**, each clearing exactly one charge:
  **Waive late fee**, **Waive no sign-in** and **Waive no sign-out**
- **Device health:** trusted devices, transfer requests, reminder delivery and device resets
- **Holiday calendar**, maintained manually or synchronised from Google Calendar

### Staff leave

- **One Staff leave dialog** to approve leave, change its end date or record a return
- **Automatic return:** a staff member on leave who checks in is recorded as back that day
- **Back-dated changes** (returns or end dates in the past) re-apply the normal rules to the
  affected days

### Payments and pardons

- **Payments** recorded against outstanding penalties, with receipts issued to staff
- **Pardon debts:** forgive unpaid penalties up to a date, for **everyone or one person**. The
  dialog shows a preview and needs a two-tap confirmation. The pardon is applied atomically and
  recorded in the audit trail
- **Contributions** and the **monthly offence book**, scoped to the selected month

### Reporting and audit

- **Excel exports:** weekly, monthly, attendance, contributions, lateness summary and offence
  book, generated from stored templates
- **Audit trail** of every change, with who made it and the before and after state

### Personalisation

- **Theme colours:** presets, a colour wheel, and an exact hex field with a screen eyedropper
- **Light, Dark or System** mode
- Saved to the account and applied live across all of a person's devices

---

## Business rules

Penalties are computed by `src/lib/penalty-calculator.ts`. That file is the authority, and this
table is kept in step with it.

| Condition | Charge |
|---|---|
| Arrival after 08:30 | GHC 10 |
| Each further clock hour late (from 09:01, 10:01, …) | GHC 5 |
| No sign-out recorded | GHC 2 |
| No sign-in recorded by 16:30 (from 8 July 2026) | GHC 10 |
| **Maximum for any single day** | **GHC 50** |

- **Working days** are Monday to Friday. Weekends and public holidays never carry penalties,
  permissions or absences.
- **NSS personnel** pay the flat late charge without the hourly increment. **Attendance-only
  staff** are tracked but never charged.
- **Permissions** (late arrival or excused absence) and **leave** remove the charges they cover.
  Waivers remove a single named charge.
- **Pardons** forgive outstanding balances without altering the underlying penalty or payment
  records.
- All dates and times use **Africa/Accra** time; dates are stored as `YYYY-MM-DD`.

---

## Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router) |
| UI runtime | React 19.2 |
| Language | TypeScript 5 |
| Styling and components | Tailwind CSS v4, shadcn/ui, vaul |
| Database | PostgreSQL on Neon, via Drizzle ORM 0.45 |
| Authentication | Clerk 7 (organisation-gated) |
| Validation | Zod 4 |
| Realtime | Ably 2, with polling fallback |
| Push notifications | web-push (VAPID) |
| Request throttling | Upstash Redis, falling back to Postgres |
| File storage | Cloudflare R2 |
| Spreadsheets and PDF | ExcelJS 4, jsPDF 4 |
| Charts | Recharts 3 |
| Calendar sync | Google Calendar API |
| Hosting | Vercel |

### Request path

Every request passes through `src/proxy.ts`, which enforces authentication and organisation
membership. Route handlers and Server Actions then re-check authorisation themselves rather
than relying on the proxy alone.

### Mutation pattern

Write paths follow the same sequence:

1. `requireRole([...])` or `enforceRole([...])`: authorisation
2. Input validation (Zod or explicit checks)
3. Parameterised Drizzle queries, transactional where several rows must change together
4. `writeAuditEvent()`: who changed what, with the before and after state
5. `publishRealtime()`: notify connected clients so their views refresh

Attendance reads are deliberately uncached. Clients stay current through the realtime publish
in step 5. The service worker caches static assets only and never serves `/api/*`.

### Data model

28 tables. The central ones are:

| Area | Tables |
|---|---|
| People | `staff`, `staff_leave_period`, `staff_device`, `device_transfer_request` |
| Attendance | `attendance_record` (one row per staff member per day), `attendance_permission`, `work_calendar` |
| Money | `lateness_entry` (computed penalty), `lateness_payment` with allocations, `lateness_debt_pardon` with its per-entry ledger |
| Platform | `audit_event`, `user_theme_preference` |

### Migrations

Hand-written SQL in `drizzle/`, applied in numerical order (latest: `0034`). A schema change
means a new migration file plus the matching edit to `src/db/schema.ts`.

### Repository layout

```
src/
├── app/
│   ├── api/                 Route handlers (attendance, payments, exports, calendar, account, …)
│   ├── check-in/            Attendance portal (PWA)
│   ├── attendance/          Admin: overview, permissions, devices
│   ├── dashboard/  staff/  entries/  payments/  contributions/  exports/
│   ├── calendar/  emergency-contacts/  audit-trail/  location/  settings/
│   └── (auth)/              Sign-in and sign-up
├── actions/                 Server Actions
├── components/
│   ├── attendance/          Shared attendance dialogs (staff leave)
│   ├── theme/               Theme colour picker, colour wheel, mode menu, account sync
│   ├── ui/                  Design-system primitives (dialog, date field, staff picker, …)
│   └── layout/  brand/  exports/  receipts/  notifications/  auth/
├── lib/                     Business logic (penalties, leave, pardons, sync, audit, …)
├── db/                      Drizzle schema and client
├── attendance-templates/    Excel templates
├── payment-templates/
└── proxy.ts                 Authentication gate
drizzle/                     SQL migrations
scripts/                     Operational and repair scripts
tests/                       Test suite
```

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- A Neon PostgreSQL database
- Clerk, Ably and Cloudflare R2 accounts
- A VAPID key pair for push notifications

### Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

### Environment

Required:

```bash
# Authentication (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# Database (Neon)
DATABASE_URL=
# Prefer the direct endpoint for the app when Neon supplies both URLs.
DATABASE_URL_UNPOOLED=

# File storage (Cloudflare R2)
CF_R2_ACCOUNT_ID=
CF_R2_ACCESS_KEY_ID=
CF_R2_SECRET_ACCESS_KEY=
CF_R2_BUCKET=

# Realtime (Ably)
ABLY_API_KEY=

# Push notifications (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:

# Scheduled reminders: shared secret for the cron endpoints
CRON_SECRET=

# Signing secrets: long, random, and independent of the values above.
# Rotating DEVICE_BINDING_SECRET unbinds every trusted device.
DEVICE_BINDING_SECRET=
ATTENDANCE_QR_SECRET=

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional:

```bash
# Grants admin regardless of Clerk metadata. Treat as privileged configuration.
ADMIN_USER_IDS=
ADMIN_EMAILS=

# Request throttling. Without these the throttle uses Postgres instead.
# The Vercel KV names KV_REST_API_URL / KV_REST_API_TOKEN are also accepted.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google Calendar holiday sync, and the map on the location settings page
GOOGLE_CALENDAR_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Clerk organisation sync
CLERK_ORGANIZATION_ID=
CLERK_ORGANIZATION_MEMBER_ROLE=

# Only needed to run `npm run cronjob-org:reminders`
CRONJOB_ORG_API_KEY=
```

`.env.example` carries the same list with notes. Secrets are managed in Vercel for deployed
environments and must never be committed.

---

## Scripts

```bash
npm run dev              # Development server
npm run build            # Production build
npm start                # Serve a production build
npm run lint             # ESLint
npm test                 # Test suite
npm run load:test        # API load test
```

Operational scripts. **Those marked ⚠ modify live records. Read them before running.**

```bash
npm run clerk:role                              # Assign a user's role in Clerk
npm run clerk:staff-metadata                    # Sync staff metadata into Clerk
npm run clerk:sessions:cleanup                  # Revoke stale staff sessions (dry run by default)
npm run cronjob-org:reminders                   # Register the reminder cron jobs
npm run penalties:recalculate                   # ⚠ Recompute penalties for regular staff
npm run no-signout:repair-waivers               # ⚠ Repair no-sign-out waivers
npm run lateness-debt:pardon                    # ⚠ Pardon historical lateness debt (dry run by default)
npm run attendance:repair-retroactive-no-show   # ⚠ Backfill no-show sign-in penalties
npm run no-show:correct-amount                  # ⚠ Correct no-show penalty amounts
```

---

## Quality

Run before every merge:

```bash
npm run lint
npx tsc --noEmit -p .
npm test
npm run build
```

The test suite (350+ tests, Node's built-in runner) asserts against source files rather than
driving a browser. It checks that pages, routes and libraries contain the behaviour they are
meant to. That keeps it fast and dependency-free. It also means that **moving or renaming a page
breaks its tests**: update those assertions alongside the change rather than deleting them.

---

## Operations

- **Deployment:** pushing to `main` deploys production on Vercel. Other branches and pull
  requests get preview deployments.
- **Scheduled reminders:** an external cron service calls endpoints guarded by `CRON_SECRET`.
  Delivery is recorded per staff member per day, and a unique constraint turns a duplicate run
  into a no-op.
- **Throttling:** write endpoints that trigger outbound work are rate limited per user, in Redis
  when configured and in Postgres otherwise. The check fails open, so unavailable storage can
  never stop a staff member from checking in.
- **Database changes** ship as reviewed migrations applied through the normal release process
  before the code that depends on them.

### Runbook: pardoning debts

**In the app (preferred).** Go to **Payments → Pardon debts** (or a staff member's **Manage →
Pardon**):

1. Choose who (everyone or one person) and the cutoff date.
2. Review the total and the per-staff breakdown.
3. Optionally add a reason, then tap **Pardon** twice to confirm.

The pardon is refused if any debt changed after the preview. Each pardon writes an immutable
event, a per-entry ledger and an audit record. Penalties, payments, receipts and allocations are
left unchanged.

**From the command line** (bulk or historical pardons). This applies the same atomic pardon,
with an explicit review step:

1. Back up the database and finish attendance-to-penalty reconciliation up to the cutoff.
   Schedule a quiet period with no attendance or payment changes.
2. Run a dry run (it never writes) and review the per-staff totals and snapshot hash with
   accounting:

   ```bash
   npm run lateness-debt:pardon -- \
     --cutoff-date "2026-10-06" \
     --reason "Executive debt pardon, order REFERENCE" \
     --operator-email "operator@example.com" \
     --idempotency-key "executive-pardon-2026-10-06"
   ```

3. Apply with the reviewed hash:

   ```bash
   npm run lateness-debt:pardon -- \
     --cutoff-date "2026-10-06" \
     --reason "Executive debt pardon, order REFERENCE" \
     --operator-email "operator@example.com" \
     --idempotency-key "executive-pardon-2026-10-06" \
     --expected-snapshot-hash "HASH_FROM_REVIEWED_PREVIEW" \
     --apply --confirm-pardon
   ```

   A changed snapshot aborts without writing. Reusing the idempotency key with the same
   metadata is a no-op.
4. Reconcile afterwards. Pardoned balances should be zero, payments and allocations unchanged,
   and later penalties still payable.

---

## Security

- Authentication on every route, enforced at the proxy and re-checked in each handler
- Role checks (`admin`, `hr`, `viewer`) on every mutation; organisation membership required
- Validated input and parameterised database access throughout
- Attendance bound to one verified device per staff member, with an approval workflow for
  transfers
- An immutable audit trail of every data change, pardon and permission
- Secrets kept in the hosting environment, never in the repository

Report a suspected vulnerability to the system owner directly rather than opening an issue.

---

## Ownership

Internal system of the Ghana Revenue Authority. All rights reserved.
