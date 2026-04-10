# LateWatch - GRA Lateness Tracking System

Enterprise-grade lateness tracking system for Ghana Revenue Authority (GRA).

## 🚀 Features

- **Staff Management**: Add, edit, and manage staff members
- **Daily Entry Grid**: Fast data entry for tracking lateness
- **Automated Penalty Calculation**: 
  - GHC 10 base penalty for arriving after 8:30 AM
  - GHC 5 per full hour late
  - GHC 2 for not signing out
- **Weekly/Monthly Excel Exports**: Generate formatted reports
- **Holiday Calendar Management**: Mark holidays and track work days
- **Role-Based Access Control**: Admin, HR, and Viewer roles
- **Audit Trail**: Complete logging of all system changes
- **Dark Mode Support**: Automatic theme switching

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **UI Library** | shadcn/ui v3 + Tailwind CSS v4 |
| **Database** | Neon Postgres + Drizzle ORM |
| **Auth** | Clerk (Vercel Marketplace) |
| **Storage** | Cloudflare R2 |
| **Validation** | Zod |
| **Excel** | ExcelJS |
| **Charts** | Recharts |
| **Deployment** | Vercel |

## 📋 Prerequisites

- Node.js 20+ 
- npm or yarn
- Neon PostgreSQL database
- Clerk account (for authentication)
- Cloudflare R2 account (for file storage)

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd latewatch
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your credentials:

```bash
# Clerk Authentication (Vercel Marketplace)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# Neon PostgreSQL Database
DATABASE_URL=postgresql://...

# Cloudflare R2 Storage
CF_R2_ACCOUNT_ID=...
CF_R2_ACCESS_KEY_ID=...
CF_R2_SECRET_ACCESS_KEY=...
CF_R2_BUCKET=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Set Up Database

```bash
# Generate database tables
npm run db:push

# Open Drizzle Studio (optional, for visual DB management)
npm run db:studio
```

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📁 Project Structure

```
latewatch/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/             # Authentication routes
│   │   │   ├── sign-in/        # Sign-in page
│   │   │   └── sign-up/        # Sign-up page
│   │   ├── dashboard/          # Dashboard page
│   │   ├── staff/              # Staff management
│   │   ├── entries/            # Daily entry grid
│   │   ├── exports/            # Export center
│   │   ├── calendar/           # Holiday calendar
│   │   └── settings/           # User settings
│   ├── components/             # React components
│   │   ├── ui/                 # Reusable UI components
│   │   ├── layout/             # Layout components
│   │   ├── forms/              # Form components
│   │   ├── tables/             # Table components
│   │   └── charts/             # Chart components
│   ├── lib/                    # Utility libraries
│   │   ├── auth/               # Authentication helpers
│   │   ├── db/                 # Database configuration
│   │   ├── r2/                 # Cloudflare R2 client
│   │   ├── validation/         # Zod schemas
│   │   └── utils.ts            # Utility functions
│   ├── actions/                # Server Actions
│   │   ├── staff.ts            # Staff management actions
│   │   ├── entries.ts          # Entry management actions
│   │   ├── calendar.ts         # Calendar actions
│   │   ├── exports.ts          # Export actions
│   │   └── audit.ts            # Audit log actions
│   └── db/                     # Database schema
│       ├── schema.ts           # Drizzle schema
│       └── index.ts            # Database client
├── public/                     # Static assets
├── .env.local                  # Environment variables (not in git)
├── drizzle.config.ts           # Drizzle configuration
├── middleware.ts               # Clerk middleware
└── package.json
```

## 🔐 Authentication & Authorization

### Setting Up Clerk

1. Install Clerk from Vercel Marketplace
2. Create an application in Clerk dashboard
3. Enable Email/Password and Google OAuth providers
4. Add your domain to allowed domains
5. Copy API keys to `.env.local`

### Setting User Roles

After a user signs up, set their role in Clerk Dashboard:

1. Go to Users → Select user
2. Click "Metadata" tab
3. Add to `privateMetadata`:
   ```json
   {
     "role": "admin"
   }
   ```

### Role Permissions

| Role | Permissions |
|------|-------------|
| `admin` | Full access: staff management, entry CRUD, exports, template upload, role assignment |
| `hr` | Entry CRUD, exports, view staff |
| `viewer` | View only |

## 💰 Penalty Calculation

The system automatically calculates penalties based on arrival time:

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

## 📊 Database Schema

The system uses the following tables:

- `staff` - Staff member information
- `lateness_entry` - Daily lateness records
- `work_calendar` - Holiday and work day tracking
- `audit_event` - Audit trail for all changes
- `template_version` - Excel template storage

## 🚢 Deployment

### Deploy to Vercel

```bash
vercel deploy --prod
```

Or connect your Git repository to Vercel for automatic deployments.

### Environment Variables

Make sure to add all environment variables in Vercel dashboard:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DATABASE_URL`
- `CF_R2_ACCOUNT_ID`
- `CF_R2_ACCESS_KEY_ID`
- `CF_R2_SECRET_ACCESS_KEY`
- `CF_R2_BUCKET`

## 📝 Available Scripts

```bash
# Development
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint code
npm run lint

# Database commands
npm run db:generate   # Generate Drizzle migrations
npm run db:push       # Push schema to database
npm run db:studio     # Open Drizzle Studio
```

## 🎨 Design System

### Colors

**Light Mode:**
- Background: `#FFFFFF`
- Card: `#F9FAFB`
- Border: `#E5E7EB`
- Primary: `#2563EB` (blue-600)
- Success: `#10B981` (emerald-500)
- Warning: `#F59E0B` (amber-500)
- Danger: `#EF4444` (red-500)

**Dark Mode:**
- Background: `#0A0A0A`
- Card: `#171717`
- Border: `#262626`
- Primary: `#3B82F6` (blue-500)

### Typography
- Headings/Body: Inter
- Monospace (time/amounts): JetBrains Mono

## 🔒 Security

- All routes protected by Clerk authentication
- Role-based access control on all server actions
- Zod validation on all inputs
- SQL injection prevention via Drizzle ORM
- Audit trail for all data changes

## 📄 License

Private - For internal use only

## 👥 Support

For issues or questions, contact the development team.
