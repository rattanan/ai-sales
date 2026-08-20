# Phase 1 architecture

## Grounding boundary

The analysis pipeline derives authority from persisted tenant-scoped records. Browser input selects identifiers, but services re-read the dashboard, data source, discovered tables, columns, and relationships through the active authorization context. The AI provider never expands that authority.

The metadata context builder ranks selected tables against the business objective and relationship graph. It applies explicit table, column, sample, cell, and serialized-character limits. Omitted tables and columns remain named in `scopeReduction`; reductions are never silent. Samples are converted to JSON-safe values and likely credentials, tokens, identifiers, payment data, email addresses, phone numbers, addresses, and opaque secrets are masked before transmission.

## Persistent lifecycle

1. `createAnalysisJob` validates one connected MySQL source and selected discovered tables.
2. The job stores a request snapshot without credentials or sample values.
3. The browser calls `POST /api/analysis-jobs/[id]/advance` once per stage.
4. `advanceAnalysisJob` obtains an optimistic `runVersion` claim and heartbeat.
5. The stage writes immutable artifacts or idempotent recommendations/query records.
6. Progress, next stage, and an audit event are committed before another stage can run.
7. A stale claim may be recovered after five minutes; a failed stage requires explicit retry.
8. Generation ends at `WAITING_FOR_APPROVAL`, not publication.
9. Finalization snapshots approved artifacts and moves the job to `COMPLETED`.

The stage handler is independent from the HTTP entry point. A future Cloud Tasks, Pub/Sub, or worker consumer can invoke the same claim and stage services.

## Structured AI calls

`AIProvider` accepts a Zod output schema, versioned prompt, and request ID. The compatible adapter sends JSON Schema response format when the configured model supports it, or JSON object mode for limited local servers. The complete response content must be valid JSON and pass Zod; the application does not extract JSON fragments from prose.

Provider calls have bounded timeouts and transient retries. Errors expose stable sanitized application codes. Usage is captured when available. Successful responses are cached within a workspace by provider, model, prompt version, and hashed request input. Prompts and response data are not logged.

## SQL pipeline

KPI SQL passes four boundaries:

1. Zod validates KPI structure and source references.
2. Grounding validates tables, columns, types, date fields, and calculation compatibility.
3. The MySQL AST guard enforces one read-only SELECT/CTE, selected scope, discovered relationship columns, safe functions, and a fixed row limit.
4. MySQL executes with multiple statements disabled and a configured timeout through the encrypted credential boundary.

Invalid proposals receive at most two structured repair attempts. Query definitions retain hashes and validation state. Executions retain timing, row count, result schema, bounded preview rows, request ID, and sanitized failure state; full result sets are not persisted.

## Human review and versioning

Schema analysis, KPIs, widgets, SQL, previews, assumptions, limitations, and data-quality findings are visible on the analysis route. Designers can approve, reject, rename, redescribe, retest, or regenerate individual recommendations. Regeneration creates a new immutable revision and supersedes the previous recommendation.

Finalization requires approved KPI and widget recommendations. Every data widget must reference a successful query belonging to an approved KPI. The transaction replaces the rendered widget set, creates an immutable version snapshot, completes the job, updates dashboard status, and writes an audit event.

## Rendering

The renderer supports KPI, bar, line, area, pie, donut, gauge, table, text-insight, and filter widgets. It reads only persisted query previews and displays explicit empty states when no rows exist. It never substitutes demo data. The 12-column layout collapses to one column on small screens. Reordering uses accessible buttons and persisted positions; drag-and-drop is intentionally deferred.
