# InsightKM Backup and Disaster-Recovery Runbook

## Scope and ownership

The release owner coordinates the drill. A database owner controls PostgreSQL credentials, a platform owner controls Redis and object storage, and an application owner verifies login, search, citations, ACL, and worker recovery. Never restore into a production database during a drill.

## Recovery objectives

- Default pilot RPO: 24 hours; shorten according to business classification.
- Default pilot RTO: 4 hours from incident declaration to verified service.
- Keep database, Redis, storage, application image, migration version, and encryption-key metadata from the same release window.
- Store encryption keys in the approved secret manager, separately from backups. A backup without its required key versions is not recoverable.

## Create and protect a backup

Use an explicit non-root directory. The script refuses broad destinations.

```bash
export BACKUP_DIR=/srv/insightkm-backups
export DATABASE_URL='postgresql://...'
export REDIS_URL='redis://...'
export LOCAL_STORAGE_PATH=/srv/insightkm-storage
npm run ops:backup
```

The result contains a custom-format PostgreSQL dump, optional Redis RDB, optional object-storage archive, and SHA-256 checksums. Encrypt the completed set at rest, restrict it to the recovery role, replicate it off-host, and test checksum verification before retention starts.

## Restore drill

1. Provision an isolated network and a disposable PostgreSQL database whose name ends exactly `_restore_drill`.
2. Provision isolated Redis and storage targets. Do not reuse production endpoints.
3. Verify `SHA256SUMS`, image digest, migration directory, and all referenced encryption-key versions.
4. Set the explicit restore inputs and run:

```bash
export RESTORE_DATABASE_URL='postgresql://.../insightkm_restore_drill'
export POSTGRES_BACKUP_FILE=/srv/insightkm-backups/DATE/postgres.dump
export OBJECT_STORAGE_BACKUP_FILE=/srv/insightkm-backups/DATE/object-storage.tgz
export RESTORE_STORAGE_DIR=/srv/insightkm-restore-storage
npm run ops:restore-drill
```

5. Start isolated Redis, Worker, App, and Nginx with the restored database/storage and matching secret versions.
6. Sign in as a designated drill account; do not use a real user's password.
7. Verify one allowed document can be searched and downloaded, its answer citation opens, and an out-of-scope user is denied.
8. Enqueue one indexing operation, restart the Worker mid-operation, and verify recovery reaches a terminal state without duplicate active work.
9. Capture start/end timestamps, row/count checks, application/worker health, test identities, citation IDs, deny result, recovery result, RPO/RTO, and owners. Do not attach content, prompts, secrets, or personal data.

## Redis recovery policy

Redis contains queue state and transient coordination, not the source of truth for document metadata. Restore the RDB when available. If it is unusable, start an empty isolated Redis and let startup recovery reclaim stale database operations. Confirm dead-letter and retry policy before reopening producers. Redis uses `noeviction`; queue backpressure is expected to reject excess producers rather than lose keys silently.

## Failure and escalation

Stop the drill and declare a failed gate when login, ACL denial, search, citation, decryption, or Worker recovery cannot be verified. Record an incident using the template in `docs/pilot-uat.md`, keep the isolated target for investigation, rotate any credential accidentally exposed, and do not promote the release.

## Retention

Apply organization policy to backup sets independently from application-row retention. Delete expired sets through the storage platform's governed lifecycle, retain immutable audit evidence for the required period, and record only backup ID, classification, dates, status, checksum result, and approver.
