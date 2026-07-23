# Security notes

## Dependency advisories

### Fixed

- **Next.js → 16.2.11** (from 16.2.2). Clears all outstanding Next.js
  advisories, including several **Middleware/Proxy bypass** issues
  (dynamic route parameter injection, segment-prefetch routes),
  unauthenticated Server Function endpoint disclosure, SSRF, cache
  poisoning, and DoS. These matter because `src/proxy.ts` is the primary
  authentication gate; a proxy-bypass bug would let requests skip it.
  Route-level `enforceRole(['admin'])` guards on the sensitive routes
  (entries, staff, exports) are the defense-in-depth backstop for this
  class of bug.

### Deliberately deferred (`npm audit` still reports these)

These are left in place on purpose. The automated `npm audit fix --force`
is **not** safe to run — it would downgrade ExcelJS 4.x → 3.x (a breaking
change that would break all Excel exports).

- **sharp `<0.35.0`** (high — libvips CVEs). Pulled in transitively by
  Next (`sharp@^0.34.5`); the Next 16.2.x line does not yet ship a newer
  sharp. These CVEs require processing attacker-controlled images through
  sharp/libvips. LateWatch does not do user image processing, so the
  attack surface is effectively nil. Revisit when Next bumps sharp to
  `>=0.35.0`.

- **uuid `<11.1.1`** (moderate) via **exceljs@4.4.0** (`uuid@^8.3.0`). The
  advisory affects uuid's v3/v5/v6 code path only when a `buf` argument is
  supplied; ExcelJS generates random IDs without that argument, so the
  vulnerable path is not reachable. The only npm "fix" is the destructive
  ExcelJS downgrade. Revisit if ExcelJS ships a release on uuid `>=11.1.1`.

- **esbuild** (moderate) via **drizzle-kit** (dev tooling). The advisory
  concerns the local esbuild dev server; it is not part of the production
  runtime. Revisit when drizzle-kit updates its esbuild dependency.
