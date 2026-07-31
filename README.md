# LateWatch

Attendance and lateness management system for the Ghana Revenue Authority.

Staff record their arrival and departure from a mobile web app that verifies where and how
they are connecting from. The system computes the day's penalty against the office's lateness
policy, tracks payments against what is owed, and produces the Excel returns the office files
each week and month. Administrators work from a separate console covering staff records,
attendance corrections, approved absences, device management, and reporting.

Internal software, operated by the office it serves. Not intended for redistribution or reuse.

---

## Capabilities

### Attendance portal — staff

Installed as a home-screen web app.

- **Sign in and sign out** for the working day, verified against the office's registered
  location and network before a record is accepted
- **One trusted device per staff member.** Moving to a new phone requires an administrator to
  approve a transfer request, which keeps one person's attendance tied to one device
- **Reminders** delivered as push notifications ahead of the sign-in and sign-out deadlines,
  including on days the office is closed
- **Penalty history** by week, with the amount outstanding and what has been paid
- **Payment receipts**, viewable in-app and printable as PDF

### Administration console — admin and HR

- **Staff records**, including NSS personnel and attendance-only staff, who follow different
  penalty rules
- **Daily entry grid** for reviewing and correcting attendance, with penalties recomputed on
  change
- **Permissions and pardons** — approved late arrivals, early departures, and full-day
  absences, applied individually or as a general pardon across the office
- **Device health** — trusted devices, pending transfer requests, reminder delivery status,
  and device resets
- **Holiday calendar**, maintained manually or synchronised from Google Calendar
- **Payments** recorded against outstanding penalties, with receipts issued to staff
- **Contributions** and the **monthly offence book**
- **Excel exports** — weekly, monthly, attendance, contributions, lateness summary, and
  offence book, generated from stored templates
- **Audit trail** recording every change with its before and after state

---

## Penalty model

Current rules, as implemented in `src/lib/penalty-calculator.ts`.

| Condition | Charge |
|---|---|
| Arrival after 08:30 | GHC 10 |
| Each additional full hour late | GHC 5 |
| No sign-out recorded | GHC 2 |
| No sign-in recorded by 16:30 | GHC 10 |
| **Maximum for any single day** | **GHC 50** |

The no-sign-in charge applies from 8 July 2026 onward and can be waived by an administrator.
Holidays and approved permissions suppress penalties for the day. NSS personnel and
attendance-only staff are scored under their own rules.

The policy has been revised more than once; the calculator is the authority, and this table is
kept in step with it.

---

## Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router) |
| Runtime | React 19.2 |
| Language | TypeScript 5 |
| UI | shadcn/ui on Tailwind CSS v4, vaul for sheets |
| Database | Neon Postgres via Drizzle ORM 0.45 |
| Authentication | Clerk 7 |
| Validation | Zod 4 |
| File storage | Cloudflare R2 |
| Realtime | Ably 2 |
| Push notifications | web-push (VAPID) |
| Request throttling | Upstash Redis, falling back to Postgres |
| Spreadsheets | ExcelJS 4 |
| PDF | jsPDF |
| Charts | Recharts 3 |
| Calendar sync | Google Calendar API |
| Hosting | Vercel |

### Request path

Every request passes through `src/proxy.ts`, which enforces authentication, before reaching a
route handler or Server Action. Handlers re-check authorisation themselves rather than relying
on the proxy alone.

### Mutation pattern

Server Actions and write endpoints follow the same sequence, and new ones are expected to:

1. `requireRole([...])` or `enforceRole([...])` — authorisation
2. Zod schema validation of the input
3. Drizzle query, parameterised
4. `writeAuditEvent()` — who changed what, before and after
5. `publishRealtime()` — push the change to connected clients

There is no server-side data cache to invalidate: attendance reads are deliberately
uncached, and clients stay current from the realtime publish in step 5 rather than from a
TTL. Static assets are cached by the service worker, which never serves `/api/*`.

### Data model

25 tables. The central ones are `staff`, `attendance_record` (one row per staff member per
day, uniquely constrained), `lateness_entry` (the computed penalty), `attendance_permission`,
`staff_device` with `device_transfer_request`, `lateness_payment` with its allocations,
`work_calendar`, and `audit_event`.

---

## Repository layout

```
src/
├── app/
│   ├── api/                 REST endpoints (attendance, exports, calendar, admin, …)
│   ├── check-in/            Staff attendance portal (PWA)
│   ├── attendance/          Admin: overview and devices
│   ├── dashboard/  staff/  entries/  exports/  calendar/
│   ├── payments/  contributions/  emergency-contacts/  audit-trail/
│   ├── location/  wifi/  settings/  install/  account/
│   └── (auth)/              Sign-in and sign-up
├── actions/                 Server Actions: staff, entries, calendar, exports, audit
├── components/              ui, layout, auth, brand, exports, receipts, notifications
├── lib/                     Business logic (~64 modules)
├── db/                      Drizzle schema and client
├── contexts/                React context providers
├── attendance-templates/    Excel templates
├── payment-templates/
└── proxy.ts                 Authentication gate
drizzle/                     Migrations — hand-written SQL, applied in order
scripts/                     Operational and repair scripts
tests/                       Test suite
```

---

## Local development

### Prerequisites

- Node.js 20 or newer
- A Neon Postgres database
- Clerk, Cloudflare R2, and Ably accounts
- A VAPID key pair for push notifications

### Setup

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

### Environment

Copy `.env.example` to `.env.local` and fill it in. The required set:

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

# Scheduled reminders — shared secret for the cron endpoints
CRON_SECRET=

# Signing secrets — long, random, and independent of the values above.
# Rotating DEVICE_BINDING_SECRET unbinds every trusted device.
DEVICE_BINDING_SECRET=
ATTENDANCE_QR_SECRET=

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional:

```bash
# Grants admin regardless of Clerk metadata — treat as privileged configuration
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

See `.env.example` for the same list with notes.

### Database migrations

Migrations are hand-written SQL files in `drizzle/`, applied in numerical order. There are no
`db:push` or `db:generate` scripts — schema changes mean adding a migration file and editing
`src/db/schema.ts` to match.

---

## Scripts

```bash
npm run dev              # Development server
npm run build            # Production build
npm start                # Serve a production build
npm run lint             # ESLint
npm run test             # Test suite
npm run load:test        # API load test
```

Operational scripts. **Those marked ⚠ modify live records — read before running:**

```bash
npm run clerk:role                          # Assign a user's role in Clerk
npm run clerk:staff-metadata                # Sync staff metadata into Clerk
npm run clerk:sessions:cleanup              # Revoke stale staff sessions (dry run by default)
npm run cronjob-org:reminders               # Register the reminder cron jobs
npm run penalties:recalculate               # ⚠ Recompute penalties for regular staff
npm run no-signout:repair-waivers           # ⚠ Repair no-sign-out waivers
npm run attendance:repair-retroactive-no-show   # ⚠ Backfill no-show sign-in penalties
npm run no-show:correct-amount              # ⚠ Correct no-show penalty amounts
```

---

## Testing

```bash
npm run test
```

The suite asserts against source files rather than running the UI — it checks that pages,
routes, and libraries contain the behaviour they are supposed to. That makes it fast and
dependency-free, but it also means **moving or renaming a page breaks its tests**, and those
assertions must be updated alongside the change rather than deleted.

---

## Operations

- **Deployment** — pushing to `main` deploys to Vercel. Pull requests get preview deployments.
- **Scheduled reminders** — driven by an external cron service calling endpoints guarded by
  `CRON_SECRET`. Delivery is recorded per staff member per day, and a unique constraint makes
  a duplicate run a no-op rather than a second notification.
- **Throttling** — write endpoints that trigger outbound work are rate limited per user.
  Redis is used when configured, Postgres otherwise, and the check fails open so that
  unavailable storage cannot block a staff member from signing in.
- **Timezone** — all attendance logic runs on Africa/Accra time; dates are stored as
  `YYYY-MM-DD`.

---

## Security

- Authentication is required on every route, enforced at the proxy and re-checked in handlers
- Role checks (`admin`, `hr`, `viewer`) guard every mutation
- All input is validated with Zod schemas
- Database access goes through parameterised Drizzle queries
- Attendance is bound to a single verified device per staff member, with an approval workflow
  for transfers
- Every data change is written to an immutable audit trail

Report a suspected vulnerability to the system owner directly rather than opening an issue.

---

## Ownership

Internal system of the Ghana Revenue Authority. All rights reserved.
