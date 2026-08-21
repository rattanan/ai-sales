# NTOP Business Memory integration

InsightKM remains the governed Knowledge + AI Chat layer. NTOP remains the system of record for Customer, Prospect, Lead, Opportunity, Product, and Quotation facts.

## Runtime flow

1. Chat classifies a likely sales message and extracts explicit sales facts.
2. Read tools search NTOP automatically through the InsightKM backend.
3. Existing NTOP facts are supplied as ephemeral grounded context alongside InsightKM knowledge. They are not indexed into the vector store.
4. A write intent creates an expiring `NtopActionProposal`; it does not call an NTOP write endpoint.
5. Only the authenticated owner can confirm the action. InsightKM decrypts that user's personal NTOP API Key on the server, claims the proposal atomically, and calls NTOP with its stable idempotency key.
6. NTOP resolves the API Key to the matching active NTOP user. Existing domain services use that identity as the record owner/maker and write their normal server timestamp and audit event.

## Configuration

InsightKM:

```env
NTOP_API_URL="https://ntop.example/api/v1"
NTOP_API_TIMEOUT_MS="15000"
```

`NTOP_API_KEY` remains an optional legacy read fallback during migration. Write actions never use it. Each InsightKM user must store the one-time personal key generated for their matching NTOP user, either when an InsightKM administrator creates/edits the user or later from Profile.

In NTOP, an administrator creates the user or rotates an existing user's key from **Admin → Users**. The full value is shown once for copying; NTOP stores only a SHA-256 hash, masked prefix, and issuance timestamp.

Legacy shared-key compatibility in NTOP is optional:

```env
NTOP_INTEGRATION_API_KEY="same-shared-secret"
NTOP_INTEGRATION_ACTOR_ID="active-least-privilege-ntop-user-id"
```

The legacy integration actor must have only the sales permissions required for read fallback. Never use a `NEXT_PUBLIC_` variable for any credential.

Deploy both Prisma migrations before enabling per-user credentials. If a user has no personal key, ordinary Knowledge Chat continues to operate; NTOP writes remain pending until the user connects their key.
