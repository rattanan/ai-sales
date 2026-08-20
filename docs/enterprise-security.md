# Enterprise access and Excel architecture

## Authorization model

All entry points derive the user from Auth.js and the tenant from a persisted organization membership. Flexible roles are organization-scoped and grant global permission keys through `RolePermission`. `DataSourceAccess`, `DashboardAccess`, and `AIAccessPolicy` narrow those grants to individual resources. UI visibility is advisory; Server Actions, Route Handlers, services, and repositories repeat authorization.

The legacy `OrganizationMember.role` remains only as a centralized compatibility bridge for Phase 0/1 organizations. New accounts receive flexible `UserRole` records. It can be removed after every existing tenant has been migrated.

| Role                          | User admin | Data sources / Excel                    | Dashboards                       | Copilot                 | Security logs |
| ----------------------------- | ---------- | --------------------------------------- | -------------------------------- | ----------------------- | ------------- |
| System Admin                  | Full       | Full                                    | Full                             | Allowed                 | View/export   |
| Data Source Manager           | None       | Create, manage, preview, refresh, grant | View only                        | No default grant        | None          |
| Dashboard Builder             | None       | Assigned preview/build access           | Create, edit, optionally publish | Allowed by policy       | None          |
| Dashboard Viewer / AI Analyst | None       | No direct access                        | Assigned published dashboards    | Assigned dashboard only | None          |

## Account security

Public registration returns a server-side forbidden result. Administrators issue Argon2id-hashed temporary passwords. JWTs contain a database-backed session version; password reset, account disable, lock, and deletion increment it, invalidating previously issued sessions. Disabled and locked accounts are rejected before sign-in.

Failed attempts and IP/identifier rate-limit buckets are stored in PostgreSQL. Five failures lock an account by default. A configured lock duration permits automatic unlock, while administrators can explicitly unlock. Every known-account success, failure, lock, reset, and logout creates history/audit evidence without storing passwords.

Reset tokens contain 256 bits of entropy, are stored only as SHA-256 hashes, expire after 30 minutes by default, and are single use. Production delivery uses the configured HTTPS notification endpoint. The endpoint receives the recipient, reset URL, template name, and expiry; its bearer credential remains server-only. Development may expose a reset link in the form response for local testing.

## Excel lifecycle

Only `.xlsx` OOXML archives are accepted. Upload validation checks extension, MIME type, ZIP signature, byte size, sheet count, row count, workbook readability, and duplicate/empty headers. Formula evaluation and HTML extraction are disabled.

One workbook is one `DataSource`; each sheet becomes an `ExcelSheet` and logical `DataSourceTable`. Columns receive sampled basic types. Rows are stored individually as JSON with a bounded search projection, allowing server-side pagination without sending a full sheet to the browser.

Replacement creates an immutable `ExcelFileVersion`, compares sheets/columns, identifies likely same-position renames, rebuilds current logical metadata, and marks linked dashboards for review when schema changes. Previous bytes and imported rows remain available. A completed non-current version can be restored; rollback also marks dashboards for review.

## Deployment

Apply migrations and seed explicitly:

```bash
npm run db:deploy
npm run db:generate
npm run db:seed
```

The initial administrator is taken only from `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_USERNAME`, and `INITIAL_ADMIN_PASSWORD`. Set `SEED_DEVELOPMENT_TEST_USERS=true` plus `DEVELOPMENT_TEST_USER_PASSWORD` only in local development to create the three non-admin role accounts documented in the README.
