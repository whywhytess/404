# Architecture Decision Records

Each ADR states the context, the decision and its consequences, and names the tests that
check it. Status: **Accepted** = implemented or binding; **Proposed** = to be implemented in
a later phase and may still change. The SRD is the requirements baseline; where an ADR goes
beyond the SRD it says so.

---

## ADR-001 Two registrable domains, one first-level subdomain per submission — Accepted (SRD)

- **Context.** Student code is untrusted (P2). Browsers isolate by origin; same-site siblings
  can still toss cookies.
- **Decision.** Platform on its own registrable domain; student files only on a separate
  content domain, at `https://<random>.<content-domain>/` (first level, so Cloudflare's free
  certificate covers it — SRD 3.9.4). The content domain is not registered in the PSL.
- **Consequences.** Cookie tossing between sibling submissions remains a documented residual
  risk (SRD limitation 4). The content server never uses cookies, so access control is
  unaffected.
- **Tests.** ST-01, ST-02, ST-18 (Phase 3/6).
- **Local development.** Two hostnames that are different *sites* are needed. Plan: platform
  on `127.0.0.1`, content on `*.localhost` (an IP and `localhost` are different sites). This
  does not prove production cookie behaviour; key isolation tests must be repeated on staging.

## ADR-002 Global accounts + course-scoped roles — Accepted (implemented)

- **Context.** SRD 3.8.6: one person can be a student in one course and a TA in another.
  FR-03: instructors/TAs are accounts created by administrators. FR-05: administrators assign
  a course's staff.
- **Decision.** `users.account_type ∈ {student, staff, admin}` records how the account was
  created. `enrollments(course_id, user_id, role)` with one role per user per course carries
  all course permissions. Only `staff` accounts can be assigned as instructor/TA; any
  non-admin account can join a course as a student with the join code. Administrators act on
  every course but are not enrolled.
- **Enforcement.** `apps/api/src/policy.ts` (`authoriseCourse`, `authoriseAssignment`).
  A user with no relation to a course receives **404** (IDs cannot be probed); a member
  without the required role receives **403**.
- **Tests.** `courses.test.ts` "FR-04 course-scoped access", `assignments.test.ts`.

## ADR-003 ZIP validation before extraction, bounded extraction — Proposed (Phase 2)

- Read the central directory first; reject on entry count, declared sizes, paths
  (absolute, `..`, backslash, drive letters, NUL, duplicates after normalisation), symlinks
  and disallowed extensions *before* writing anything. Then stream entries with a running
  byte counter that aborts at the limit regardless of declared sizes (Table 3.21).
- Never use the system `unzip`. Nothing is written outside a per-upload temporary
  directory, or directly to object storage.

## ADR-004 Publish order: immutable objects first, then one DB transaction — Accepted (SRD 3.9.1)

- Write all files under `versions/{versionId}/` → verify → in one PostgreSQL transaction
  insert the version row and switch `submissions.current_version_id`. The two stores do
  **not** share a transaction. If any step before the commit fails, the database is
  unchanged and a periodic job deletes unreferenced `versions/*` prefixes.
- **Tests.** Fault-injection tests (NFR-R1), Phase 2.

## ADR-005 Closing an assignment fixes the current version — Accepted (SRD FR-09)

- **Decision.** No separate marking-snapshot table. A closed assignment accepts no uploads or
  rollbacks, so `current_version_id` of every submission cannot change while it is closed.
  Close/reopen updates the assignment row under `SELECT … FOR UPDATE`; the upload/rollback
  transaction (Phase 2) locks the same row `FOR SHARE` and re-checks `status = 'open'` before
  switching the pointer, so a close cannot race with a publish.
- **Departure from the execution plan.** The plan proposed `marking_snapshots` and
  `review_epoch`. The user chose the SRD (2026-11-17); reopening simply allows uploads again.
- **Tests.** `assignments.test.ts` FR-09 (status, audit); race test in Phase 2.

## ADR-006 Stateless signed access token in the URL path — Accepted (SRD 3.9.3)

- HMAC-SHA-256 token with subdomain, user ID, role-dependent expiry (≤ 1 h students,
  ≤ 4 h instructors/TAs), key shared by API and content server, carried as
  `/_t/<token>/…`. **Not** pinned to a version: the content server maps subdomain →
  current version (SRD; the plan's version pinning is not adopted).
- It is a **bearer** credential: forwarding works until expiry (SRD limitation 5).
  Mitigations: short lifetime, `Referrer-Policy: no-referrer`, token redaction in all logs.
- Review page shows a "refresh preview" button on expiry instead of reloading automatically.

## ADR-007 One uniform CSP + sandbox header set — Accepted (SRD Appendix D)

- Header values exactly as SRD Appendix D, added by one function to every content response
  (200, 3xx, 4xx). Students cannot weaken it. Verified by a header-consistency test.

## ADR-008 Relative paths only — Accepted (SRD rule 6)

- Root-absolute URLs (`/css/x.css`) escape the token prefix and are **not** served; the
  validator warns about them (FR-15). Files are never rewritten.

## ADR-009 Retention and deletion — Proposed (Phase 5)

- FR-19: keep files of current + previous versions only. FR-37: after course end date +
  retention period, delete files, versions and submissions; subdomains return 410 and are
  never reassigned (a tombstone table keeps used subdomains).

## ADR-010 Minimal deployment — Proposed (Phase 7)

- Single VPS, Docker Compose, reverse proxy with host allow-list, Cloudflare DNS/TLS,
  S3-compatible storage, daily DB backup with a restore drill.

## ADR-011 CSRF defence by Origin check — Accepted (implemented)

- **Context.** The platform uses a cookie session (NFR-S4). SameSite=Lax blocks most
  cross-site POSTs but not all (e.g. same-site sibling origins).
- **Decision.** Every non-GET/HEAD/OPTIONS request under `/api` must carry an `Origin`
  header equal to `PLATFORM_ORIGIN`; otherwise 403 `CSRF_ORIGIN_MISMATCH`. Modern browsers
  always send `Origin` on such requests, so no token round-trip is needed.
- **Tests.** `auth.test.ts` "CSRF origin check" (missing Origin, content-domain Origin).

## ADR-012 Local S3-compatible storage: SeaweedFS instead of MinIO — Accepted

- **Context.** SRD Table 3.24 names MinIO for development. On 2026-11-17 the MinIO images
  could not be pulled (Docker Hub: "repository does not exist"; quay.io: 401).
- **Decision.** Use SeaweedFS 4.54 (`infra/compose.yaml`), which exposes the same S3 API.
  The application talks to it only through the S3 API, so production can use any
  S3-compatible service (e.g. Cloudflare R2) unchanged.
- **Consequence.** SRD Table 3.24 wording ("MinIO for local development") should be
  updated to "an S3-compatible server (SeaweedFS) for local development" before submission.

## ADR-013 Password hashing and sessions — Accepted (implemented)

- Argon2id (`@node-rs/argon2`, 19 MiB, t=2, p=1). Sessions in PostgreSQL
  (`connect-pg-simple`), ID regenerated at sign-in, 8 h rolling lifetime.
- `users.session_version` is bumped on disable, password reset and password change; any
  session with an old version is destroyed on its next request.
- Staff accounts get a one-time temporary password shown once to the administrator; until it
  is changed, every other endpoint returns `PASSWORD_CHANGE_REQUIRED`.

## ADR-014 Allow `blob:` for images and media — Accepted (2026-11-17, user decision)

- **Context.** The external-sample measurement (`docs/COMPATIBILITY_REPORT.md`) showed that a
  common tutorial pattern — fetch an image from the site, then show it with
  `URL.createObjectURL()` (MDN "Can store", X1) — was blocked by `img-src 'self' data:`.
- **Decision.** `img-src 'self' data: blob:` and `media-src 'self' blob:`. Nothing else changes:
  `script-src 'self'`, `worker-src 'none'`, `frame-src 'none'` and `connect-src 'self'` stay as
  they are. Blob URLs can only be created by the page's own script from data it already holds,
  so this adds no new way to load code or to send data out.
- **Consequences.** X1's product images now display in all three engines; the `BLOB_URL`
  upload warning was removed. SRD §3.9.3, Table 3.20 and Appendix D updated.
- **Tests.** `security.test.ts` (exact header string; script/worker/frame/connect unchanged);
  `browser-attacks.spec.ts` "ADR-014" (blob image loads; blob script and blob worker blocked,
  in Chromium, Firefox and WebKit); ST-07 still passes.
