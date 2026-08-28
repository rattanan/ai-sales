<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# InsightKM contributor guide

This file is the short operational guide for engineers and coding agents working
in this repository. Keep it current when the architecture, commands, or critical
invariants change. The Next.js-managed block above must remain intact; add
project-specific guidance outside its markers.

## Start here

- Read `README.md` for product scope, local setup, environment variables, and
  verification commands.
- Read the relevant document under `docs/` before changing a subsystem. The ADRs
  in `docs/adr/` define runtime and queue decisions; phase documents are useful
  historical delivery and verification records, not a substitute for checking
  the current code, migrations, and tests.
- This repository uses Next.js 16.3. Before changing framework behavior, read the
  matching guide in `node_modules/next/dist/docs/`. Do not rely on remembered
  Next.js APIs. In particular, check the bundled docs for Server/Client
  Components, Server Actions, Route Handlers, caching, and request APIs.
- Inspect `git status` before editing. Preserve unrelated work already present in
  the worktree.

## Runtime and repository map

InsightKM is a TypeScript modular monolith with separate web and worker
processes. PostgreSQL is the system of record; Redis/BullMQ is transport for
background work, never the source of business truth.

- `app/`: Next.js App Router pages, layouts, loading/error boundaries, and Route
  Handlers. Route groups include public authentication and the protected
  workspace.
- `components/`: shared UI and domain presentation. Reuse `components/ui/`
  primitives before introducing another base component.
- `features/`: Server Actions and feature-level mutation entry points.
- `schemas/` and `types/`: Zod input/environment contracts and stable result
  types shared across boundaries.
- `server/auth/`: session-derived organization/workspace context, role and
  permission checks, and resource ACL decisions.
- `server/repositories/`: tenant-scoped persistence reads.
- `server/services/`: domain orchestration, transactions, audit behavior,
  encryption, retrieval, analysis, and integrations.
- `server/connectors/`: database adapters and the read-only SQL safety boundary.
- `packages/`: code shared with background jobs, including AI, knowledge,
  insights, queue, and operations packages.
- `apps/worker/`: NestJS application-context worker; it does not expose an HTTP
  server.
- `prisma/`: schema, committed migrations, and explicit development seed.
- `generated/prisma/`: generated output. Never edit it by hand.
- `tests/unit/`, `tests/integration/`, and `e2e/`: Vitest and Playwright coverage.
- `docs/operations/`, `scripts/operations/`, `deploy.sh`, Dockerfiles, and
  `docker-compose.yml`: operational paths. Do not deploy, restore, or rotate
  production state unless the task explicitly asks for it.

Pages and HTTP entry points should stay thin. Put reusable business rules in a
service, tenant-scoped data access in a repository/service boundary, untrusted
input contracts in `schemas/`, and interactive browser-only behavior in a
narrow Client Component.

## Local development

Requirements are Node.js 22+, npm, and Docker for PostgreSQL, Redis, the worker,
and connector integration fixtures. npm is the package manager; commit
`package-lock.json` when dependencies change.

```bash
cp .env.example .env
npm run dev:local
```

`dev:local` installs changed dependencies, starts PostgreSQL and Redis, generates
the Prisma client, deploys pending migrations, and runs the Next.js app plus
worker in watch mode. It does not seed automatically; run `npm run db:seed`
explicitly when development seed data is needed. Review `.env` before using it:
never point development commands or integration tests at an unknown or
production database.

For manual startup, use:

```bash
npm install
docker compose up -d --wait postgres redis
npm run db:generate
npm run db:deploy
npm run db:seed
npm run worker:watch
npm run dev
```

Run the worker and web app in separate terminals. The default web URL is
`http://localhost:3000`. See `README.md` for seeded development accounts and the
required administrator variables; no password is hardcoded in the repository.

## Implementation rules

### Next.js and UI

- Server Components are the default. Add `"use client"` only at the smallest
  interactive boundary; do not pull server-only modules, Prisma, credentials, or
  environment secrets into a Client Component graph.
- Treat every Server Action and Route Handler as directly callable. Authenticate,
  authorize, and validate inside the entry point even if the page that links to
  it is protected.
- Follow existing feature actions: validate `unknown` or `FormData` with Zod,
  obtain an authorization context, require the precise permission/resource
  access, call a service, then revalidate or redirect when appropriate.
- Use the `@/*` path alias. Match the existing Prettier style: semicolons, double
  quotes, and trailing commas.
- Reuse existing layout, form, dialog, and `components/ui/` patterns. Preserve
  keyboard access, focus behavior, labels, loading/error states, and responsive
  layouts.
- Workspace UI supports English and Thai. Add user-facing workspace strings to
  the established localization path in `lib/workspace-i18n.ts` rather than
  creating an isolated translation mechanism.
- Breakpoints are set by the shell: the sidebar docks at `lg`, a chat history
  column at `xl` (`components/ui/side-sheet.tsx`; a slide-in sheet below that).
  Below `lg` a chat surface is the only bar on screen: it hosts the shell's
  menu and account controls through `WorkspaceMobileChrome` slots, and the
  shell hides its own bar on `isChatSurface` routes.
- Controls collapse to icons on small screens rather than wrapping: pass
  `compactBelow` to `SelectMenu`, keep a label in an `sr-only` span plus
  `title`. Touch-aware styling uses the `[@media(hover:hover)]` variant.
- Shell preferences (locale, sidebar collapsed) are cookies read in
  `app/(workspace)/workspace/layout.tsx`, so the first paint already matches
  the saved state.
- jsdom evaluates no media queries: unit tests assert the contract (classes,
  ARIA, `inert`, focus) and breakpoints are checked in a browser at 375, 768,
  and 1280 px.

### Tenant, authorization, and audit boundaries

- Every business read and write must be scoped through the session-derived
  `organizationId` and/or `workspaceId`. Never accept tenant identity from the
  browser as authority.
- Use `requireAuthorization` plus the specific permission and resource-access
  helpers in `server/auth/`. Page visibility, a role label, middleware/proxy, or
  a client-side check is not authorization.
- Keep the system deny-by-default. New resource types or operations need an
  explicit access decision and tests for both allowed and denied tenants/users.
- Security-sensitive and material state changes must retain the established
  audit trail. Audit metadata must not contain credentials, raw provider prompts,
  raw SQL results, document contents, or unsanitized external errors.

### Data, secrets, AI, and external systems

- Validate all untrusted input at the boundary. Return the established typed
  `success`/`failure` result shape and avoid leaking stack traces or raw driver
  errors to clients.
- Never add secrets to `NEXT_PUBLIC_*`, source control, logs, queue payloads,
  citations, browser responses, snapshots, or tests. Environment configuration
  is validated in `schemas/env.ts` and `schemas/worker-env.ts`; update
  `.env.example` and documentation when adding a variable.
- Credentials must cross the existing versioned encryption service boundary.
  Do not persist plaintext or serialize a saved secret back to the browser.
- Preserve PDPA masking, prompt-injection filtering, SSRF/DNS protections,
  response size/time limits, content-type checks, and redirect restrictions when
  changing AI, web ingestion, or Legacy API flows.
- AI output must remain evidence- or metadata-grounded and Zod-validated. Do not
  fabricate fields, values, query results, citations, or a plausible fallback
  when a provider or connector fails.
- Database connectors and generated SQL are read-only, single-statement, scoped,
  timeout-bounded, and row-capped. Application guards are defense in depth; use
  read-only database credentials too.

### Prisma, queues, and worker jobs

- Change `prisma/schema.prisma`, create a committed migration with
  `npm run db:migrate`, and regenerate with `npm run db:generate`. Review the SQL
  before applying it. Do not hand-edit `generated/prisma/` or rewrite an already
  deployed migration.
- Use transactions for multi-record invariants and include tenant constraints in
  the query itself, not only in a preceding lookup.
- Queue payloads contain identifiers and sanitized configuration only. Large/raw
  content and secrets stay in PostgreSQL or the approved storage boundary.
- Job handlers must be idempotent, persist status in PostgreSQL before
  acknowledging completion, and preserve bounded concurrency, retry/backoff,
  cancellation, stale-claim recovery, and failed-job observability.
- Code imported by the worker must compile under `tsconfig.worker.json` and must
  not depend on a Next.js request/runtime context.

## Verification

Choose checks proportionate to the change, but do not hand off code with known
failures.

```bash
npm run lint
npm run typecheck
npm test
npm run worker:build
npm run build
npm run test:e2e
```

- Start with the narrowest relevant Vitest file while iterating, then run the
  broader suite for shared, authorization, schema, or security changes.
- Tests requiring PostgreSQL are enabled with `TEST_DATABASE_URL`; ensure it is
  an isolated disposable test database. MySQL fixture tests use
  `TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=3307` after the fixture is running.
- Playwright defaults to `http://127.0.0.1:3000`, reuses an existing dev server,
  and may require `npx playwright install chromium` once per machine.
- Add or update tests with behavior changes. Authorization fixes need cross-tenant
  and denied-access regression coverage; migrations need persistence coverage;
  queue changes need retry/idempotency coverage; UI changes need loading, error,
  empty, and accessible interaction coverage where applicable.
- If a check cannot run because a required service or credential is unavailable,
  report exactly what was and was not verified.

## Handoff checklist

Before finishing work:

1. Review the diff for accidental secrets, generated artifacts, unrelated edits,
   weakened tenant filters, and missing audit behavior.
2. Confirm schema, environment, API, and operational documentation changed with
   their implementation when applicable.
3. Run and report the relevant verification commands and any remaining risks or
   follow-up work.
4. Leave the worktree understandable for the next engineer; do not hide failures
   behind fake data, broad exception handling, disabled tests, or removed safety
   checks.
