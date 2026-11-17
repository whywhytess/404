# Requirements Traceability

Status values: `DONE` (implemented and its tests were run and passed), `PARTIAL`,
`NOT STARTED`, `BLOCKED`. Requirement text: SRD Tables 3.13 and 3.14.
Last updated: 2026-11-17. UI rows are covered by `tests/e2e/phase1-workflow.spec.ts`.

## Problem → requirement → design → verification (SRD Table 1.2)

| Problem | Evidence / finding | FR / NFR | Design | Verification | Result |
| --- | --- | --- | --- | --- | --- |
| P1 Setting up ZIP submissions is slow and inconsistent | Document analysis D5; interviews/questionnaire **not yet conducted** (SRD 3.4.2 TODO) | FR-10, FR-16, FR-27, FR-28, NFR-U1 | Upload Validator, Version Management, Instructor Review | UC tests; developer-run workflow benchmark | NOT STARTED |
| P2 Shared hosting lets one site affect others / the platform | Document analysis D3; origin model | FR-21–23, NFR-S2, NFR-S3 | ADR-001, ADR-006 | ST-01–04, ST-16–18 | NOT STARTED |
| P3 Per-site security policies are weak or missing | Document analysis D2 | FR-24–26, NFR-S1, NFR-C1 | ADR-007, ADR-008 | ST-05–13, header consistency, F01–F04 | NOT STARTED |

## Functional requirements

| FR | Pri | Status | Implementation | Tests |
| --- | :-: | --- | --- | --- |
| FR-01 Student registration | M | DONE (API + UI) | `routes/auth.ts` `POST /api/auth/register` | `auth.test.ts` FR-01 (3 tests) |
| FR-02 Sign in / sign out | M | DONE (API + UI) | `routes/auth.ts` login, logout, me; `middleware/session.ts` | `auth.test.ts` FR-02, CSRF, rate limit |
| FR-03 Admin creates, disables, resets staff | M | DONE (API + UI) | `routes/admin.ts` | `admin.test.ts` (5 tests) |
| FR-04 Permission matrix on every action | M | PARTIAL — enforced on all current routes; re-check as routes are added | `policy.ts`, `middleware/auth.ts` | `courses.test.ts` FR-04, every 403/404 assertion |
| FR-05 Admin creates course, assigns/changes instructor and TAs | M | DONE (API + UI) | `routes/courses.ts` POST `/`, POST/DELETE `/:id/staff` | `courses.test.ts` FR-05 (4 tests) |
| FR-06 Join code, regenerate | M | DONE (API + UI) | `auth/join-code.ts`, `POST /:id/join-code/rotate` | `courses.test.ts` FR-06/07; unit `helpers.test.ts` |
| FR-07 Student joins with code | M | DONE (API + UI) | `POST /api/courses/join` | `courses.test.ts` FR-06/07 |
| FR-08 Instructor creates and edits assignment | M | DONE (API + UI) | `routes/assignments.ts` | `assignments.test.ts` FR-08 |
| FR-09 Close/reopen; closed = no upload/rollback | M | DONE | `routes/assignments.ts`; `services/publish.ts` `assertOpenForChanges` (FOR SHARE vs FOR UPDATE), ADR-005 | `assignments.test.ts` FR-09; `uploads.test.ts` FR-09/FR-36 incl. close-during-publish race; e2e |
| FR-10 One ZIP per upload, open assignment, member | M | DONE | `routes/submissions.ts` (auth before body, multer 1 file) | `uploads.test.ts` FR-10; e2e upload |
| FR-11 Size / count / per-file limits | M | DONE | `zip-validator` + multer `fileSize` | `validator.test.ts` ST-15; `upload-limits.test.ts` |
| FR-12 Absolute paths, `..`, symlinks, forbidden types | M | DONE | `zip-validator/src/paths.ts`, `index.ts` | `validator.test.ts` ST-14/ST-15; e2e zip-slip rejection |
| FR-13 Root `index.html`, single folder strip, ignore `__MACOSX`/`.DS_Store` | M | DONE | `resolveRoot`, `isIgnored` | `validator.test.ts` FR-13 |
| FR-14 Rejection reason with file name | M | DONE | `zip-validator/src/messages.ts`; UI `SubmissionPanel` | `validator.test.ts`; `uploads.test.ts`; e2e |
| FR-15 Rule warnings | S | DONE (heuristic, advisory) | `zip-validator/src/warnings.ts` | `validator.test.ts` FR-15; e2e |
| FR-16 Numbered version, publish immediately | M | DONE | `services/publish.ts` | `uploads.test.ts` |
| FR-17 Version history | S | DONE | `GET /api/assignments/:id/submission`, `GET /api/submissions/:id/versions`; UI table | `uploads.test.ts`; e2e |
| FR-18 Roll back to previous (undoable) while open | S | DONE | `rollbackSubmission` | `uploads.test.ts`; e2e |
| FR-19 Keep files of current + previous only | S | DONE | `files_deleted_at` + delete after commit; `sweepStorage` | `uploads.test.ts` FR-17–19, sweep |
| FR-20 Atomic current-version switch | M | DONE | ADR-004; objects → verify → one transaction | `uploads.test.ts` NFR-R1 (storage failure, DB failure, concurrency) |
| FR-21 Random subdomain per student × assignment | M | PARTIAL — allocated (12 chars, ~61 bits, retired list); served in Phase 3 | `services/subdomain.ts` | `uploads.test.ts` |
| FR-22 Files only from content domain | M | NOT STARTED | ADR-001 | ST-03, ST-04 |
| FR-23 Short-lived signed token | M | NOT STARTED | ADR-006 | ST-16, ST-17 |
| FR-24 Uniform CSP, sandbox, headers | M | NOT STARTED | ADR-007 | header consistency, ST-05–12 |
| FR-25 Content type from allow-list + `nosniff` | M | NOT STARTED | — | ST-13 |
| FR-26 Rules on every assignment page | S | DONE (UI) | `apps/web/src/pages/AssignmentPage.tsx` `SubmissionRules` | `phase1-workflow.spec.ts` (rules heading visible) |
| FR-27 Submission list for review | M | DONE | `GET /api/assignments/:id/review`; `ReviewPage` | `uploads.test.ts` FR-27; e2e |
| FR-28 Sandboxed iframe, previous/next, new tab | M | NOT STARTED | — | ST-03, ST-10, ST-11 |
| FR-29 Take-down / restore with reason | S | NOT STARTED | — | — |
| FR-30 Audit log | S | PARTIAL — table, writer, admin viewer; take-down entries later | `audit.ts`, `GET /api/admin/audit-log` | `admin.test.ts`, `courses.test.ts`, `assignments.test.ts` |
| FR-31 Mobile/desktop preview widths | C | NOT STARTED | — | — |
| FR-32 Storage quota | S | NOT STARTED | — | — |
| FR-33 Uploads per student per assignment per hour | S | NOT STARTED | — | ST-19 |
| FR-34 Requests per subdomain per second | S | NOT STARTED | — | ST-19 |
| FR-35 Admin views/adjusts quotas | S | NOT STARTED | — | — |
| FR-36 Course end date stops uploads/rollbacks | S | PARTIAL — end date stored, editable; joining blocked after end; upload check in Phase 2 | `courses.ts` `courseHasEnded` | unit + `courses.test.ts` |
| FR-37 Retention deletion, 410, never reassigned | S | NOT STARTED | ADR-009 | — |

## Non-functional requirements

| NFR | Status | Notes |
| --- | --- | --- |
| NFR-S1 19 security cases pass | NOT STARTED | Phase 3–6 |
| NFR-S2 No student files on platform; no `Set-Cookie` from content; no cookie-based decisions | NOT STARTED | Platform side: API has no file routes yet |
| NFR-S3 Signed, bound, expiring tokens | NOT STARTED | ADR-006 |
| NFR-S4 Slow salted hash; HttpOnly/Secure/SameSite=Lax cookie | PARTIAL — Argon2id and HttpOnly/SameSite/no-Domain tested; `Secure` set when `NODE_ENV=production` (to verify on staging) | `auth.test.ts` |
| NFR-S5 HTTPS, TLS 1.2+, HSTS | NOT STARTED | Phase 7 |
| NFR-C1 F01–F04 work in 3 engines | NOT STARTED | F01–F04 written by developer (SRD 3.10) |
| NFR-R1 Failed upload never changes published version | DONE | Fault injection in `uploads.test.ts` (storage failure mid-upload, DB failure before commit) |
| NFR-R2 Backup and restore | NOT STARTED | Phase 7 |
| NFR-U1 Publish in ≤ 3 steps | NOT STARTED | Phase 2 UI |
| NFR-U2 Messages name the file and the fix | DONE | `messages.ts`; test asserts every warning names its file |
| NFR-M1 ≥ 70 % coverage of validator/token/header modules; CI | PARTIAL — validator 95 % lines; token/header modules not written yet; CI not yet run on GitHub (no remote) | `vitest --coverage` |
| NFR-P1 Minimal personal data, retention deletion | PARTIAL — only name, e-mail, role, membership stored; deletion in Phase 5 | schema `0001_init.ts` |
