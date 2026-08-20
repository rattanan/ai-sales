# Phase 8 Execution — Security Hardening, Reliability and Pilot Readiness

- Status: Implementation complete; controlled operational gates pending
- Migration: `20260816210000_phase8_security_pilot`
- Release mode: Limited-department pilot, not general availability

## Security and PDPA boundary

Every structured AI request now passes through one centralized masking boundary. The boundary applies the organization's active policy before cache hashing or provider invocation and covers email, phone, Thai national ID, passport, financial account, health, religion, biometric labels, credentials, and organization-defined policy labels. Structured logs contain only request ID, category names, counts, and total replacements; raw matches are never logged.

Prompt-injection regression tests cover retrieved Thai/English documents, database comments and multi-statement SQL, and malicious Legacy API parameters. Database operations remain AST-validated read-only calls. API tools accept only registered parameters, percent-encode path/query values, retain the registered origin, and protect transport headers.

Credential encryption supports a current version plus an explicit previous-key ring. New writes always use the current key; reads can decrypt a declared previous version during a rolling rotation. Provider fallback is disabled by default and must be selected explicitly by an administrator. The fallback receives the same masked prompt and is invoked only for retryable provider failures.

HTTP hardening includes Content Security Policy, frame restrictions for the application, HSTS on production responses, MIME sniffing protection, restrictive permissions/referrer policies, same-origin mutation checks, production cookie policy derived from the advertised HTTPS origin, bounded Server Action bodies, and early upload size/MIME/filename validation. The public widget routes retain intentionally narrow cross-origin behavior without credentials.

## Reliability and SLO

| Signal                 | Default target | Measurement                                                                                            |
| ---------------------- | -------------: | ------------------------------------------------------------------------------------------------------ |
| Synthetic availability |          99.5% | Current database/Redis/Worker infrastructure probe; production uses an external rolling uptime monitor |
| Chat p95               |     15 seconds | Persisted assistant-message latency in the rolling 24-hour window                                      |
| Index completion p95   |     30 minutes | Completed index-operation duration in the rolling 24-hour window                                       |
| Error rate             |     2% or less | Failed provider-backed chat messages divided by total in 24 hours                                      |

An Admin System Health page reports target, actual value, pass/fail/no-data state, queue saturation, slow-query counts, privacy-policy readiness, worker health, and stale encryption-key versions. No SQL text, prompt, secret, or masked value appears in these metrics.

BullMQ producers stop accepting work at the configured queue ceiling. Workers use rate limiting, bounded concurrency, exponential retries, stale-operation recovery, and graceful shutdown. The AI provider uses a shared circuit breaker with a single half-open probe and an explicit fallback policy. PostgreSQL migrations add targeted operational indexes, common vector-dimension HNSW indexes, and trigram search indexes. Uncommon embedding dimensions retain a safe exact-search path.

## Release assets

- `scripts/security/check-headers.mjs`: deployed-header assertion
- `scripts/load/phase8-load.mjs`: bounded concurrent scenario runner with p95/error/citation gates
- `scripts/operations/backup.sh`: PostgreSQL, Redis, and local object-storage backup with checksums
- `scripts/operations/restore-drill.sh`: destructive restore only into a database whose name ends `_restore_drill`
- `docs/operations/disaster-recovery.md`: backup, restore, verification, and evidence procedure
- `docs/operations/upgrade-rollback.md`: application and migration rollout/rollback procedure
- `docs/pilot-uat.md`: scoped pilot, Admin/Manager/User scripts, sign-off, feedback, incident, and backlog templates

The development seed contains a bilingual default Bot and optional local Admin, Manager, and User accounts. It does not enable test accounts unless `SEED_DEVELOPMENT_TEST_USERS=true`, and it never contains a committed password.

## Remaining release decisions

Code-level gates can establish pilot readiness, but they cannot substitute for an environment-specific disaster-recovery drill, vulnerability scan of the final image, agreed production load profile, or human UAT sign-off. These gates remain open until evidence is attached to the release record. A Phase 8 implementation result is therefore **Ready for controlled pilot validation**, not an assertion that the pilot has already completed.

## Local verification record — 16 August 2026

- Prisma format/validate/generate passed; migration `20260816210000_phase8_security_pilot` applied and schema drift is zero.
- TypeScript, ESLint, Worker TypeScript build, and both webpack/Turbopack production builds passed.
- Vitest: 201 passed, 16 skipped; the Phase 8 security/reliability subset passed 16 tests.
- Security headers passed against the local application.
- Bounded infrastructure smoke: concurrency 10, 10 requests, 0 failures, p95 432 ms. This is not the agreed pilot chat/retrieval/index/database load profile.
- Runtime health: database/pgvector/storage/Redis/Worker available and queue depth zero. Privacy and fallback readiness remain false until the Pilot Admin explicitly enables every mask and selects a fallback provider. Chat/index SLOs correctly report no data before traffic.
- `npm audit --omit=dev`: zero vulnerabilities.
- Final images `insightkm:phase8` digest `f9350de9a16d` and `insightkm-worker:phase8` digest `b46fb2c974fd`: Docker Scout reports no Critical findings. Its two remaining High matches in each image identify SheetJS `xlsx` 0.20.3 as affected by CVE-2023-30533/CVE-2024-22363. The [SheetJS maintainer states](https://git.sheetjs.com/sheetjs/sheetjs/issues/3316) these were fixed in 0.19.3 and 0.20.2 respectively; the project uses the [authoritative CDN package 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/). They are documented scanner-metadata false positives, not unresolved applicable findings. The first App scan's npm-CLI findings were removed by excluding npm/corepack from both final runtime images.

Open controlled gates: full pilot workload/soak, isolated DB/Redis/storage restore drill, final deployment-image scan confirmation, limited-Department execution, and signed Admin/Manager/User UAT.
