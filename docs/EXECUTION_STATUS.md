# Execution Status

Read this first at the start of every session. Labels: `[DONE]` = implemented **and** the
listed command was run and passed; `[PARTIAL]`; `[BLOCKED]`; `[NOT STARTED]`.

## Current phase

Phase 3 (Isolated publishing): **core of Gate P3 passed** — two submissions on two
independent origins, tokens checked on every request, uniform headers on every response,
platform never serves student files. Browser attack tests ST-01–ST-12 pass in Chromium with
positive controls (see `docs/SECURITY_TEST_REPORT.md`).

## Environment notes

- Docker runtime is **Colima** (`colima start`), not Docker Desktop.
- Local ports: PostgreSQL `127.0.0.1:55432`, S3-compatible storage `127.0.0.1:59000`
  (another project already uses 5432 and 9000; do not touch its containers).
- Object storage is SeaweedFS 4.54, because MinIO images can no longer be pulled (ADR-012).
- TypeScript pinned to 6.0 (typescript-eslint does not support TS 7 yet).
- No Git remote yet, so the GitHub Actions workflow has not run on GitHub.

## Decisions taken with the user (2026-11-17)

- SRD wins over the execution plan where they conflict:
  no marking-snapshot table (ADR-005); token not version-pinned (ADR-006);
  F01–F04 written by the developer + 4–6 unmodified MDN samples (SRD 3.10);
  cross-browser only for ST-02, ST-07, ST-11 and the sample sites.

---

## Session 2026-11-17

### Completed

- [DONE] T-001 workspace (pnpm monorepo, TS strict, ESLint, Prettier, Vitest, CI file)
- [DONE] T-002 Compose: PostgreSQL 17 + SeaweedFS; separate `webcove_test` database
- [DONE] T-003 migration `0001_init`, `db:seed:demo` (synthetic accounts)
- [DONE] T-004 FR-01/02 auth API; Argon2id; session regenerate; CSRF Origin check; login rate limit
- [DONE] T-005 FR-03 admin staff accounts (temporary password, disable, reset, session invalidation)
- [DONE] T-006 FR-05/06/07 courses, staff assignment, join codes
- [DONE] T-007 FR-08 assignments; FR-09 close/reopen (status + audit; upload refusal pending Phase 2); FR-27 review skeleton
- Baseline docs: this file, `REQUIREMENTS_TRACEABILITY.md`, `ARCHITECTURE_DECISIONS.md`,
  `RISK_REGISTER.md`, `IMPLEMENTATION_BACKLOG.md`
- [DONE] T-008 web front end (React + Vite): sign-in/register/change password, dashboard + join,
  course page (join code, staff, assignments), assignment page (edit, close/reopen, rules),
  review list, administration (courses, staff accounts, audit log)
- Fix: login/join rate-limit keys now use `ipKeyGenerator` (IPv6 /56 grouping); found by the E2E run
- Fix: sign-out does a full page reload so the next user is not sent to the previous user's page
- Commits: `7b7c170`, `1f81789`, and the Phase 1 front-end commit

### Phase 2 (same day)

- [DONE] T-009 `packages/zip-validator` (central-directory checks, bounded extraction, warnings)
- [DONE] T-010 migration `0002_submissions` (submissions, versions, retired_subdomains)
- [DONE] T-011 `packages/storage` (S3 API) + upload endpoint + atomic publish + sweep
- [DONE] T-012 uploads/rollbacks refused when closed or course ended; close-during-publish race test
- [DONE] T-013 version history, rollback (undoable), current + previous files only
- UI: student upload panel (progress, errors, warnings, history, rollback); review columns
- Found and fixed: SeaweedFS keeps empty folder names after deletion (tests now count objects);
  TypeScript 6 needs `"types": ["node"]` in packages

### Phase 3 (same day)

- [DONE] T-014 `packages/security`: HMAC-SHA-256 tokens (student 1 h, staff 4 h, max-lifetime and
  future-iat checks), Appendix D header set
- [DONE] T-015 `apps/content`: host → submission → token → file; 301 for folders; 400 for
  traversal/encoded separators; 403 no/invalid/expired token or taken down; 404; 405; 410 retired;
  identical headers on every response; never reads or sets cookies; token redacted in logs
- [DONE] T-016 local two-site setup: platform `127.0.0.1:5173`, content `*.localhost:4000`
- [DONE] T-017 review page (list + sandboxed iframe, previous/next, open in new tab, refresh
  preview on expiry) and student "View my published site" link
- `POST /api/submissions/:id/view-token` (owner, course staff, admin; classmates 404)

- [DONE] T-018 take-down / restore with reason + audit; review UI buttons
- [DONE] T-019 shared attack fixture (`tests/fixtures/attack-site`) + 14 Playwright tests for
  ST-01–ST-12 (ST-10/ST-11 in review iframe and direct). Finding: a directly opened page can
  navigate its own tab (ST-11 direct) — documented as residual risk, platform tab unaffected

### Verification

| Command | Result |
| --- | --- |
| `pnpm infra:up` | PASS — both containers healthy |
| `pnpm db:migrate` | PASS — applied `0001_init` |
| `pnpm db:seed:demo` | PASS |
| `pnpm lint` | PASS (0 problems) |
| `pnpm typecheck` | PASS |
| `pnpm format:check` | PASS |
| `npx vitest run` | PASS — 12 files, 114 tests |
| `vitest --coverage` (security) | 97.1 % lines |
| `vitest --coverage` (zip-validator) | 95.1 % lines, 82.2 % branches |
| `pnpm test:e2e` (Playwright, Chromium) | PASS — 5 tests: admin → instructor → student join → upload/reject/rollback → view site on its own `*.localhost` origin (JS runs, `document.cookie` empty) → review iframe → close |
| `pnpm test:security` (Chromium) | PASS — 14 tests (ST-01–ST-12, positive controls) |
| `npx playwright test` (e2e + security) | PASS — 19 tests |
| GitHub Actions | NOT RUN — no remote configured |

### Risks / decisions

- ADR-011 (CSRF by Origin check), ADR-012 (SeaweedFS), ADR-013 (Argon2id, session_version).
- SRD Table 3.24 says "MinIO for local development" — should be updated (ADR-012).

### Blockers

- None for development. For later phases: two real domains + VPS (Phase 7) — not purchased.
- SRD 3.4.2 interviews/questionnaire are user actions; no data has been invented.

### Next 3 tasks

1. T-020 F01–F04 sample sites (developer-written) + 4–6 unmodified MDN samples (licence check first).
2. T-021 quotas and rate limits (FR-32–35) → ST-19.
3. Cross-browser runs (Firefox, WebKit) for ST-02, ST-07, ST-11 and the samples.
