# Phase 3 execution — Authentication Modes, Extended ACL, and Embedded Widget

## Delivered architecture

- Tenant `AuthenticationPolicy` with independently enabled Local, External API, and Embedded modes plus deterministic priority.
- HMAC SHA-256 and JWT HS256 embedded exchange with exact-origin enforcement, timestamp window, one-time nonce, signed role/department mapping, session-fixation protection, and opaque bearer sessions.
- Configurable External Auth API method, headers, encrypted secret header, request/response mappings, timeout, health test, shadow-user provisioning, and no silent Local fallback.
- Central `authorizeResource` service for Bot, Rack, Source, Document, Data Source, database schema/table, Legacy API, Chat, and Insight. Explicit deny precedes allow; Source/Document and database children inherit; unmatched access is denied by default.
- Admin Authentication and Access Simulator pages with auditable policy changes, one-time secret rotation, contract testing, generic ACL rules, and explainable precedence traces.
- Versioned public loader, Shadow DOM floating launcher, CSP-protected iframe, responsive/mobile layout, focus containment, host/server signing sample, session history, and widget-specific rate limiting.

## Security decisions

| Area                      | Decision                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Browser token             | Random 256-bit opaque value; only SHA-256 digest stored                                |
| Secret storage            | AES-256-GCM encrypted at rest with configured credential key/version                   |
| Origin                    | Exact normalized HTTP(S) origin; no wildcard or path matching                          |
| Replay                    | Unique hashed nonce per embedded config plus bounded timestamp window                  |
| Claims                    | Role and department must be signed and map to active tenant records                    |
| Session continuity        | Unique organization + Bot + external session; different user is denied                 |
| Authorization             | Tenant scope, explicit deny, explicit allow, managed/inherited policy, deny by default |
| External provider failure | Audit and deny; no implicit Local fallback                                             |
| Password handling         | Sent only to configured provider; never stored in shadow user or audit metadata        |

## Verification completed

- Prisma validation/client generation and TypeScript typecheck.
- Unit tests for canonical HMAC payloads, tampering sensitivity, JWT key ID, exact external request/response mapping, and strict boolean success.
- PostgreSQL integration tests for all ten resource types, explicit deny precedence, deny-by-default, tenant isolation, payload tampering, replay, forged role, cross-origin, expiry, session fixation, JWT/HMAC exchange, and shadow password absence.
- Playwright E2E against the separate sample-host origin at mobile width: server-side HMAC exchange, launcher/panel interaction, grounded chat response, and conversation reconnection after host reload.
- Migration `20260816110000_phase3_auth_acl_widget` applied successfully and the idempotent seed created a safe Local-only default authentication policy.
- Manual checklist for keyboard, focus containment, screen-reader names/live regions, mobile/zoom, motion, and contrast is documented in `docs/embedded-widget.md`.

## Operational notes

- Embedded and External modes are disabled by default. An administrator must configure origins/provider details and map roles before enabling them.
- Secret rotation revokes all active embedded sessions for the tenant.
- Expired nonce records may be removed by an operations cleanup job; keeping them beyond expiry is safe but consumes storage.
- Generic Legacy API and Insight IDs are virtual tenant-scoped identifiers and remain denied unless explicitly allowed or covered by a management permission.
