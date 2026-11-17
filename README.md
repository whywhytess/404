# Web Cove

Secure web assignment hosting platform (USM CAT404 Software Engineering Major Project, 2026/2027).

Students upload a static website as a ZIP; each submission is published on its own random
subdomain of a separate content domain, under one server-enforced security policy, and
instructors/TAs review submissions in a sandboxed iframe.

> Status: under construction. See [`docs/EXECUTION_STATUS.md`](docs/EXECUTION_STATUS.md)
> for what is implemented and verified.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/api` | Platform API (Node.js + Express + TypeScript, PostgreSQL via Kysely) |
| `apps/content` | Content server for the untrusted content domain (Phase 3) |
| `apps/web` | Platform front end (React + Vite) |
| `packages/shared` | Types and error codes shared by all apps |
| `infra` | Docker Compose for local PostgreSQL and S3-compatible storage |
| `docs` | Status, traceability, ADRs, risks, backlog |

## Local setup

Requirements: Node.js 22+, pnpm, Docker (Docker Desktop or Colima).

```bash
cp .env.example .env          # then set SESSION_SECRET to a long random string
pnpm install
pnpm infra:up                 # PostgreSQL on 127.0.0.1:55432, object storage on 127.0.0.1:59000
pnpm db:migrate
pnpm db:seed:demo             # optional: synthetic demo accounts (printed once)
pnpm --filter @webcove/api dev
```

## Checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration         # needs `pnpm infra:up`; uses the separate webcove_test database
```
