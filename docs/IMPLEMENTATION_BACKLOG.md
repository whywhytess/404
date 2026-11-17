# Implementation Backlog

Ordered by dependency and priority (trust boundary > authorisation > ZIP safety > atomic
publish > close/freeze > review loop > automated security tests > deployment > Should > Could).

| ID | Task | FR / NFR / ST | Depends on | Acceptance | Status |
| --- | --- | --- | --- | --- | --- |
| T-001 | Workspace, lint, typecheck, Vitest, CI | NFR-M1 | — | Checks pass locally | DONE |
| T-002 | Compose: PostgreSQL + S3-compatible storage | — | — | Containers healthy | DONE |
| T-003 | Migration 0001, demo seed | — | T-002 | `db:migrate`, `db:seed:demo` succeed | DONE |
| T-004 | Auth API, sessions, CSRF, login rate limit | FR-01/02, NFR-S4 | T-003 | `auth.test.ts` | DONE |
| T-005 | Admin staff API | FR-03 | T-004 | `admin.test.ts` | DONE |
| T-006 | Courses, staff assignment, join codes | FR-05/06/07 | T-004 | `courses.test.ts` | DONE |
| T-007 | Assignments, close/reopen, review skeleton | FR-08/09/27 | T-006 | `assignments.test.ts` | DONE |
| T-008 | Web front end for Phase 1 flows | FR-01–09 UI | T-004–007 | Three roles can complete the Phase 1 flow in a browser | DONE (`tests/e2e/phase1-workflow.spec.ts`) |
| T-009 | ZIP validator package | FR-11–15, ST-14/15 | — | Malicious fixtures rejected; unit coverage ≥ 70 % | NOT STARTED |
| T-010 | Migration 0002: submissions, versions, used subdomains | FR-16/21 | T-003 | — | NOT STARTED |
| T-011 | Storage adapter (S3 API) + upload endpoint + atomic publish | FR-10/16/20, NFR-R1 | T-009, T-010 | Fault-injection tests pass | NOT STARTED |
| T-012 | Upload refused when closed / course ended (row lock) | FR-09, FR-36 | T-011 | Race test | NOT STARTED |
| T-013 | Version history, rollback, keep current + previous files | FR-17/18/19 | T-011 | — | NOT STARTED |
| T-014 | Token library (sign/verify) | FR-23, NFR-S3 | — | Unit tests, ST-17 | NOT STARTED |
| T-015 | Content server: host → submission → token → file; headers; MIME | FR-21–25 | T-011, T-014 | Header consistency test; ST-13/16/17/18 | NOT STARTED |
| T-016 | Local two-site routing (platform 127.0.0.1, content *.localhost) | ADR-001 | T-015 | Two submissions in two origins | NOT STARTED |
| T-017 | Review page: iframe, previous/next, new tab, refresh on expiry | FR-27/28 | T-015, T-008 | E2E | NOT STARTED |
| T-018 | Take-down / restore + audit | FR-29/30 | T-015 | Valid token refused after take-down | NOT STARTED |
| T-019 | Playwright attack fixture + ST-01–ST-12 | NFR-S1 | T-016 | Positive controls + violation events | NOT STARTED |
| T-020 | F01–F04 written by developer; 4–6 unmodified MDN samples | NFR-C1, SRD 3.10 | T-016 | 3 engines; restriction-cost table | NOT STARTED |
| T-021 | Quotas, upload/request rate limits, admin quota page | FR-32–35, ST-19 | T-011 | — | NOT STARTED |
| T-022 | Retention deletion, 410, tombstones | FR-37, NFR-P1 | T-013 | Simulated-clock test | NOT STARTED |
| T-023 | Deployment, TLS, backups, restore drill, manuals | NFR-S5, NFR-R2 | all | Clean deploy reproducible | NOT STARTED |
