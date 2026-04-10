# LateWatch — Design Specification

**Version:** 1.0  
**Date:** 2026-04-08  
**Status:** Approved

---

## 1. Overview

LateWatch is an enterprise-grade lateness tracking system for GRA (Ghana Revenue Authority). It captures lateness penalties and "did not sign out" penalties, maintains permanent records with audit trails, and exports weekly/monthly Excel reports matching the existing template layout.

### 1.1 Goals

- Replace manual Excel workflow with a modern web application
- Maintain exact Excel template layout for exports (pixel-for-pixel match)
- Provide fast data entry for HR/Admin staff
- Ensure audit trail for all changes
- Deploy on Vercel with serverless architecture

### 1.2 Non-Goals

- Mobile app (responsive web only)
- Public API for third-party integrations
- Real-time notifications
- Multi-tenant support (single organization)

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Framework** | Next.js 16 (App Router) | Cache Components for PPR, Server Actions |
| **UI Library** | shadcn/ui v3 + Tailwind CSS v4 | Full ownership, minimal bundle, excellent theming |
| **Database** | Neon Postgres + Drizzle ORM | Serverless HTTP driver, type-safe queries |
| **Auth** | Clerk (Vercel Marketplace) | Email/password + Google OAuth, auto-provisioned env vars |
| **Storage** | Cloudflare R2 | Zero egress fees, S3-compatible |
| **Validation** | Zod | Schema validation |
| **Excel** | ExcelJS | Preserves styles when reading/writing |
| **Charts** | Recharts v3 (via shadcn charts) | Accessibility layer built-in |
| **Deployment** | Vercel | Edge-compatible, automatic CI/CD |

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vercel Edge                               │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 16 App Router                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │
│  │ Static Shell│  │ Cache       │  │ Dynamic (Suspense)  │     │
│  │ (Instant)   │  │ Components  │  │ (Runtime data)      │     │
│  └─────────────┘  └─────────────┘  └─────────────────────┘     │
│         │                │                    │                  │
│         └────────────────┼────────────────────┘                │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Server Actions ('use server')                │  │
│  │  • Validation (Zod)                                       │  │
│  │  • Authorization (Clerk role check)                     │  │
│  │  • Business Logic                                         │  │
│  │  • Database Operations (Drizzle)                        │  │
│  │  • Audit Logging                                          │  │
│  │  • Cache Invalidation (revalidateTag)                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Neon Postgres │  │ Cloudflare R2 │  │ Clerk Auth    │
│ (Drizzle ORM) │  │ (Excel files) │  │ (Marketplace) │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 3.2 Request Flow

```
User Action → Server Action → Validation (Zod) → Auth Check
           → Business Logic → Drizzle Query → Audit Log
           → Cache Invalidation → Response
```

---

## 4. Data Model

### 4.1 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         staff                                    │
├─────────────────────────────────────────────────────────────────┤
│ id            UUID       PRIMARY KEY                            │
│ full_name     TEXT       NOT NULL                               │
│ active        BOOLEAN    DEFAULT true                           │
│ department    TEXT       NULLABLE                               │
│ unit          TEXT       NULLABLE                               │
│ created_at    TIMESTAMPTZ DEFAULT now()                         │
│ updated_at    TIMESTAMPTZ DEFAULT now()                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      lateness_entry                              │
├─────────────────────────────────────────────────────────────────┤
│ id                 UUID      PRIMARY KEY                         │
│ staff_id           UUID      FK → staff.id                       │
│ date               DATE      NOT NULL                            │
│ arrival_time       TIME      NULLABLE                            │
│ did_not_sign_out   BOOLEAN   DEFAULT false                       │
│ reason             TEXT      NULLABLE                            │
│ computed_amount    DECIMAL   NOT NULL                            │
│ override_amount    DECIMAL   NULLABLE                            │
│ override_reason    TEXT      NULLABLE                            │
│ overridden_by      UUID      FK → auth.users                      │
│ created_at         TIMESTAMPTZ DEFAULT now()                     │
│ updated_at         TIMESTAMPTZ DEFAULT now()                     │
│ UNIQUE(staff_id, date)                                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      work_calendar                               │
├─────────────────────────────────────────────────────────────────┤
│ id            UUID       PRIMARY KEY                             │
│ date          DATE       UNIQUE NOT NULL                         │
│ is_holiday    BOOLEAN    DEFAULT false                           │
│ holiday_note  TEXT       NULLABLE                               │
│ created_at    TIMESTAMPTZ DEFAULT now()                         │
│ updated_at    TIMESTAMPTZ DEFAULT now()                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       audit_event                                │
├─────────────────────────────────────────────────────────────────┤
│ id            UUID       PRIMARY KEY                             │
│ entity_type   TEXT       NOT NULL (staff|entry|calendar|export) │
│ entity_id     UUID       NOT NULL                               │
│ action        TEXT       NOT NULL (CREATE|UPDATE|DELETE|EXPORT) │
│ before_json   JSONB      NULLABLE                                │
│ after_json    JSONB      NULLABLE                                │
│ actor_user_id UUID       FK → auth.users                         │
│ actor_email   TEXT       NOT NULL                               │
│ timestamp     TIMESTAMPTZ DEFAULT now()                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    template_version                              │
├─────────────────────────────────────────────────────────────────┤
│ id            UUID       PRIMARY KEY                             │
│ name          TEXT       NOT NULL                                │
│ r2_key        TEXT       NOT NULL (path in Cloudflare R2)       │
│ version       INT        NOT NULL                                │
│ is_active     BOOLEAN    DEFAULT true                           │
│ mapping_json  JSONB      NOT NULL (cell coordinates)            │
│ uploaded_by   UUID       FK → auth.users                        │
│ created_at    TIMESTAMPTZ DEFAULT now()                         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Drizzle Schema

```typescript
// db/schema.ts
import { pgTable, uuid, text, boolean, date, time, decimal, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  active: boolean('active').default(true),
  department: text('department'),
  unit: text('unit'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const staffRelations = relations(staff, ({ many }) => ({
  entries: many(latenessEntry),
}));

export const latenessEntry = pgTable('lateness_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id),
  date: date('date').notNull(),
  arrivalTime: time('arrival_time'),
  didNotSignOut: boolean('did_not_sign_out').default(false),
  reason: text('reason'),
  computedAmount: decimal('computed_amount', { precision: 10, scale: 2 }).notNull(),
  overrideAmount: decimal('override_amount', { precision: 10, scale: 2 }),
  overrideReason: text('override_reason'),
  overriddenBy: uuid('overridden_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [unique().on(table.staffId, table.date)]);

export const workCalendar = pgTable('work_calendar', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').unique().notNull(),
  isHoliday: boolean('is_holiday').default(false),
  holidayNote: text('holiday_note'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  actorUserId: uuid('actor_user_id'),
  actorEmail: text('actor_email').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const templateVersion = pgTable('template_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  r2Key: text('r2_key').notNull(),
  version: integer('version').notNull(),
  isActive: boolean('is_active').default(true),
  mappingJson: jsonb('mapping_json').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => staff.id),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 5. Business Rules

### 5.1 Penalty Calculation

```typescript
// lib/penalty-calculator.ts

interface PenaltyInput {
  arrivalTime: string | null;  // HH:MM format
  didNotSignOut: boolean;
  isHoliday: boolean;
}

interface PenaltyOutput {
  amount: number;
  reason: string;
}

export function computePenalty(input: PenaltyInput): PenaltyOutput {
  const CUTOFF_TIME = '08:30';
  const BASE_PENALTY = 10;
  const HOURLY_INCREMENT = 5;
  const SIGN_OUT_PENALTY = 2;

  // Holiday: no penalty, block entry
  if (input.isHoliday) {
    return { amount: 0, reason: 'HOLIDAY' };
  }

  // Blank time: not late
  if (!input.arrivalTime) {
    if (input.didNotSignOut) {
      return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
    }
    return { amount: 0, reason: '' };
  }

  const isLate = input.arrivalTime > CUTOFF_TIME;

  if (!isLate && input.didNotSignOut) {
    return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
  }

  if (isLate) {
    const base = BASE_PENALTY;
    
    // Count full hours completed after 8:30
    const [hours, minutes] = input.arrivalTime.split(':').map(Number);
    const arrivalMinutes = hours * 60 + minutes;
    const cutoffMinutes = 8 * 60 + 30; // 8:30 = 510 minutes
    const minutesLate = arrivalMinutes - cutoffMinutes;
    
    // Full hours completed (each 60-minute block after cutoff)
    const fullHoursLate = Math.floor(minutesLate / 60);
    const hourly = HOURLY_INCREMENT * fullHoursLate;
    
    let reason = 'DIDN\'T COME BEFORE 8:30AM';
    let total = base + hourly;
    
    if (input.didNotSignOut) {
      total += SIGN_OUT_PENALTY;
      reason = 'DIDN\'T COME BEFORE 8:30AM AND DID NOT SIGN OUT';
    }
    
    return { amount: total, reason };
  }

  return { amount: 0, reason: '' };
}
```

### 5.2 Penalty Examples

| Arrival Time | Did Not Sign Out | Amount | Reason |
|--------------|------------------|--------|--------|
| (blank) | No | GHC 0 | — |
| (blank) | Yes | GHC 2 | DID NOT SIGN OUT |
| 08:20 | No | GHC 0 | — |
| 08:20 | Yes | GHC 2 | DID NOT SIGN OUT |
| 08:31 | No | GHC 10 | DIDN'T COME BEFORE 8:30AM |
| 08:31 | Yes | GHC 12 | DIDN'T COME BEFORE 8:30AM AND DID NOT SIGN OUT |
| 09:25 | No | GHC 10 | DIDN'T COME BEFORE 8:30AM |
| 09:31 | No | GHC 15 | DIDN'T COME BEFORE 8:30AM |
| 10:30 | No | GHC 15 | DIDN'T COME BEFORE 8:30AM |
| 10:31 | No | GHC 20 | DIDN'T COME BEFORE 8:30AM |

---

## 6. Server Actions

### 6.1 Actions Summary

| Action | Purpose | Cache Invalidation |
|--------|---------|-------------------|
| `getStaff` | List all staff | N/A (cached with `cacheTag`) |
| `createStaff` | Add new staff member | `revalidateTag('staff')` |
| `updateStaff` | Update staff details | `revalidateTag('staff')` |
| `getCalendar` | Get calendar for month | N/A (cached) |
| `markHoliday` | Mark/unmark holiday | `updateTag('calendar-{month}')` |
| `getEntries` | Get entries for date | N/A (cached) |
| `saveEntry` | Create/update entry | `updateTag('entries-{date}')` |
| `bulkSaveEntries` | Save all entries for day | `updateTag('entries-{date}')` |
| `deleteEntry` | Remove an entry | `updateTag('entries-{date}')` |
| `uploadTemplate` | Upload new Excel template | `revalidateTag('templates')` |
| `generateWeeklyExport` | Create weekly Excel | None (generates file) |
| `generateMonthlyExport` | Create monthly Excel | None (generates file) |

### 6.2 Entry Action Example

```typescript
// app/actions/entries.ts
'use server'

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { latenessEntry, auditEvent } from '@/db/schema';
import { revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { computePenalty } from '@/lib/penalty-calculator';
import { eq, and } from 'drizzle-orm';

const entrySchema = z.object({
  staffId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  didNotSignOut: z.boolean(),
  reason: z.string().optional(),
});

export async function saveEntry(formData: FormData) {
  const user = await requireRole(['admin', 'hr']);

  const parsed = entrySchema.parse({
    staffId: formData.get('staffId'),
    date: formData.get('date'),
    arrivalTime: formData.get('arrivalTime') || null,
    didNotSignOut: formData.get('didNotSignOut') === 'true',
    reason: formData.get('reason') || undefined,
  });

  // Check if holiday
  const calendar = await db.query.workCalendar.findFirst({
    where: (c, { eq }) => eq(c.date, parsed.date),
  });
  if (calendar?.isHoliday) {
    throw new Error('Cannot create entry for holiday');
  }

  // Compute penalty
  const { amount, reason } = computePenalty({
    arrivalTime: parsed.arrivalTime,
    didNotSignOut: parsed.didNotSignOut,
    isHoliday: false,
  });

  // Upsert entry
  const existing = await db.query.latenessEntry.findFirst({
    where: (e, { and, eq }) => and(
      eq(e.staffId, parsed.staffId),
      eq(e.date, parsed.date)
    ),
  });

  let entry;
  if (existing) {
    [entry] = await db.update(latenessEntry)
      .set({
        arrivalTime: parsed.arrivalTime,
        didNotSignOut: parsed.didNotSignOut,
        computedAmount: amount.toString(),
        reason: reason,
        updatedAt: new Date(),
      })
      .where(eq(latenessEntry.id, existing.id))
      .returning();
  } else {
    [entry] = await db.insert(latenessEntry).values({
      staffId: parsed.staffId,
      date: parsed.date,
      arrivalTime: parsed.arrivalTime,
      didNotSignOut: parsed.didNotSignOut,
      computedAmount: amount.toString(),
      reason: reason,
    }).returning();
  }

  // Audit log
  await db.insert(auditEvent).values({
    entityType: 'entry',
    entityId: entry.id,
    action: existing ? 'UPDATE' : 'CREATE',
    beforeJson: existing || null,
    afterJson: entry,
    actorUserId: user.id,
    actorEmail: user.emailAddresses[0]?.emailAddress || 'unknown',
  });

  updateTag(`entries-${parsed.date}`);
  
  return entry;
}
```

---

## 7. Authentication & Authorization

### 7.1 Clerk Setup (Vercel Marketplace)

Install Clerk from Vercel Marketplace for auto-provisioned environment variables:

```bash
# Install from Vercel Marketplace (auto-provisions env vars)
vercel integration add clerk

# Install the Clerk Next.js SDK
npm install @clerk/nextjs
```

### 7.2 Clerk Provider

```tsx
// app/layout.tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### 7.3 Middleware Configuration

```ts
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/staff(.*)",
  "/entries(.*)",
  "/exports(.*)",
  "/calendar(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

### 7.4 Sign-In and Sign-Up Pages

```tsx
// app/(auth)/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return <SignIn />;
}
```

```tsx
// app/(auth)/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return <SignUp />;
}
```

### 7.5 Role-Based Access Control

Clerk manages roles via `privateMetadata`:

```tsx
// Server component - check role
import { currentUser } from "@clerk/nextjs/server";

export default async function Page() {
  const user = await currentUser();
  const role = user?.privateMetadata?.role as string | undefined;
  
  if (!role || !['admin', 'hr'].includes(role)) {
    redirect('/unauthorized');
  }
  
  // Continue with authorized access
}
```

```ts
// Server action - role check helper
import { currentUser } from "@clerk/nextjs/server";

export async function requireRole(allowedRoles: string[]) {
  const user = await currentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  
  const role = user.privateMetadata?.role as string | undefined;
  if (!role || !allowedRoles.includes(role)) {
    throw new Error('Forbidden');
  }
  
  return user;
}
```

```ts
// app/actions/staff.ts
'use server'

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { staff } from '@/db/schema';

export async function createStaff(data: { fullName: string; department?: string }) {
  await requireRole(['admin']); // Only admins can create staff
  
  return db.insert(staff).values(data).returning();
}

export async function updateStaff(id: string, data: { fullName?: string; active?: boolean }) {
  await requireRole(['admin']); // Only admins can update staff
  
  return db.update(staff).set(data).where(eq(staff.id, id)).returning();
}

export async function saveEntry(formData: FormData) {
  await requireRole(['admin', 'hr']); // Admin and HR can save entries
  
  // ... entry logic
}
```

### 7.6 Setting Roles in Clerk Dashboard

After a user signs up, set their role in Clerk Dashboard:

1. Go to Users → Select user
2. Click "Metadata" tab
3. Add to `privateMetadata`:
   ```json
   {
     "role": "admin"
   }
   ```

Or via API:

```ts
import { clerkClient } from "@clerk/nextjs/server";

export async function setUserRole(userId: string, role: 'admin' | 'hr' | 'viewer') {
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    privateMetadata: { role },
  });
}
```

### 7.7 Role Permissions

| Role | Permissions |
|------|-------------|
| `admin` | Full access: staff management, entry CRUD, exports, template upload, role assignment |
| `hr` | Entry CRUD, exports, view staff |
| `viewer` | View only (optional future role) |

---

## 8. Cloudflare R2 Integration

### 8.1 Client Setup

```typescript
// lib/r2/client.ts
import { S3Client } from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
  },
});
```

### 8.2 Presigned URLs

```typescript
// lib/r2/presigned.ts
import { r2 } from './client';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes
}

export async function getDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: process.env.CF_R2_BUCKET!,
    Key: key,
  });
  return getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes
}
```

### 8.3 Template Upload Flow

```
Admin selects file
    ↓
Client requests presigned URL
    ↓
Server generates presigned URL (5 min TTL)
    ↓
Client uploads directly to R2
    ↓
Server saves metadata to database (template_version table)
```

---

## 9. Excel Export

### 9.1 Export Strategy

1. **Template stored in R2** — Admin uploads master template
2. **Mapping stored in DB** — JSON mapping of cell coordinates
3. **Export process:**
   - Download template from R2
   - Load with ExcelJS
   - Fill cells based on mapping
   - Upload to R2
   - Generate presigned download URL

### 9.2 Mapping Schema

```typescript
// Template cell mapping structure
interface TemplateMapping {
  sheets: {
    [sheetName: string]: {
      staffStartRow: number;
      columns: {
        name: string;      // e.g., "B"
        time: string;      // e.g., "C"
        amount: string;    // e.g., "D"
        reason: string;    // e.g., "E"
      };
      staff: {
        [staffName: string]: number; // row number
      };
    };
  };
}
```

---

## 10. UI Screens

### 10.1 Screens Overview

| Screen | Path | Purpose |
|--------|------|---------|
| Sign-In | `/sign-in` | Email/password + Google OAuth |
| Dashboard | `/dashboard` | Weekly summary, quick actions, activity |
| Staff | `/staff` | Staff list, add/edit/deactivate |
| Entries | `/entries` | Daily entry grid (main workflow) |
| Exports | `/exports` | Weekly/monthly Excel export |
| Calendar | `/calendar` | Holiday management |
| Settings | `/settings` | Profile, preferences |

### 10.2 Design System

**Typography:**
- Headings: Inter Bold (600)
- Body: Inter Regular (400)
- Monospace (time/amounts): JetBrains Mono

**Colors (Light Mode):**
- Background: `#FFFFFF`
- Card: `#F9FAFB`
- Border: `#E5E7EB`
- Primary: `#2563EB` (blue-600)
- Success: `#10B981` (emerald-500)
- Warning: `#F59E0B` (amber-500)
- Danger: `#EF4444` (red-500)
- Muted: `#6B7280` (gray-500)

**Colors (Dark Mode):**
- Background: `#0A0A0A`
- Card: `#171717`
- Border: `#262626`
- Primary: `#3B82F6` (blue-500)
- Text: `#FAFAFA`

**Components:**
- Cards: `rounded-lg border shadow-sm`
- Buttons: `rounded-md font-medium transition-colors`
- Inputs: `rounded-md border focus:ring-2 focus:ring-primary`
- Tables: `divide-y border-b`

### 10.3 Screen 1: Sign-In

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│                                                                            │
│                         ┌─────────────────────┐                            │
│                         │     🏢 LateWatch   │                            │
│                         └─────────────────────┘                            │
│                                                                            │
│                         ┌─────────────────────┐                            │
│                         │                     │                            │
│                         │   Sign in to your   │                            │
│                         │      account        │                            │
│                         │                     │                            │
│                         │  ┌───────────────┐  │                            │
│                         │  │ 📧 Email      │  │                            │
│                         │  │               │  │                            │
│                         │  └───────────────┘  │                            │
│                         │                     │                            │
│                         │  ┌───────────────┐  │                            │
│                         │  │ 🔒 Password   │  │                            │
│                         │  │               │  │                            │
│                         │  └───────────────┘  │                            │
│                         │                     │                            │
│                         │  ┌───────────────┐  │                            │
│                         │  │   Sign In     │  │                            │
│                         │  └───────────────┘  │                            │
│                         │                     │                            │
│                         │  ───── or ─────     │                            │
│                         │                     │                            │
│                         │  ┌───────────────┐  │                            │
│                         │  │  🔵 Continue   │  │                            │
│                         │  │  with Google  │  │                            │
│                         │  └───────────────┘  │                            │
│                         │                     │                            │
│                         └─────────────────────┘                            │
│                                                                            │
│                                                                            │
│                      Don't have an account? Sign up                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Clerk Component:** `<SignIn />` with email/password + Google OAuth enabled in Clerk Dashboard.

### 10.4 Screen 2: Dashboard (Overview)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │          │  Good morning, Admin                                         │
│ │ Staff    │                                                               │
│ │ Entries  │  ┌─────────────────────────────────────────────────────────┐ │
│ │ Exports  │  │                    THIS WEEK                            │ │
│ │ Calendar │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │ │
│ │ Settings │  │  │    GHC       │ │   📊 47     │ │   ⚠️ 3       │    │ │
│ │          │  │  │   1,250      │ │   Entries    │ │   Pending    │    │ │
│ │          │  │  │  Total       │ │   recorded   │ │   review      │    │ │
│ │          │  │  └──────────────┘ └──────────────┘ └──────────────┘    │ │
│ │          │  │                                                        │ │
│ │          │  │  +15% vs last week                                    │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌───────────────────────┐ ┌───────────────────────────────┐ │
│ │          │  │   ⚡ QUICK ACTIONS    │ │  📅 WEEK OF MAR 24-28       │ │
│ │          │  │                      │ │                               │ │
│ │          │  │  ┌────────────────┐  │ │  Day      │ Entries│ Amount   │ │
│ │          │  │  │ Enter Today's  │  │ │  ─────────┼────────┼─────────│ │
│ │          │  │  │ Data          │  │ │  Mon 24   │ ✓ 47   │ GHC 320 │ │
│ │          │  │  └────────────────┘  │ │  Tue 25   │ ✓ 47   │ GHC 280 │ │
│ │          │  │                      │ │  Wed 26   │ ○ Pend │ —       │ │
│ │          │  │  ┌────────────────┐  │ │  Thu 27   │ 🎉 Hol │ —       │ │
│ │          │  │  │ Export Weekly │  │ │  Fri 28   │ ○ Empty│ —       │ │
│ │          │  │  └────────────────┘  │ │                               │ │
│ │          │  │                      │ │  ─────────────────────────── │ │
│ │          │  │  ┌────────────────┐  │ │  Total: GHC 600              │ │
│ │          │  │  │ View Staff    │  │ │                               │ │
│ │          │  │  └────────────────┘  │ └───────────────────────────────┘ │
│ │          │  └───────────────────────┘                                   │
│ └─────────┘                                                               │
│                                                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  📋 RECENT ACTIVITY                                          View all │ │
│  │                                                                       │ │
│  │  • Jane Doe marked late (09:15) - 2 minutes ago                      │ │
│  │  • Weekly export generated by admin@company.com - 1 hour ago         │ │
│  │  • John Smith updated entry for Mar 24 - 3 hours ago                 │ │
│  │  • New staff member added: Alice Johnson - yesterday                 │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ Command Palette (⌘K) ────────────────────────────────────────────────┐ │
│  │ 🔍 Search staff, entries, exports...                     [↑↓] Nav     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Sidebar: Collapsible, icons + text, active state highlighted
- Stats cards: Amount (primary), Entries count, Pending count
- Quick actions: Large CTA buttons for common tasks
- Week view: Day-by-day breakdown with status indicators
- Activity feed: Recent actions with timestamps
- Command palette: Keyboard shortcut for navigation

### 10.5 Screen 3: Staff Management

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │          │  Staff                                    [+ Add Staff]     │
│ │ Staff  ● │──────────────────────────────────────────────────────────────│
│ │ Entries  │                                                               │
│ │ Exports  │  ┌─────────────────────────────────────────────────────────┐ │
│ │ Calendar │  │ 🔍 Search... │ Department ▼ │ Status: All ▼ │ 10 rows ▼│ │
│ │ Settings │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │ Name              │ Department │ Unit   │ Status│Actions│ │
│ │          │  ├───────────────────┼────────────┼────────┼───────┼───────┤ │
│ │          │  │ Charles Dodgatse  │ Finance    │ Revenue│ Active│ ⋮     │ │
│ │          │  │ Eyram Mensah      │ Operations │ Field  │ Active│ ⋮     │ │
│ │          │  │ Anna-Lisa Hammond │ HR         │ Admin  │ Active│ ⋮     │ │
│ │          │  │ Claude Boadi      │ IT         │ Dev    │ Active│ ⋮     │ │
│ │          │  │ Eunice Adu        │ Finance    │ Audit  │ Active│ ⋮     │ │
│ │          │  │ Esther Adjekor    │ Operations │ Field  │ Active│ ⋮     │ │
│ │          │  │ Raphael Mensah    │ IT         │ Dev    │ Active│ ⋮     │ │
│ │          │  │ Dennis Aryeetey   │ HR         │ Admin  │ Active│ ⋮     │ │
│ │          │  │ Daniel Kwarteng   │ Finance    │ Revenue│ Active│ ⋮     │ │
│ │          │  │ Wisdom Datsomor   │ IT         │ Dev    │ Active│ ⋮     │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  Showing 1-10 of 47 staff              [< 1  2  3  4  5  >]  │
│ │          │                                                               │
│ └─────────┘                                                               │
│                                                                            │
│  ┌─ Add Staff Member ────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  Full Name *                                                          │ │
│  │  ┌───────────────────────────────────────────────────────────────┐    │ │
│  │  │                                                               │    │ │
│  │  └───────────────────────────────────────────────────────────────┘    │ │
│  │                                                                       │ │
│  │  Department                        Unit                              │ │
│  │  ┌─────────────────────┐          ┌─────────────────────┐            │ │
│  │  │ Select...          ▼│          │ Select...          ▼│            │ │
│  │  └─────────────────────┘          └─────────────────────┘            │ │
│  │                                                                       │ │
│  │                              [Cancel]  [Add Staff Member]             │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Search bar with filters (department, status)
- TanStack Table with sorting, pagination
- Row actions menu: Edit, Deactivate, View history
- Add staff modal: Full name (required), department, unit
- Status badges: Active (green), Inactive (gray)

### 10.6 Screen 4: Daily Entry Grid (Core Screen)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │ Staff    │  Daily Entry                                                │
│ │ Entries ●│──────────────────────────────────────────────────────────────│
│ │ Exports  │                                                               │
│ │ Calendar │  ┌─────────────────────────────────────────────────────────┐ │
│ │ Settings │  │ 📅 [March 2026 ▼] │ Week: [24-28 ▼] │ Day: [Mon 24 ▼] │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │ # │ Name              │ Time   │ Amount│ Reason       │⏹│ │
│ │          │  ├───┼───────────────────┼────────┼───────┼──────────────┼──┤ │
│ │          │  │ 1 │ Charles Dodgatse  │[09:15] │ GHC 10 │ DIDN'T COME..│□ │ │
│ │          │  │ 2 │ Eyram Mensah      │[08:45] │ GHC 0  │ —            │□ │ │
│ │          │  │ 3 │ Anna-Lisa Hammond │[    ]  │ GHC 2  │ DID NOT SIGN │☑ │ │
│ │          │  │ 4 │ Claude Boadi      │[10:30] │ GHC 15 │ DIDN'T COME..│□ │ │
│ │          │  │ 5 │ Eunice Adu        │[08:20] │ GHC 0  │ —            │□ │ │
│ │          │  │ 6 │ Esther Adjekor   │[09:00] │ GHC 10 │ DIDN'T COME..│□ │ │
│ │          │  │ 7 │ Raphael Mensah   │[    ]  │ GHC 0  │ —            │□ │ │
│ │          │  │ 8 │ Dennis Aryeetey  │[11:45] │ GHC 20 │ DIDN'T COME..│□ │ │
│ │          │  │ 9 │ Daniel Kwarteng  │[08:55] │ GHC 10 │ DIDN'T COME..│□ │ │
│ │          │  │10 │ Wisdom Datsomor   │[08:10] │ GHC 0  │ —            │□ │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │ 💡 Tips:                                               │ │
│ │          │  │ • Leave TIME blank for staff who arrived on time       │ │
│ │          │  │ • Check "Did not sign out" to add GHC 2 penalty        │ │
│ │          │  │ • Reason auto-generates based on time + sign-out status │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  [Save Draft]                          [Submit All Entries] │
│ │          │                                                               │
│ │          │  ─────────────────────────────────────────────────────────  │
│ │          │  📊 Day Summary                                               │
│ │          │  │ Total Late: 6  │ On Time: 4  │ Did Not Sign Out: 1    │ │
│ │          │  │ Total Amount: GHC 57                                         │ │
│ └─────────┘  └─────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Date picker: Month selector, week dropdown, day dropdown
- Entry grid: Inline editable time field, calculated amount, auto-generated reason
- Checkbox for "Did not sign out" (⏹ = unchecked, ☑ = checked)
- Time input: Time picker component with validation
- Auto-calculation: Amount updates in real-time as time is entered
- Tips panel: Helpful guidance for users
- Draft system: Save draft (local storage) + Submit (database)
- Day summary: Real-time totals at bottom

**Keyboard Navigation:**
- Tab: Move to next field
- Enter: Submit form / move to next row
- Arrow keys: Navigate time picker

### 10.7 Screen 5: Export Center

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │ Staff    │  Export Center                                               │
│ │ Entries  │──────────────────────────────────────────────────────────────│
│ │ Exports ●│                                                               │
│ │ Calendar │  ┌─────────────────────────────────────────────────────────┐ │
│ │ Settings │  │                    WEEKLY EXPORT                        │ │
│ │          │  │                                                         │ │
│ │          │  │  Select Week: [March 24-28, 2026 ▼]                    │ │
│ │          │  │                                                         │ │
│ │          │  │  Preview:                                               │ │
│ │          │  │  ┌───────────────────────────────────────────────────┐ │ │
│ │          │  │  │ Day       │ Entries │ Late │ Sign Out │ Total   │ │ │
│ │          │  │  │ ─────────┼────────┼──────┼──────────┼────────│ │ │
│ │          │  │  │ Monday    │   47    │  12  │    3     │ GHC 145 │ │ │
│ │          │  │  │ Tuesday   │   47    │   8  │    1     │ GHC 95  │ │ │
│ │          │  │  │ Wednesday │   —     │   —  │    —     │ —       │ │ │
│ │          │  │  │ Thursday  │ Holiday │   —  │    —     │ —       │ │ │
│ │          │  │  │ Friday    │   —     │   —  │    —     │ —       │ │ │
│ │          │  │  └───────────────────────────────────────────────────┘ │ │
│ │          │  │                                                         │ │
│ │          │  │  Week Total: GHC 240                                    │ │
│ │          │  │                                                         │ │
│ │          │  │  [📥 Download Weekly Excel]                              │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │                   MONTHLY EXPORT                         │ │
│ │          │  │                                                         │ │
│ │          │  │  Select Month: [March 2026 ▼]                           │ │
│ │          │  │                                                         │ │
│ │          │  │  Weeks included: Week 1, Week 2, Week 3, Week 4        │ │
│ │          │  │                                                         │ │
│ │          │  │  Month Total: GHC 1,250                                 │ │
│ │          │  │                                                         │ │
│ │          │  │  [📥 Download Monthly Excel]                             │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │              TEMPLATE MANAGEMENT (Admin)                │ │
│ │          │  │                                                         │ │
│ │          │  │  Active Template: LATENESS BOOK MARCH 2026.xlsx (v1)   │ │
│ │          │  │  Last Updated: 2026-03-01 by admin@company.com         │ │
│ │          │  │                                                         │ │
│ │          │  │  [📤 Upload New Template]                                │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ └─────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Weekly export: Week selector, preview table, download button
- Monthly export: Month selector, weeks included, download button
- Template management: Upload new template (admin only)
- Download button: Generates presigned URL from R2
- Preview: Shows summary before download

### 10.8 Screen 6: Calendar (Holiday Management)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │ Staff    │  Calendar                                                   │
│ │ Entries  │──────────────────────────────────────────────────────────────│
│ │ Exports  │                                                               │
│ │ Calendar ●│  ┌─────────────────────────────────────────────────────────┐ │
│ │ Settings │  │                    MARCH 2026                            │ │
│ │          │  │                                                         │ │
│ │          │  │  ◀                      March 2026                    ▶  │ │
│ │          │  │                                                         │ │
│ │          │  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐            │ │
│ │          │  │  │ Sun │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │            │ │
│ │          │  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤            │ │
│ │          │  │  │  1  │  2  │  3  │  4  │  5  │  6  │  7  │            │ │
│ │          │  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤            │ │
│ │          │  │  │  8  │  9  │ 10  │ 11  │ 12  │ 13  │ 14  │            │ │
│ │          │  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤            │ │
│ │          │  │  │ 15  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │            │ │
│ │          │  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤            │ │
│ │          │  │  │ 22  │ 23  │ 24* │ 25  │ 26  │ 27🎉│ 28  │            │ │
│ │          │  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤            │ │
│ │          │  │  │ 29  │ 30  │ 31  │     │     │     │     │            │ │
│ │          │  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘            │ │
│ │          │  │                                                         │ │
│ │          │  │  * Today    🎉 Holiday                                  │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ │          │                                                               │
│ │          │  ┌─────────────────────────────────────────────────────────┐ │
│ │          │  │  SELECTED: Thursday, March 27, 2026                     │ │
│ │          │  │                                                         │ │
│ │          │  │  ☑ Mark as Holiday                                     │ │
│ │          │  │                                                         │ │
│ │          │  │  Holiday Note (optional):                               │ │
│ │          │  │  ┌───────────────────────────────────────────────────┐  │ │
│ │          │  │  │ Independence Day                                   │  │ │
│ │          │  │  └───────────────────────────────────────────────────┘  │ │
│ │          │  │                                                         │ │
│ │          │  │  [Save Changes]                                          │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ └─────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Calendar view: Month grid with navigation arrows
- Day indicators: Today (*), Holiday (🎉), Selected (highlighted)
- Click day: Opens edit panel on right side
- Holiday toggle: Checkbox to mark/unmark as holiday
- Holiday note: Optional text field for holiday name
- Save button: Updates work_calendar table

### 10.9 Screen 7: Settings (Profile)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  LateWatch                              🔔  👤 Admin ▼         │
│ │ 📊      │──────────────────────────────────────────────────────────────│
│ │ Dashboard│                                                               │
│ │ Staff    │  Settings                                                   │
│ │ Entries  │──────────────────────────────────────────────────────────────│
│ │ Exports  │                                                               │
│ │ Calendar │  ┌─────────────────────────────────────────────────────────┐ │
│ │ Settings ●│  │                                                         │ │
│ │          │  │  PROFILE                                                │ │
│ │          │  │                                                         │ │
│ │          │  │  ┌─────────────────┐                                    │ │
│ │          │  │  │                 │  Full Name                         │ │
│ │          │  │  │   👤 Avatar    │  ┌───────────────────────────────┐ │ │
│ │          │  │  │                 │  │ John Admin                   │ │ │
│ │          │  │  │   [Upload]      │  └───────────────────────────────┘ │ │
│ │          │  │  └─────────────────┘                                    │ │
│ │          │  │                                                         │ │
│ │          │  │  Email                                                  │ │
│ │          │  │  ┌───────────────────────────────────────────────────┐  │ │
│ │          │  │  │ admin@company.com                                   │  │ │
│ │          │  │  └───────────────────────────────────────────────────┘  │ │
│ │          │  │                                                         │ │
│ │          │  │  Role                                                   │ │
│ │          │  │  ┌───────────────────────────────────────────────────┐  │ │
│ │          │  │  │ Admin                                              │  │ │
│ │          │  │  └───────────────────────────────────────────────────┘  │ │
│ │          │  │                                                         │ │
│ │          │  │  [Change Password]                                      │ │
│ │          │  │                                                         │ │
│ │          │  │  ─────────────────────────────────────────────────────  │ │
│ │          │  │                                                         │ │
│ │          │  │  PREFERENCES                                            │ │
│ │          │  │                                                         │ │
│ │          │  │  Theme                                                   │ │
│ │          │  │  ┌──────────────────────────────────────────────────┐   │ │
│ │          │  │  │  ○ Light   ○ Dark   ● System                     │   │ │
│ │          │  │  └──────────────────────────────────────────────────┘   │ │
│ │          │  │                                                         │ │
│ │          │  │  [Save Preferences]                                     │ │
│ │          │  │                                                         │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ └─────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Profile section: Avatar, name, email, role (read-only from Clerk)
- Change password: Redirects to Clerk account management
- Preferences: Theme selection (Light/Dark/System)
- Save: Updates local preferences (theme stored in localStorage/cookies)

### 10.10 Command Palette (⌘K)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  🔍  Search staff, entries, exports...                    [ESC]       │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  Pages                                                                │ │
│  │  ───────────────────────────────────────────────────────────────     │ │
│  │  📊  Dashboard                               →                       │ │
│  │  👥  Staff                                   →                       │ │
│  │  ✏️  Daily Entry                            →                       │ │
│  │  📥  Exports                                →                       │ │
│  │  📅  Calendar                                →                       │ │
│  │  ⚙️  Settings                               →                       │ │
│  │                                                                       │ │
│  │  Actions                                                               │ │
│  │  ───────────────────────────────────────────────────────────────     │ │
│  │  +   Add Staff Member                        →                       │ │
│  │  📥  Export Weekly Report                     →                       │ │
│  │  📥  Export Monthly Report                    →                       │ │
│  │                                                                       │ │
│  │  Recent                                                               │ │
│  │  ───────────────────────────────────────────────────────────────     │ │
│  │  👤  Charles Dodgatse                         →                       │ │
│  │  👤  Eyram Mensah                             →                       │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Elements:**
- Search: Fuzzy search across staff names, actions, pages
- Pages: Quick navigation to all main screens
- Actions: Common tasks (add staff, export)
- Recent: Recently viewed/edited items
- Keyboard: Arrow keys to navigate, Enter to select, ESC to close

### 10.11 Responsive Design (Mobile)

```
┌────────────────────────────┐
│ LateWatch      ☰  🔔  👤  │
├────────────────────────────┤
│                            │
│  Dashboard                 │
│                            │
│  ┌──────────────────────┐ │
│  │  THIS WEEK           │ │
│  │  GHC 1,250           │ │
│  │  47 entries          │ │
│  │  +15% vs last week   │ │
│  └──────────────────────┘ │
│                            │
│  ┌──────────────────────┐ │
│  │ QUICK ACTIONS        │ │
│  │ [Enter Data]         │ │
│  │ [Export]             │ │
│  └──────────────────────┘ │
│                            │
│  ┌──────────────────────┐ │
│  │ RECENT ACTIVITY      │ │
│  │ • Jane marked late   │ │
│  │ • Export generated   │ │
│  └──────────────────────┘ │
│                            │
│        [⌘]                │
└────────────────────────────┘

Mobile Navigation (hamburger menu):
┌────────────────────────────┐
│ ✕                          │
│                            │
│ 📊 Dashboard               │
│ 👥 Staff                   │
│ ✏️ Entries                 │
│ 📥 Exports                 │
│ 📅 Calendar                │
│ ⚙️ Settings                │
│                            │
│ ─────────────────────────  │
│                            │
│ 👤 John Admin              │
│ Admin                      │
│                            │
│ [Sign Out]                 │
└────────────────────────────┘
```

**Mobile Adaptations:**
- Sidebar becomes hamburger menu
- Stats cards stack vertically
- Entry grid scrolls horizontally
- Command palette accessible via button

---

## 11. File Structure

```
latewatch/
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── staff/page.tsx
│   │   ├── entries/page.tsx
│   │   ├── exports/page.tsx
│   │   ├── calendar/page.tsx
│   │   └── settings/page.tsx
│   ├── actions/
│   │   ├── staff.ts
│   │   ├── entries.ts
│   │   ├── calendar.ts
│   │   └── exports.ts
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── middleware.ts                    # Clerk middleware
├── components/
│   ├── ui/                    # shadcn/ui components
│   ├── layout/
│   └── shared/
├── db/
│   ├── index.ts
│   ├── schema.ts
│   └── migrations/
├── lib/
│   ├── auth/
│   │   └── roles.ts                     # Role-based access helpers
│   ├── r2/
│   │   ├── client.ts                    # S3 client for Cloudflare R2
│   │   └── presigned.ts                 # Presigned URL helpers
│   ├── excel/
│   │   ├── template-loader.ts           # Load template from R2
│   │   └── cell-mapper.ts               # Map data to cells
│   └── utils/
│       ├── cn.ts                        # Class name utility
│       └── format.ts                    # Date/number formatting
├── hooks/
├── types/
├── env/
├── config/
└── public/
```

---

## 12. Environment Variables

```env
# Database (Neon)
DATABASE_URL=postgresql://...

# Clerk (auto-provisioned by Vercel Marketplace)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Cloudflare R2
CF_R2_ACCOUNT_ID=...
CF_R2_BUCKET=latewatch-templates
CF_R2_ACCESS_KEY_ID=...
CF_R2_SECRET_ACCESS_KEY=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Note:** Clerk environment variables are auto-provisioned when you install Clerk from Vercel Marketplace (`vercel integration add clerk`). Google OAuth is configured in the Clerk Dashboard, not via environment variables.

---

## 13. Deployment

### 13.1 Vercel Configuration

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true, // Enable PPR
  images: {
    domains: ['*.cloudflare.com'],
  },
};

export default nextConfig;
```

### 13.2 Deployment Steps

1. Create Neon database
2. Create Cloudflare R2 bucket
3. Install Clerk from Vercel Marketplace: `vercel integration add clerk`
4. Configure Google OAuth in Clerk Dashboard (optional)
5. Set remaining environment variables in Vercel
6. Deploy to Vercel
7. Run migrations: `drizzle-kit migrate`
8. Set admin role in Clerk Dashboard for first user

---

## 14. Acceptance Criteria

- [ ] Export matches template layout pixel-for-pixel
- [ ] Penalty computation matches all examples in Section 5.2
- [ ] HR/Admin can enter a full week quickly without manual Excel editing
- [ ] Audit log exists for all changes
- [ ] Theme follows system preference (dark/light/auto)
- [ ] Responsive design works on tablet
- [ ] Command palette (Cmd+K) navigation works
- [ ] All server actions validate with Zod
- [ ] All server actions check authorization

---

## 15. Milestones

| Phase | Focus | Duration |
|-------|-------|----------|
| M1 | Project scaffold, Clerk auth, Neon schema, R2 setup | Week 1 |
| M2 | Staff management, daily entry grid, penalty calculation | Week 2 |
| M3 | Template upload, Excel export | Week 3 |
| M4 | Monthly export, reports, polish | Week 4 |
| M5 | Testing, deployment, documentation | Week 5 |