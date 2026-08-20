# Phase 7 Execution — Consented Memory and Business Insight

- Status: Completed
- Migration: `20260816190000_phase7_memory_business_insight`

## Delivered architecture

Phase 7 adds personalized continuity without turning Chat history into an ungoverned profile store. Conversation summaries are generated only after both the message-count and context-character thresholds are exceeded. Every immutable summary version stores its exact cumulative source message IDs, provider, model, prompt version, and token usage. Original messages and citations remain unchanged and continue to pass through their existing ACL boundaries.

User Memory is separate from conversation summaries. A user must record an explicit consent decision for preference, department, or project categories before saving memory. Consent can apply globally or to one assigned Bot. Every grant/revoke is append-only history; revocation hard-deletes the selected memories. Individual and delete-all requests also issue database deletes and record only non-sensitive audit counts.

## Memory safety and retention

The service rejects password/passcode, token, credentials, API keys, authorization values, private keys, JWTs, bearer values, personal identifiers, contact details, financial patterns, and opaque secret assignments before persistence. Database constraints add defense in depth for obvious secret keys and values. Department and project values must resolve to the current user's real organization membership.

`memoryRetentionDays` is organization-configurable and defaults to 365 days. Every memory has an expiry. Expired rows are purged before prompt use, and user deletion/cascade semantics remove memory when the owning user is removed. Audit metadata never includes the memory value.

## Chat history governance

The user's Chat workspace supports server-side search, 25-item pagination, rename, delete, detailed feedback reason/comment, and explicit helpful/not-helpful actions. Conversations snapshot Bot, authentication mode, department, project, token/latency/error data, citations, and feedback.

Managers and administrators use a separate governed history page requiring a 10–500 character access reason. Every access writes an audit event with reason, result count, page, query-used flag, and applied scope. Administrators may view the organization; managers receive only conversations matching their department or assigned projects, with own-user fallback when no organization scope exists.

## Business Insight evidence model

Insight jobs accept a maximum 366-day range plus optional Bot, department, project, and user filters. The service validates every selected resource against the tenant and intersects the requested filters with the actor's server-derived scope before reading conversations.

The deterministic versioned aggregator produces exact conversation/message counts, daily message/error/latency trends, topic frequency, repeated questions, unanswered/error responses, knowledge-gap groups, low-performing cited sources and Bots, average/p95 latency, and evidence aggregates. Risk, opportunity, recommendation, source, and Bot findings carry evidence counts and message IDs.

At least three conversations and six messages are required for organizational findings. Smaller samples still persist exact metrics plus an explicit limitation, but the findings array remains empty. Each immutable snapshot records algorithm version, date range, filters, actor scope, sample counts, metrics, findings, and evidence IDs for later review.

## User experience and accessibility

The responsive Memory page provides labelled consent and edit forms, live success/error regions, 44 px controls, per-item deletion, consent history, and a typed delete-all confirmation. The Business Insight workbench provides filter controls, summary cards, an accessible labelled trend chart, top topics, knowledge-gap lists, evidence-bound findings, and immutable snapshot history.

## Verification

- Unit tests cover sensitive-memory rejection, summary thresholds, bounded filter/feedback contracts, deterministic topic/repeated/gap/error/source/Bot classification, evidence IDs, and no-conclusion behavior for insufficient samples.
- PostgreSQL integration tests create multiple departments/projects and verify that a manager's aggregate excludes out-of-scope conversations, rejects an out-of-scope filter, requires consent, rejects token memory, and physically deletes memory.
- Environment-gated Playwright coverage creates three conversations, runs an insight snapshot, verifies topic/sample UI, and opens the audited Chat drill-down with a recorded reason.
- Prisma validation/generation, migration status/drift, TypeScript, ESLint, Vitest, Worker build, and production Next.js build are Phase 7 release gates.
