# Execution Status

Read this first at the start of every session. Labels: `[DONE]` = implemented **and** the
listed command was run and passed; `[PARTIAL]`; `[BLOCKED]`; `[NOT STARTED]`.

## Current phase

Phase 1 (Trusted workflow skeleton): API done, web front end in progress.
Next: T-008 front end → Phase 2 (ZIP validator, versions, atomic publish).

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
- Commit: `7b7c170`

### Verification

| Command | Result |
| --- | --- |
| `pnpm infra:up` | PASS — both containers healthy |
| `pnpm db:migrate` | PASS — applied `0001_init` |
| `pnpm db:seed:demo` | PASS |
| `pnpm lint` | PASS (0 problems) |
| `pnpm typecheck` | PASS |
| `pnpm format:check` | PASS |
| `npx vitest run` | PASS — 5 files, 39 tests (unit 6, integration 33) |
| GitHub Actions | NOT RUN — no remote configured |

### Risks / decisions

- ADR-011 (CSRF by Origin check), ADR-012 (SeaweedFS), ADR-013 (Argon2id, session_version).
- SRD Table 3.24 says "MinIO for local development" — should be updated (ADR-012).

### Blockers

- None for development. For later phases: two real domains + VPS (Phase 7) — not purchased.
- SRD 3.4.2 interviews/questionnaire are user actions; no data has been invented.

### Next 3 tasks

1. T-008 web front end for Phase 1 flows (login/register, dashboard, join, admin course/staff, instructor assignments, close/reopen).
2. T-009 ZIP validator package with malicious fixtures (ST-14, ST-15).
3. T-010/T-011 submissions + versions schema, S3 adapter, atomic publish with fault injection.
