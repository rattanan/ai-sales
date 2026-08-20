# Phase 5 execution — Database intelligence and safe Text-to-SQL

- Status: Completed
- Migration: `20260816150000_phase5_database_intelligence`

## Delivered architecture

- The common connector contract now covers configuration validation, connection testing, schema/table/column/relationship discovery, bounded samples, bounded read-only execution, cancellation, and close. MySQL/MariaDB, PostgreSQL, SQL Server, and Oracle are live adapters.
- Discovery persists database comments, types, nullable state, primary keys, foreign keys, table/view kind, and estimated rows. Every successful refresh increments a metadata version, stores a fingerprinted diff, removes missing objects, and invalidates semantic descriptions/embeddings only for changed objects.
- Administrators select the allowed schema/table/view scope and opt in separately to masked samples globally and per table. Bot versions snapshot their assigned database sources.
- Semantic enrichment stores versioned model/fingerprint metadata at table and column level. Table embeddings support ranked metadata retrieval only after data-source and table ACL filtering.
- Text-to-SQL persists the question, approved metadata snapshot, proposed/validated query, hash, status, result schema, masked preview, summary, citation metadata, provider/model, timings, and sanitized failure details.
- The workbench requires explicit review before execution. Bot Chat routes likely metric/data questions to an assigned database; ambiguity produces clarification, while completed results produce bounded grounded summaries.

## Security boundaries

| Boundary             | Enforcement                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credential           | AES-256-GCM at rest; decrypted server-side only; never returned in UI, citation, audit, or error                                                             |
| Metadata scope       | Workspace + data-source access, selected objects, then central `DATABASE_TABLE` ACL before semantic ranking or prompt construction                           |
| SQL generation       | Structured AI output over bounded approved metadata; comments/question treated as untrusted data                                                             |
| SQL validation       | Dialect-aware parser/AST grounding for tables, columns, relationships, one SELECT/CTE statement, and fixed row cap                                           |
| Dangerous operations | DML, DDL, procedure execution, locks, comments, multiple statements, file/network/delay functions, and dynamic operations blocked                            |
| Execution            | Re-resolve current ACL/metadata immediately before execution; connector timeout/row cap/read-only boundary; atomic execution claim; cancellable active query |
| Result               | Bounded result, normalized values, privacy-policy masking before AI summary or preview persistence                                                           |
| Citation             | Connection name, engine, referenced schema/tables, metadata version, row count, duration, and execution time; no raw SQL or secret                           |

## Administrator workflow

1. Create and test a database source, then run metadata discovery.
2. Open `/workspace/data-sources/{id}` and select the governed tables/views. Enable masked samples only where required.
3. Generate semantic descriptions after the governed scope is saved.
4. Use `/workspace/data-sources/{id}/query` to ask a precise question, review validated SQL, then approve execution.
5. Assign one or more connected database sources to a Bot in `/workspace/admin/bots`. Database-like Chat questions use the same ACL and validation pipeline.

## Verification

- Dialect guard corpus covers row-cap injection and adversarial DML/DDL, comments, multi-statement input, locks, procedure execution, and database-specific file/network/delay functions.
- Grounding tests verify approved table/column/relationship resolution, nested queries, CTEs, derived tables, fixed limits, and Oracle AST column enforcement.
- Connector contract tests cover all four live adapters. Environment-gated MySQL, PostgreSQL, SQL Server, and Oracle fixtures test connection/discovery/read-only execution where their containers are available.
- An environment-gated Playwright flow covers question → metadata selection → validation/clarification → explicit execution → bounded summary and database citation.
- Central ACL integration verifies explicit table deny precedence. The database service filters denied tables before semantic search and rechecks the current scope before execution.
- Prisma validation/generation, TypeScript, lint, full Vitest, Worker build, and production Next.js build are release gates.

## Operational notes

- Production database users must remain read-only. Application validation is defense in depth and does not replace database grants.
- SQL Server and Oracle fixtures are environment-gated because their images/licenses are not part of the default local Compose stack.
- The local development database contained a historical migration checksum drift. Phase 5 was applied without resetting data and recorded in Prisma history; clean deployments use the committed migration normally.
