# InsightKM

InsightKM is a multi-tenant enterprise AI knowledge platform for connecting governed business data, discovering its structure, and producing reviewable business insights from grounded AI analysis. The current foundation produces only metadata-validated artifacts and successfully executed read-only query results; it does not fabricate fields, values, or insights.

## Phase 8 capabilities

- Centralized PDPA masking before every external structured-AI call, covering national ID, passport, health, religion, biometric, financial, credential, contact, and organization policy labels while logging category counts only
- Prompt-injection regression coverage for documents, database SQL/context, and registered Legacy API tools; same-origin mutation checks, hardened cookies/headers/uploads, CSP, and narrow public-widget exceptions
- Versioned AES-256-GCM key ring for rolling credential rotation, explicit provider fallback, shared circuit breaker, queue backpressure, Worker rate limiting, graceful shutdown, and stale-operation recovery
- Admin SLO dashboard for rolling availability, chat/index p95, error rate, queue saturation, slow-query counts, privacy readiness, and stale encryption-key versions
- HNSW/trigram operational indexes, bilingual pilot seed, Nginx Compose profile, concurrent load/header checks, backup/restore scripts, upgrade/rollback runbook, and role-based controlled-pilot UAT

## Phase 7 capabilities

- Context-threshold conversation summaries with exact source message IDs, provider/model/prompt metadata, and original messages/citations preserved
- Explicitly consented preference, department, and project memory with per-Bot scope, sensitive-data rejection, expiry, consent history, and real user-requested deletion
- Searchable/paginated conversation history, rename/delete, structured feedback, and stored Bot/citation/token/latency/error/auth/department/project context
- Audited Chat History for managers and administrators, with service-enforced department/project scope
- Filtered Business Insight snapshots with exact sample counts, topic/trend, repeated and unanswered questions, knowledge gaps, low-performing source/Bot, latency/error, and evidence-bound risk/opportunity/recommendations
- Insufficient samples expose exact metrics and limitations without generating organizational conclusions

## Phase 6 capabilities

- Admin Legacy API Registry for fixed GET or explicitly confirmed read-only POST operations, typed path/query/body parameters, JSON body templates, response mapping, JSON Schema validation, and safe test calls
- AES-256-GCM server-side credentials for none, API key, bearer, basic, and custom-header authentication; secret values are never serialized back to the browser, citation, Chat, or audit records
- Bot API allowlists plus central actor ACL and `legacy_api.use` permission checks repeated at selection and invocation time
- DNS/IP-pinned outbound requests with public-domain allowlists, private/metadata address blocking, same-origin redirect limits, header-injection controls, JSON-only content types, absolute timeout, and byte caps
- Metadata-driven Chat tool selection, required-parameter clarification before network access, bounded masked summaries, safe failure without fabricated fallback, and API/time/latency citations

## Phase 5 capabilities

- Live MySQL/MariaDB, PostgreSQL, SQL Server, and Oracle adapters with TLS options, sanitized diagnostics, bounded discovery/sample/query operations, timeout, cancellation, and server-side credential decryption
- Governed schema/table/view selection with separate masked-sample permission, table-level central ACL enforcement, versioned metadata diffs, database comments, PK/FK discovery, and selective semantic invalidation
- Versioned AI table/column descriptions plus pgvector metadata embeddings for ACL-first semantic table selection
- Safe Text-to-SQL with ambiguity clarification, per-dialect AST grounding, one-statement SELECT/CTE allowlisting, dangerous function and DML/DDL blocking, hard row caps, and explicit review before execution
- Database-aware Bot assignments and Chat routing with bounded summaries and citations containing connection, engine, tables, and execution time—but never credentials or raw SQL

## Phase 4 capabilities

- Worker-only, read-only shared-folder mounts with canonical allowlists, traversal/symlink rejection, persisted snapshots, and incremental add/change/delete detection
- Public web-page ingestion with domain allowlists, DNS/IP/metadata/redirect SSRF protection, response bounds, boilerplate reduction, canonical URL and conditional ETag/Last-Modified refresh
- Source refresh history with scheduled/manual runs, detailed counts/errors, soft-deactivation of removed documents, and URL/fetch-time citations
- Index Operations UI with source/status filters, queue and duration metrics, chunk progress, categorized failures, retry, cancellation, dead letter, and transactional re-index
- Exponential BullMQ retry plus startup/periodic stale-operation recovery with atomic database claims

## Phase 3 capabilities

- Tenant authentication policy with deterministic Local, External API, and signed Embedded mode selection
- HMAC SHA-256/JWT HS256 identity exchange with nonce replay protection, exact-origin enforcement, mapped signed claims, shadow users, and opaque widget sessions
- External authentication contract mapping, encrypted secret headers, timeout/health testing, and failure isolation without silent Local fallback
- Central deny-by-default authorization for Bot, Rack, Source, Document, database/data-source children, Legacy API, Chat, and Insight with an Admin simulator
- Responsive Shadow DOM widget loader, CSP-restricted iframe, session continuity, keyboard/focus support, one-time secret rotation, and a runnable sample host

## Enterprise security and Excel capabilities

- Administrator-only account provisioning; public registration is disabled in both UI and server actions
- Flexible organization roles and permissions plus per-data-source, per-dashboard, export, and AI policies
- Pending, active, locked, disabled, and soft-deleted accounts with forced temporary-password replacement
- Persistent brute-force/rate-limit protection, login history, single-use password reset, and session invalidation
- Immutable-through-application audit views, recursive sensitive-value masking, filters, details, and governed CSV exports
- First-class `.xlsx` import with sheet tables, inferred columns, paged rows, version history, schema diffs, warnings, and rollback

## Phase 2 capabilities

- Versioned multi-Bot administration with provider, prompt, memory, citation, Rack, Role and User configuration
- Governed Knowledge Racks with Read/Upload/Manage ACLs and PDF, DOCX, XLSX, CSV, text, Markdown and HTML ingestion
- Background parsing, deterministic chunking, batch embeddings, pgvector persistence, retries and idempotent re-indexing
- ACL-first hybrid vector/full-text retrieval with prompt-injection filtering, deduplication and optional reranking
- Grounded Thai/English chat, no-evidence policy, protected file citations, isolated history and answer feedback

## Phase 1 capabilities

- OpenAI-compatible provider abstraction for official OpenAI, OpenRouter, and local compatible servers
- Zod-validated structured output, health checks, timeouts, retries, request IDs, token accounting, and workspace-scoped response caching
- Persistent restartable analysis stages and an explicit human approval boundary
- Deterministic metadata ranking, context limits, sensitive-value masking, and visible scope reductions
- Grounded business entities, KPI recommendations, dashboard plans, widgets, SQL, previews, and insights
- AST-based table, column, relationship, function, statement, row-limit, and timeout enforcement
- KPI/widget approval, rejection, label editing, SQL retesting, individual regeneration, and audit history
- Immutable dashboard versions and responsive Recharts rendering without fake fallback data

## Phase 0 capabilities

- Auth.js credentials sessions and Argon2id password authentication
- Organizations, memberships, roles, and workspaces
- Eight-step persistent data-source and dashboard setup wizard
- AES-256-GCM encrypted database credentials
- Real MySQL connection testing and `information_schema` metadata discovery
- AST-validated read-only MySQL queries and limited samples at the connector boundary
- Excel `.xlsx` parsing through a storage abstraction
- Initial connector abstraction later completed for PostgreSQL, SQL Server, and Oracle in Phase 5
- Dashboard drafts, immutable versions, widget-ready JSON models, and analysis placeholders
- Tenant-scoped repositories, authorization helpers, sanitized logging, and audit records
- Docker/Cloud Run-compatible build, migration, seed, and test tooling

## Technology

Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn-style local UI primitives, Lucide, Recharts, Auth.js, Prisma ORM 7, PostgreSQL/pgvector, Redis/BullMQ, NestJS Worker, MySQL2, SheetJS, Zod, React Hook Form, Vitest, and Playwright.

## Local setup

Requirements: Node.js 22+, npm, and Docker for local databases and connector integration tests.

For day-to-day development, configure `.env` once and use the local development launcher:

```bash
cp .env.example .env
# Replace the placeholder secrets in .env, then run:
npm run dev:local
```

The launcher installs changed npm dependencies, starts PostgreSQL and Redis in
Docker, generates the Prisma client, applies pending migrations, and runs both
Next.js and the worker in watch mode. Press `Ctrl+C` to stop the application and
worker. PostgreSQL and Redis remain available with their data preserved; stop
them with `docker compose stop postgres redis` when they are no longer needed.

The equivalent manual setup is:

```bash
npm install
cp .env.example .env
docker compose up -d --wait postgres redis
npm run db:generate
npm run db:deploy
npm run db:seed
npm run worker:watch # Run in a second terminal
npm run dev
```

For the production-shaped local topology, start Nginx and the application profile after configuring `.env`:

```bash
docker compose --profile app up -d --build
```

The profile publishes Nginx at `http://localhost:8080`; the App container is not published directly. Run `npm run test:security-headers` and `npm run test:load` against a started environment, using the `PHASE8_*` variables documented in [Phase 8 execution](docs/phase8-execution.md).

Open `http://localhost:3000`. Before seeding, configure the initial administrator environment variables. No administrator password is hardcoded in the repository.

Generate secrets rather than using the placeholders:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Use the base64 value for `CREDENTIAL_ENCRYPTION_KEY` (or the dedicated `DATA_SOURCE_ENCRYPTION_KEY`) and a 32+ character value for `AUTH_SECRET`.

## Environment variables

| Variable                              | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                        | PostgreSQL URL for the InsightKM application database                          |
| `AUTH_SECRET`                         | Auth.js signing/encryption secret, at least 32 characters                      |
| `CREDENTIAL_ENCRYPTION_KEY`           | Exactly 32 random bytes encoded as base64                                      |
| `CREDENTIAL_KEY_VERSION`              | Stored encryption-key version; defaults to `env-v1`                            |
| `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` | Comma-separated `version:base64` keys retained during rolling rotation         |
| `APP_URL`                             | Public application origin                                                      |
| `AUTH_TRUST_HOST`                     | Explicitly trust the deployment proxy host in production                       |
| `SERVER_ACTION_ALLOWED_ORIGINS`       | Comma-separated trusted origins for proxied Server Actions                     |
| `OBJECT_STORAGE_DRIVER`               | `local` in Phase 0; `gcs` is a documented future adapter                       |
| `LOCAL_STORAGE_PATH`                  | Local workbook storage root                                                    |
| `KNOWLEDGE_MAX_UPLOAD_BYTES`          | Maximum document upload size; defaults to 25 MiB                               |
| `KNOWLEDGE_CHUNK_CHARACTERS`          | Maximum characters in a deterministic document chunk                           |
| `KNOWLEDGE_CHUNK_OVERLAP`             | Character overlap between adjacent chunks                                      |
| `KNOWLEDGE_SHARED_FOLDER_ROOTS`       | Worker folder-path allowlist, separated by the operating-system path delimiter |
| `KNOWLEDGE_SHARED_FOLDER_HOST_PATH`   | Docker host folder bind-mounted read-only into the Worker                      |
| `KNOWLEDGE_SHARED_FOLDER_MAX_FILES`   | Maximum supported files in one source scan                                     |
| `KNOWLEDGE_WEB_MAX_BYTES`             | Hard maximum accepted web response size                                        |
| `KNOWLEDGE_WEB_TIMEOUT_MS`            | Absolute timeout for one page request                                          |
| `KNOWLEDGE_WEB_MAX_REDIRECTS`         | Maximum validated redirects for a web source                                   |
| `EMBEDDING_BASE_URL`                  | Ollama `/api/embed` or compatible embedding fallback endpoint                  |
| `EMBEDDING_MODEL`                     | Fallback embedding model and persisted index model version                     |
| `EMBEDDING_TIMEOUT_MS`                | Absolute embedding-request timeout                                             |
| `EMBEDDING_BATCH_SIZE`                | Number of document chunks embedded in one worker request                       |
| `EMBEDDING_BATCH_CONCURRENCY`         | Concurrent embedding requests per document; defaults to 1 and is capped at 8   |
| `REDIS_URL`                           | Redis connection URL used by BullMQ producers and health checks                |
| `BULLMQ_PREFIX`                       | Queue namespace; defaults to `insightkm`                                       |
| `WORKER_CONCURRENCY`                  | Concurrent jobs handled by one worker process                                  |
| `WORKER_RATE_LIMIT_MAX`               | Maximum Worker jobs in one limiter window                                      |
| `WORKER_RATE_LIMIT_DURATION_MS`       | BullMQ Worker limiter window                                                   |
| `WORKER_HEALTH_TIMEOUT_MS`            | Timeout for the end-to-end worker health-check job                             |
| `QUEUE_MAX_WAITING_JOBS`              | Producer backpressure ceiling across waiting/delayed/active jobs               |
| `MAX_EXCEL_UPLOAD_BYTES`              | Workbook upload limit; defaults to 10 MiB                                      |
| `LOG_LEVEL`                           | Structured server log level                                                    |
| `AI_PROVIDER`                         | `openai-compatible` provider factory selection                                 |
| `AI_BASE_URL`                         | Provider `/v1` base URL for OpenAI/OpenRouter/local                            |
| `AI_API_KEY`                          | Optional provider bearer token                                                 |
| `AI_MODEL`                            | Provider model identifier; required to start analysis                          |
| `AI_SUPPORTS_JSON_SCHEMA`             | Strict JSON Schema mode, otherwise JSON object mode                            |
| `AI_TIMEOUT_MS`                       | Absolute per-provider-request timeout; use `300000` for large streamed models  |
| `AI_STREAM_INACTIVITY_TIMEOUT_MS`     | Maximum silence between streamed provider chunks                               |
| `AI_MAX_RETRIES`                      | Transient provider retry count                                                 |
| `AI_CIRCUIT_FAILURE_THRESHOLD`        | Retryable failures before the shared provider circuit opens                    |
| `AI_CIRCUIT_COOLDOWN_MS`              | Open-circuit cooldown before one half-open probe                               |
| `AI_TEMPERATURE`                      | Structured generation temperature                                              |
| `AI_MAX_TABLES`                       | Maximum tables included in provider context                                    |
| `AI_MAX_COLUMNS_PER_TABLE`            | Maximum columns per included table                                             |
| `AI_SAMPLE_ROWS_PER_TABLE`            | Maximum sample rows per included table                                         |
| `AI_MAX_SAMPLE_CELL_LENGTH`           | Maximum transmitted sample-cell characters                                     |
| `AI_MAX_CONTEXT_CHARACTERS`           | Hard serialized metadata context limit                                         |
| `AI_SEND_SAMPLE_DATA`                 | Permit samples/query previews for grounded generation                          |
| `AI_MASK_SENSITIVE_DATA`              | Mask likely sensitive values before transmission                               |
| `AI_MAX_KPI_RECOMMENDATIONS`          | Maximum KPI recommendations                                                    |
| `AI_MAX_WIDGETS`                      | Maximum generated widgets                                                      |
| `AI_MAX_INSIGHTS`                     | Maximum grounded insights                                                      |
| `QUERY_TIMEOUT_MS`                    | Generated-query execution timeout                                              |
| `QUERY_MAX_ROWS`                      | Hard generated-query row limit                                                 |
| `QUERY_PREVIEW_ROWS`                  | Maximum review/rendering preview rows                                          |
| `SLOW_QUERY_THRESHOLD_MS`             | Threshold used by Admin slow-query monitoring                                  |
| `SLO_AVAILABILITY_TARGET_PERCENT`     | Rolling synthetic chat availability target                                     |
| `SLO_CHAT_P95_TARGET_MS`              | Rolling provider-backed chat p95 target                                        |
| `SLO_INDEX_P95_TARGET_MINUTES`        | Rolling completed-index p95 target                                             |
| `SLO_ERROR_RATE_TARGET_PERCENT`       | Rolling provider-backed chat error-rate ceiling                                |
| `INITIAL_ADMIN_NAME`                  | Initial environment-seeded administrator name                                  |
| `INITIAL_ADMIN_EMAIL`                 | Initial administrator email                                                    |
| `INITIAL_ADMIN_USERNAME`              | Optional initial administrator username                                        |
| `INITIAL_ADMIN_PASSWORD`              | Strong temporary administrator password; never commit it                       |
| `MAX_FAILED_LOGIN_ATTEMPTS`           | Failures before account lock; defaults to 5                                    |
| `ACCOUNT_LOCK_DURATION_MINUTES`       | Automatic lock duration; defaults to 30 minutes                                |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES`     | Persistent login/recovery rate-limit window                                    |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`       | Maximum requests per rate-limit bucket                                         |
| `PASSWORD_RESET_TOKEN_EXPIRY_MINUTES` | Single-use reset expiry; defaults to 30 minutes                                |
| `PASSWORD_RESET_DELIVERY_URL`         | Trusted HTTPS notification-service webhook                                     |
| `PASSWORD_RESET_DELIVERY_TOKEN`       | Server-only notification webhook bearer token                                  |
| `MAX_EXCEL_IMPORT_ROWS`               | Maximum imported workbook data rows                                            |
| `MAX_EXCEL_SHEETS`                    | Maximum workbook sheets                                                        |
| `SEED_DEVELOPMENT_TEST_USERS`         | Opt-in non-production role test accounts                                       |
| `DEVELOPMENT_TEST_USER_PASSWORD`      | Shared local-only password for opt-in test accounts                            |

Environment configuration is validated with Zod on the server. Never prefix secrets with `NEXT_PUBLIC_`.

Some OpenAI-compatible providers reject large strict JSON Schemas. If analysis fails with a provider schema-limit error, set `AI_SUPPORTS_JSON_SCHEMA="false"`; the application will request JSON-object mode and still validate the completed response with Zod.

## Database migrations and seed

The initial SQL migration is committed in `prisma/migrations`. Prisma 7 does not automatically generate the client or run seeds during migration, so use explicit commands:

```bash
npm run db:generate
npm run db:migrate   # development migration creation/application
npm run db:deploy    # apply committed migrations in deployment
npm run db:seed      # explicit development seed
```

The seed creates the environment-provided System Admin, organization, workspace, default roles/permissions, a credential-free PostgreSQL `DRAFT` source, and two sample dashboards. `Visual Analytics Showcase` is a generated, presentation-ready demonstration containing KPI comparison, trend, category, target, funnel, waterfall, timeline, exception table, filters, and insight widgets backed by deterministic sample rows. It contains no usable database credential.

## Architecture

- `app`: route groups, Server Action/Route Handler entry points, loading/error boundaries
- `components`: accessible UI primitives, workspace shell, authentication, and wizard UI
- `features`: business mutations for authentication, onboarding, data sources, and dashboards
- `schemas` / `types`: Zod contracts and stable result/error types
- `server/auth`: session-derived tenant authorization and role hierarchy
- `server/ai`: provider contracts, compatible adapter, caching, prompts, and grounding
- `server/repositories`: workspace-scoped database reads
- `server/services`: encryption, logging, Excel upload, metadata persistence, audit behavior
- `server/connectors`: common connector contract, four live database adapters, dialect SQL guard, and metadata grounding
- `server/storage`: object storage interface and local development adapter
- `prisma`: schema, migration, and idempotent development seed

Pages and handlers do not own database or connector logic. Every mutation validates untrusted input and repeats authorization instead of relying on page visibility or `proxy.ts`.

See [Phase 1 architecture](docs/phase1-architecture.md) for the stage lifecycle, grounding boundaries, approval workflow, and worker migration path.

See [Enterprise access and Excel architecture](docs/enterprise-security.md) for the permission matrix, account lifecycle, reset delivery, Excel import/versioning, and migration guidance.

For pilot operations, see [Phase 8 execution](docs/phase8-execution.md), [disaster recovery](docs/operations/disaster-recovery.md), [upgrade and rollback](docs/operations/upgrade-rollback.md), and [controlled-pilot UAT](docs/pilot-uat.md).

See [Rich dashboard engine](docs/rich-dashboard-engine.md) for visualization selection, widget contracts, quality scoring, filter behavior, renderer boundaries, and backward compatibility.

See [Embedded authentication and widget](docs/embedded-widget.md) for signed payloads, JWT/HMAC examples, CSP, external authentication mapping, sample-host setup, and accessibility checks.

See [Phase 3 execution](docs/phase3-execution.md) for the delivered authorization architecture, security decisions, and verification evidence.

See [Phase 4 execution](docs/phase4-execution.md) for shared-folder mounts, web SSRF boundaries, incremental refresh, recovery, and index operations.

See [Phase 5 execution](docs/phase5-execution.md) for connector completion, metadata intelligence, ACL-aware Text-to-SQL, review/cancellation boundaries, and database citations.

See [Phase 6 execution](docs/phase6-execution.md) for the Legacy API contract, encrypted authentication boundary, SSRF model, Bot/actor authorization, Chat tool flow, citations, and verification evidence.

See [Phase 7 execution](docs/phase7-execution.md) for consented memory, conversation summarization, audited Chat History, scoped Business Insight snapshots, evidence rules, and verification evidence.

### Development role accounts

With `SEED_DEVELOPMENT_TEST_USERS=true`, explicit seeding creates the following local-only accounts using `DEVELOPMENT_TEST_USER_PASSWORD`:

- `datasource.manager@ai-dashboard.local`
- `dashboard.builder@ai-dashboard.local`
- `dashboard.viewer@ai-dashboard.local`

The System Admin address and password always come from `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`.

## Analysis execution model

Phase 1 does not claim to run an unavailable background worker. Starting analysis creates a durable `AnalysisJob`. While the analysis page is open, the browser requests one bounded stage at a time. Each stage obtains an optimistic claim, persists artifacts and progress, and releases the claim before the next request. Closing the page preserves completed work; reopening it resumes from the persisted stage. A failed stage can be explicitly retried. The same stage handler can later be driven by Cloud Tasks, Pub/Sub, or a worker.

Generation stops at `WAITING_FOR_APPROVAL`. Finalization requires approved KPI and widget recommendations plus successful query previews, excludes rejected items, and creates an immutable `DashboardVersion`.

## Connector security

- Plaintext database passwords are encrypted immediately with AES-256-GCM and never returned after saving.
- Logs recursively redact passwords, secrets, tokens, authorization headers, ciphertext, and connection strings.
- All four database connectors run server-side with bounded connection/query timeouts; MySQL explicitly disables multiple statements and PostgreSQL executes inside a read-only transaction.
- User queries must parse as one `SELECT`/read-only CTE and cannot use DML, DDL, calls, locking, or file-output clauses.
- Generated queries must also resolve every table and column against the bounded approved context, use discovered relationship columns, avoid unsafe functions, and receive a fixed row cap.
- Metadata discovery uses fixed `information_schema` queries.
- Sample identifiers must originate from discovered metadata and the row limit is bounded.
- A read-only database account is still required. Application SQL guards are defense in depth, not a substitute for database grants.
- Every data-source and dashboard record is resolved through the current workspace and membership.
- Connection operations emit audit events without storing secrets or raw database errors.
- Failed connection tests return an expandable sanitized diagnostic block containing the application code, request ID, driver code, SQL state, errno, and operation when available. Passwords, connection strings, raw driver messages, and stack traces remain server-only/redacted.
- Provider prompts, API keys, database credentials, and raw query results are never logged. AI cache entries are isolated by workspace, provider, model, prompt version, and request hash.
- Workspace settings disclose sample/query-preview transmission and masking behavior.

### MariaDB compatibility

The MySQL connector uses the MySQL wire protocol and is compatible with MariaDB in general. MariaDB 5.5 is supported on a legacy, best-effort basis for connection testing and `information_schema` metadata discovery. A successful connection displays the exact server version and an end-of-life warning.

MariaDB 5.5 reached end of maintenance in April 2020. Upgrade to a maintained MariaDB LTS release is strongly recommended. InsightKM will not lower Node.js TLS security settings to negotiate obsolete TLS versions; an old server that only offers legacy TLS must be upgraded or placed behind a properly secured modern proxy. Disabling TLS is appropriate only on a separately secured private network after an explicit risk review.

For production, rotate the environment key through the `CredentialEncryptionService` key-version seam or replace it with Google Cloud KMS. Restrict Cloud Run egress according to the databases the deployment is allowed to reach.

## Excel storage and Cloud Run

The `ObjectStorageService` boundary currently ships with a local filesystem adapter for development. Cloud Run filesystems are ephemeral, so production must implement/configure the planned Google Cloud Storage adapter before relying on Excel persistence. Selecting `OBJECT_STORAGE_DRIVER=gcs` currently returns an explicit not-implemented response.

## Docker and Cloud Run

Start only databases:

```bash
docker compose up -d postgres redis worker mysql-fixture
```

Build and run the full application profile:

```bash
docker compose --profile app up --build
```

The multi-stage image emits Next.js standalone output, listens on port `8080`, and runs as a non-root user. Apply migrations as a separate deployment job before routing production traffic. Supply all secrets through Secret Manager/environment configuration; do not bake real values into the image.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Unit tests cover validation, encryption/tampering, read-only SQL, roles, recursive redaction, connector selection, unsupported adapters, and Excel rejection. The MySQL integration test is enabled with:

```bash
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=3307 npm test
```

Playwright browser installation may be required once per machine with `npx playwright install chromium`.

Application-database integration tests are enabled with `TEST_DATABASE_URL`. Provider unit tests use mocked HTTP responses; tests never send prompts to a live AI provider.

## Current limitations

- Only MySQL has live database testing and metadata discovery.
- Excel files are locally persisted only; production GCS support is not implemented.
- AI Copilot authorization policies and audit storage are present, but the free-form Copilot conversation UI/execution workflow is not implemented yet.
- Google login, email verification, password reset, invitations, join codes, and advanced role editing are deferred.
- Analysis stages are synchronously advanced through bounded HTTP requests; no background worker is deployed yet.
- Generated date/category filters update every compatible widget over its persisted validated result preview. Server-side parameterized re-execution for ranges outside that bounded preview remains deferred.
- Recharts and purpose-built accessible HTML/SVG components render persisted previews; scheduled and live query refresh are deferred.
- Workspace selection currently uses the first accessible workspace; persistence of an actively selected workspace is a later enhancement.

## Next phases

1. Google Cloud KMS and GCS production adapters.
2. PostgreSQL connector, followed by SQL Server and Oracle.
3. Cloud Tasks/Pub/Sub workers and scheduled dashboard refresh.
4. Interactive filter-driven refresh and the full dashboard editor.
5. AI Copilot changes, version comparison, and publishing workflows.
6. Invitations, workspace switching, Google authentication, and granular permissions.
