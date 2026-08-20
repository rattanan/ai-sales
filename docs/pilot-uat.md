# InsightKM Controlled Pilot and UAT

## Pilot boundary

Select exactly one Department, named pilot owners, approved Knowledge Racks/Bots, non-production test records, a start/end date, and a support channel. Do not grant organization-wide resources by convenience. The Admin exports the effective membership/resource matrix before opening access; the Manager confirms it. Any scope expansion is a reviewed change.

Entry gates are: migration/build/tests green, final image has no unresolved Critical/High finding, backup/restore evidence accepted, agreed load profile accepted, Admin SLO page healthy or explicitly no-data before first traffic, and incident/rollback owners available.

## Admin acceptance script

1. Sign in, change a temporary password if required, and verify Admin routes are available.
2. Configure the primary provider and an explicitly disabled fallback; run health checks without exposing a credential in UI/audit/logs.
3. Enable every PDPA mask, add one test policy label, send a test message containing synthetic protected values, and verify the provider/audit logs show only mask categories/counts.
4. Create/verify the pilot Department, Manager/User memberships, Bot, Rack, source, and deny-by-default grants.
5. Upload a valid bilingual document; confirm invalid MIME, traversal-style name, and oversized upload are rejected.
6. Index the document, verify operation progress and citation download, then restart the Worker during a test re-index and verify recovery.
7. Open another user's Chat History with a recorded business reason and verify an audit event exists.
8. Review System Health SLO, queue, slow query, encryption key, privacy, database, Redis, Worker, and provider readiness.

Expected result: all steps pass without direct database edits. Record evidence IDs, not protected content.

## Manager acceptance script

1. Sign in as the pilot Department Manager.
2. Verify only pilot Department/project conversations and resources are visible.
3. Attempt one known out-of-scope Bot, Rack/document, conversation, database scope, and insight filter; every attempt must be denied.
4. Ask one Thai and one English grounded question; verify cited text supports the answer and the protected download respects authorization.
5. Run a Business Insight snapshot for the allowed scope and drill into evidence using a 10–500 character access reason.
6. Verify insufficient sample size produces a limitation rather than invented conclusions.

Expected result: allowed work succeeds and every cross-scope attempt fails without manual intervention.

## User acceptance script

1. Sign in as a pilot User and verify Admin/Manager navigation is unavailable.
2. Open the bilingual Bot, ask Thai/English questions, inspect citations, and submit structured helpful/not-helpful feedback.
3. Rename/search/delete a personal conversation and confirm it is no longer available.
4. Grant one memory category, save a non-sensitive preference, revoke consent, and verify the memory is deleted.
5. Attempt to save a token, national ID, or credential as memory and verify rejection.
6. Verify only assigned Bot/Rack/source content is returned and no answer is fabricated when evidence is absent.

Expected result: the critical journey completes without support or database intervention.

## Formal sign-off

| Role                | Representative | Script result | Evidence/defects | Date/time | Decision/signature |
| ------------------- | -------------- | ------------- | ---------------- | --------- | ------------------ |
| Admin               |                | Pass / Fail   |                  |           |                    |
| Manager             |                | Pass / Fail   |                  |           |                    |
| User                |                | Pass / Fail   |                  |           |                    |
| Product Owner       |                | Go / No-go    |                  |           |                    |
| Security/Operations |                | Go / No-go    |                  |           |                    |

Electronic approval must identify the approver and immutable release/evidence IDs. Never paste passwords, tokens, personal data, prompts, or document content into this record.

## Feedback record

- Release/pilot Department:
- Reporter role and anonymous ID:
- Journey and expected outcome:
- Actual outcome:
- Severity/impact and frequency:
- Evidence IDs/screenshots after redaction:
- Workaround:
- Product decision: accept / fix in V1.1 / candidate V2 / reject:
- Owner and target date:

## Incident record

- Incident ID, detected time, commander, release:
- Scope and data classification (no raw sensitive data):
- Security/ACL/citation/availability impact:
- Containment and traffic state:
- Timeline and sanitized evidence IDs:
- Root cause and regression test:
- Recovery/restore result and RPO/RTO:
- Required notification/approval:
- Corrective action owner/date:

Immediately stop pilot traffic for suspected tenant/ACL leakage, unmasked protected data sent externally, secret exposure, citation pointing to unauthorized content, or an unresolved Critical/High finding.

## Backlog triage

Tag each accepted item with `pilot`, capability, severity, evidence link, owner, target (`V1.1` or `V2`), dependency, acceptance test, and security/privacy effect. Critical fixes block pilot restart; High fixes require Security and Product Owner disposition; lower priorities follow the agreed backlog cadence.
