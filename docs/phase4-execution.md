# Phase 4 execution — Operational ingestion and index operations

## Delivered architecture

- `KnowledgeSource` now has typed `FILE`, `SHARED_FOLDER`, and `WEB` variants with dedicated configuration, immutable refresh runs, source snapshots, and last-refresh state.
- Shared folders are infrastructure-mounted read-only into the Worker only. The Web application validates the configured allowlist lexically, authorizes the administrator, stores configuration, and enqueues work; the Worker resolves canonical paths and reads files.
- Incremental folder scans persist stable relative locator, byte size, modified time, and SHA-256. Matching size/mtime reuses the prior checksum; only new or changed files create a version and index job. Missing files are marked inactive immediately, so retrieval no longer sees their existing chunks.
- Web ingestion revalidates the original URL, every DNS answer, every redirect, and canonical URLs against public-address and domain policies. It pins the validated DNS address for the request, bounds time/bytes/redirects/content types, strips common boilerplate, and persists ETag/Last-Modified for conditional refresh.
- BullMQ schedules and manual requests both execute in the NestJS Worker. Document jobs expose heartbeat, chunk progress, categorized failures, exponential retries, cancellation, and dead-letter state.
- Worker startup and a bounded recovery loop requeue stale refresh/index work. Atomic database claims prevent a recovered job and a BullMQ stalled-job retry from indexing the same version concurrently.

## Security boundaries

| Boundary                 | Enforcement                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Source administration    | Global `knowledge.manage` plus Rack-level `MANAGE`, repeated inside the service                             |
| Folder roots             | `KNOWLEDGE_SHARED_FOLDER_ROOTS` allowlist; canonical `realpath`; traversal and every symbolic link rejected |
| Folder exposure          | Read-only bind mount exists on Worker only; the Web application has no folder mount                         |
| Web network              | HTTP(S), no URL credentials, exact/subdomain allowlist, all DNS answers public, validated-address pinning   |
| Redirect/canonical URL   | Re-run domain, DNS, and private-address validation at every hop                                             |
| Response                 | Timeout, byte limit, redirect limit, accepted text content types, identity encoding                         |
| Retrieval after deletion | `Document.active = false`; ACL-first retrieval already requires active document/source/rack                 |
| Re-index                 | Existing indexed chunks remain visible until the replacement transaction commits                            |

## Operations

1. Mount the host folder at `/mnt/insightkm-knowledge` in the Worker. Docker Compose uses `KNOWLEDGE_SHARED_FOLDER_HOST_PATH` and a read-only bind mount.
2. Set `KNOWLEDGE_SHARED_FOLDER_ROOTS` to one or more platform paths separated by the OS path delimiter. Keep the application and Worker values identical even though only the Worker receives the mount.
3. Open `/workspace/admin/knowledge/sources` to register a folder or page, then run the first refresh. Enable a schedule only after the manual refresh succeeds.
4. Open `/workspace/admin/knowledge/index-jobs` to filter jobs, inspect progress/errors, cancel active work, retry terminal work, or re-index a current document.
5. Queue depth shows `Unavailable` when Redis cannot be reached; the database job history and controls remain visible.

## Verification completed

- Migration `20260816130000_phase4_operational_ingestion` applied successfully.
- Prisma validation/client generation, application type-check, and isolated Worker build pass.
- Unit security suite covers canonical allowlists, traversal, symlink escape, incremental checksum reuse, private/metadata/CGNAT/IPv6 targets, domain suffix confusion, redirect escape, boilerplate extraction, stale recovery, and concurrency bounds.
- PostgreSQL integration fixture passes the complete add → unchanged → change → delete folder sequence and verifies exactly two versions/jobs plus retrieval deactivation after delete.
- Retry jobs use exponential backoff with a maximum attempt count; queue failures are categorized and moved to dead letter.

## Production notes

- The local object store remains suitable only for a persistent single-cluster volume. A durable shared object-storage adapter is required before horizontally scaling workers across hosts.
- Web extraction follows same-host links to a fixed depth of two (up to 100 pages per refresh), deduplicates visited URLs, and does not support authenticated sites.
- DNS egress policy should still restrict Worker traffic at the infrastructure layer; application SSRF controls are defense in depth.
