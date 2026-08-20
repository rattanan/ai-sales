# Phase 6 Execution — Legacy API Registry and Read-only Tool Calling

## Delivered outcome

Phase 6 adds governed real-time API tools to InsightKM. An administrator registers one fixed operation per tool, assigns it to a Bot, and grants actor ACL. Chat can select only registered metadata, asks for missing required parameters before network access, invokes through a bounded server-only transport, and returns a masked summary with API/time citation.

## Registry contract

Each `LegacyApi` stores organization/workspace ownership, name and tool description, public base URL, fixed endpoint path, GET or confirmed read-only POST method, exact domain allowlist, timeout/byte/redirect limits, static non-secret headers, typed parameter definitions, optional JSON body template, JSON Schema response contract, and response mapping.

Supported encrypted authentication modes are none, API key header, bearer token, basic authentication, and custom header. Credential fields are stored in `LegacyApiCredential` using the existing versioned AES-256-GCM envelope. Admin pages receive only `credentialPresent`; ciphertext, IV, authentication tag, and plaintext are never serialized to Client Components.

Static request headers reject authentication-like names, host/transport/forwarding/cookie headers, and CR/LF. Body templates reject credential-like keys. Authentication headers are injected only after server-side decryption at the final request-building boundary.

## Authorization model

An invocation requires all of the following:

1. Active organization membership and `legacy_api.use` permission.
2. An enabled API in the current organization/workspace.
3. Explicit central `LEGACY_API` resource ACL for the actor, unless the actor has management permission.
4. When invoked by Chat, a `BotLegacyApi` assignment to the active Bot.

Tool selection receives metadata only for APIs that already pass Bot assignment and actor ACL. The selected API ID is checked again before request construction and again by the invocation service.

## Safe invocation boundary

`buildLegacyApiRequest` accepts only declared scalar parameters. It URL-encodes path values, constructs query values by registered name, applies a fixed JSON body template, rejects undeclared fields and unresolved placeholders, and never accepts a caller-provided URL, header set, or arbitrary body.

Before every request and redirect, the transport validates protocol, exact/subdomain allowlist, DNS results, public IP ranges, and DNS rebinding resistance by pinning the validated address into the Node HTTP lookup callback. Cross-origin redirects are denied. Responses must be uncompressed JSON, complete inside one absolute deadline, and remain below the configured byte cap. Non-2xx, invalid JSON, schema mismatch, oversized content, unsafe redirect, and address-policy errors fail closed.

POST is accepted only when the registry and database constraint both record explicit read-only confirmation. The integration remains defense in depth; the upstream service account must also have read-only privileges.

## Chat and evidence flow

Chat routing uses the following order:

1. A clearly database-oriented question uses the Phase 5 pipeline.
2. Otherwise, the model selects from authorized registered API metadata and extracts only explicit parameter values.
3. Missing required values create a `CLARIFICATION_REQUIRED` invocation without performing a network request.
4. A completed response is JSON-Schema validated, response-mapped, recursively bounded, and masked by the organization privacy policy before summarization.
5. If no governed database/API tool matches, document retrieval proceeds.

An API failure returns a stable user-facing error and stops that tool path; Chat does not invent or substitute API data. `MessageCitation` links to exactly one of document chunk, database query, or Legacy API invocation. API citation metadata contains API ID/name, registered method/path, call time, HTTP status, and duration—never the full URL, parameters, headers, raw response, or secret.

## Audit and data minimization

Invocations persist parameter names and a SHA-256 request fingerprint, not plaintext values. Results stored for preview are privacy-masked and bounded. Audits record API ID, actor, outcome, method, HTTP status, error category, and latency. Safe generic errors are persisted instead of raw upstream error bodies or stack traces.

## Admin experience and accessibility

The responsive Registry UI provides labelled contract/auth fields, JSON editors, live status/alert regions, masked credential state, safe Test API output, and touch targets of at least 44 px. Bot Studio includes a multi-select API allowlist and explains the repeated ACL check.

## Verification

- Unit contract coverage for all five authentication modes, required-parameter clarification, fixed path/query binding, undeclared override rejection, response mapping, header injection, private targets, redirects, content type, malformed JSON, and oversized responses.
- Integration coverage for permission plus explicit ACL, deny precedence, and the exactly-one citation-source database constraint.
- Existing Phase 3 ACL integration updated to resolve a real tenant-scoped Legacy API.
- Environment-gated Playwright flow covers clarification, completed invocation, and API/time citation against an allowlisted public read-only fixture.
- Prisma validation/generation, TypeScript, ESLint, Vitest, build, migration status, seed, and schema-drift checks are required release gates.
