# InsightKM Upgrade and Rollback Procedure

## Before deployment

1. Freeze the release commit and container digests; record the current application and database migration versions.
2. Run typecheck, unit/integration tests, production build, dependency/image scan, header check, agreed load profile, and backup verification.
3. Confirm all current and previous encryption-key versions required by live rows are available. Never remove a previous key during the same release that introduces the new key.
4. Create a verified database/storage backup and confirm the rollback owner, decision deadline, and maintenance communication.
5. Review Prisma SQL for destructive or locking changes. Phase 8 is additive and may build indexes; schedule according to production table size.

## Rolling upgrade

1. Stop or drain write-producing entry points while existing workers finish within the shutdown grace period.
2. Deploy the additive migration with `npm run db:deploy` from a single release task.
3. Start the new Worker, verify database/Redis/provider health and queue recovery, then start the new App and Nginx.
4. Run smoke tests for login, Admin health, scoped search/citation, denied cross-scope access, and one background indexing operation.
5. Restore traffic gradually to the limited pilot Department. Monitor SLO, queue saturation, error category, slow-query count, and stale key-version count.

## Application rollback

Roll back to the recorded previous image only when its schema contract is compatible with the additive migration. Stop new producers, drain/stop the new Worker, deploy the previous Worker/App pair, run smoke tests, then reopen pilot traffic. Keep Phase 8 columns and indexes in place; an additive database migration does not need to be reversed merely to roll back application code.

## Database rollback

Do not hand-edit migration history and do not run a destructive down migration against production. If a schema or data defect makes the release unusable:

1. Stop all App and Worker writers.
2. Preserve the failed environment and logs as incident evidence without sensitive payloads.
3. Restore the pre-upgrade PostgreSQL and storage backup into a clean target according to the disaster-recovery runbook.
4. Point the recorded previous image at the restored target, verify login/search/citation/ACL, then switch traffic under the incident owner's approval.
5. Reconcile data created after the backup only through an approved, tested recovery plan.

## Encryption-key rotation

1. Generate a new 32-byte base64 key in the approved secret manager and choose a new immutable `CREDENTIAL_KEY_VERSION`.
2. Put each still-needed old key in `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` as `version:base64`, comma-separated.
3. Deploy App and Worker with the new current version plus old versions. New writes use the current version; old rows remain readable.
4. Re-save/re-encrypt governed provider and connector credentials through an approved maintenance change, then verify the Admin System Health stale-key count reaches zero.
5. Remove an old key only after database evidence shows no encrypted row references that version and a recovery backup with the new version has passed its drill.

## Go/no-go evidence

Record commit/image/migration, change window, owners, backup ID, scans, tests, load profile, SLO snapshot, smoke results, defects, rollback decision, and approvals. A failed ACL, masking, citation, restore, or unresolved Critical/High security finding is an automatic no-go.
