# Security notes

## Dependency advisories

### Fixed

- **Next.js → 16.4.6** (from 16.2.11). Clears every outstanding Next.js
  advisory (remote code execution in image optimisation / `next/og` /
  `use cache`, SSRF, cache poisoning, Server Action DoS) and, with it, the
  high-severity `sharp` and `postcss` advisories it pulled in. Earlier
  bumps (16.2.2 → 16.2.11) cleared several **Middleware/Proxy bypass**
  issues; those matter because `src/proxy.ts` is the primary
  authentication gate. Route-level `enforceRole(['admin'])` guards on the
  sensitive routes are the defense-in-depth backstop for that class of bug.

- **zod → 4.6.7** (memory exhaustion on oversized collections) and the
  non-breaking `npm audit fix` set (dompurify, js-yaml, brace-expansion,
  nanoid, source-map-js).

### Deliberately deferred (`npm audit` still reports these)

These are left in place on purpose. The automated `npm audit fix --force`
is **not** safe to run — it would downgrade ExcelJS 4.x → 3.x (a breaking
change that would break all Excel exports).

- **uuid `<11.1.1`** (moderate) via **exceljs@4.4.0** (`uuid@^8.3.0`). The
  advisory affects uuid's v3/v5/v6 code path only when a `buf` argument is
  supplied; ExcelJS generates random IDs without that argument, so the
  vulnerable path is not reachable. The only npm "fix" is the destructive
  ExcelJS downgrade. Revisit if ExcelJS ships a release on uuid `>=11.1.1`.

- **esbuild** (moderate) via **drizzle-kit** (dev tooling). The advisory
  concerns the local esbuild dev server; it is not part of the production
  runtime. Revisit when drizzle-kit updates its esbuild dependency.

- **typescript-eslint / minimatch** (moderate) via **eslint-config-next**
  (lint tooling only, never shipped). npm's only "fix" is a downgrade to
  the Next 15 lint config.

## Hardening in place

- **Security headers on every response** (`next.config.ts`):
  `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options:
  DENY` (no clickjacking of Sign in / Sign out / approvals),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a
  `Permissions-Policy` that leaves location to LateWatch's own pages and
  turns camera, microphone and payment off.
- **Nothing sensitive in `public/`**: every file there is downloadable by
  anyone. A test fails if a spreadsheet, CSV, JSON or PDF is added.
- **Cron secret** compared in constant time (`reminder-cron-guard.ts`).
- **Crash reports** (`/api/client-errors`) are size-capped and limited to
  10 a minute per account.
