# Phase 2 Execution Record

- Status: Completed
- Date: 2026-08-16
- Scope: Bot Management, Document RAG and Core Knowledge Chat

## Delivered

- [x] Tenant-scoped Bot, version, provider configuration, Rack assignment and Role/User ACL models
- [x] Bot create, update-as-new-version, activate/deactivate and confirmed delete flows
- [x] Bot prompt, welcome message, suggested questions, model, temperature, token/context budgets, citation and memory settings
- [x] User Bot selection page that lists only active, assigned Bots
- [x] Knowledge Rack, Source, Document, Document Version, Chunk and Index Job models
- [x] Rack ACL levels for Read, Upload and Manage; Source and Document inherit the Rack policy and are rechecked before download or retrieval
- [x] Opaque-key local object storage compatible with a mounted NFS path and the existing future storage-adapter boundary
- [x] PDF, DOCX, XLSX, CSV, TXT, Markdown and HTML validation and parsing
- [x] Page, sheet, row and section metadata retained through chunking and citations
- [x] Versioned deterministic chunking, SHA-256 deduplication and configurable overlap/context sizes
- [x] BullMQ/NestJS document-index worker with batch embeddings, exponential retry, persisted errors and idempotent chunk replacement
- [x] pgvector storage with parser, chunker and embedding model versions recorded per job/version
- [x] Failed-job retry UI and human-readable administrative status
- [x] Conversation, message, citation and feedback persistence with token, latency, error and request identifiers
- [x] ACL filtering inside retrieval SQL before vector or keyword ranking
- [x] Hybrid vector, PostgreSQL full-text and lexical-overlap ranking with an optional reranker interface
- [x] Retrieved prompt-injection filtering, content-hash deduplication and context budgeting
- [x] Grounded no-evidence responses that do not call the LLM or fabricate knowledge
- [x] PII masking for the query, memory and retrieved evidence before any provider call
- [x] Citation links back to the ACL-protected source file with page/section metadata
- [x] Responsive Thai/English chat UI with new, rename, delete, history search, suggestions and feedback
- [x] Seeded `General Knowledge` Rack and active `InsightKM Assistant`
- [x] Docker storage initializer plus active write probe so a read-only-but-unwritable upload mount cannot report healthy

## Security Decisions

- Retrieval uses deny-by-default Rack ACL and organization scope directly in the SQL that selects candidate chunks. Unauthorized rows never enter ranking, reranking or the LLM context.
- Source and Document access inherit their Rack ACL in Phase 2. Every upload, retry, retrieval and download resolves the parent Rack and rechecks the required level.
- Bot ACL is independent from Rack ACL. A user must pass both the active Bot assignment and every Rack check.
- Conversation queries always include organization, Bot and owning User. A valid conversation ID from another user returns `NOT_FOUND`.
- Retrieved text is untrusted data. Known prompt-injection instruction lines are removed, and the system prompt forbids treating retrieved content as instructions.
- Stored file names never become filesystem paths. Storage uses server-generated opaque UUID keys and validates keys again in both the application and worker.
- Provider credentials remain encrypted in the application database; the worker decrypts a selected credential only at execution time.

## Verification Evidence

| Check                       | Result                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Prisma schema               | Valid; client generated with Prisma 7.9.1                                                             |
| Existing database migration | 11 migrations applied; 2 Phase 2 migrations add RAG/chat models and document identity                 |
| Seed                        | `InsightKM Assistant` and `General Knowledge` confirmed in the local database                         |
| TypeScript                  | `npm run typecheck` passed                                                                            |
| ESLint                      | `npm run lint` passed with zero warnings/errors                                                       |
| Worker build                | `npm run worker:build` passed                                                                         |
| Unit + integration          | 125 tests passed; 2 optional fixture suites skipped                                                   |
| Parser fixtures             | All 7 required formats passed, including PDF page and spreadsheet row/sheet metadata                  |
| Golden retrieval            | Thai and English queries returned only the expected governed document                                 |
| ACL leakage                 | Unauthorized Rack returned zero chunks; cross-user conversation access returned `NOT_FOUND`           |
| Retry/idempotency           | Reprocessing the same index job retained the same unique chunk hashes and count                       |
| Vertical slice              | Document index → Thai grounded answer → persisted file/section citation passed with stubbed providers |
| Browser regression          | Playwright 2/2 passed                                                                                 |
| Production build            | Next.js 16.3.1 webpack build passed locally; Docker Turbopack production build also passed            |
| Runtime deployment          | App/worker rebuilt and healthy; API reports application, database, Redis and one active worker up     |

## Operations Notes

1. Mount the same `LOCAL_STORAGE_PATH` into the web application and worker. A shared Docker volume and UID 1001 storage initializer are configured in `docker-compose.yml`; an NFS mount may be used at that path in production.
2. Configure an active organization provider with both chat and embedding models, or set the `AI_*` and `EMBEDDING_*` fallbacks.
3. Run `npm run db:deploy`, `npm run db:seed`, then rebuild/restart both the web application and worker.
4. Use System Health to confirm PostgreSQL/pgvector, Redis, worker, storage and provider connectivity before accepting uploads.

## Phase Gate Decision

**GO for Phase 3.** The Phase 2 Document RAG vertical slice, security boundaries and operational worker contracts are implemented and verified. Phase 3 can add authentication modes, finer resource ACLs and the embedded widget without changing the grounded retrieval contract.
