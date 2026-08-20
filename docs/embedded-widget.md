# InsightKM embedded authentication and widget

## Trust boundary

The host application authenticates its own user, creates the identity payload on its server, and signs the complete payload. The signing secret stays server-side. InsightKM accepts `role` and `department` only from a valid signature and maps both claims to active tenant records; unknown claims are denied.

The browser exchanges the signed envelope once for a random opaque bearer token. InsightKM stores only the token's SHA-256 digest. The token is scoped to one organization, Bot, external user, external session, and exact host origin. It is not an Auth.js browser session.

## Configure a tenant

Open **Administration → Authentication**:

1. Enable **Embedded signed identity**.
2. Choose HMAC SHA-256, JWT HS256, or both.
3. Add exact origins such as `https://portal.example.com`; paths and wildcards are not supported.
4. Set a replay window between 30 and 900 seconds and a session TTL between 5 minutes and 24 hours.
5. Save and copy the one-time signing secret.
6. Grant the signed role access to the selected Bot and its Knowledge Racks.

Rotating the signing secret immediately revokes existing embedded sessions. The replacement secret is displayed once.

## HMAC payload

Required claims:

| Claim                          | Meaning                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `externalUserId` or `username` | Stable identity in the host system                          |
| `sessionId`                    | Stable authenticated host-session ID, at least 8 characters |
| `role`                         | Existing InsightKM tenant role name or system key           |
| `timestamp`                    | Unix seconds or milliseconds                                |
| `nonce`                        | Unique 16–200 character URL-safe value for every exchange   |
| `origin`                       | Exact host origin, including scheme and non-default port    |

Optional claims are `name` and `department`. Keys are recursively sorted before JSON serialization; arrays preserve order.

```ts
import { createHmac, randomUUID } from "node:crypto";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

const payload = {
  externalUserId: hostUser.id,
  username: hostUser.username,
  name: hostUser.displayName,
  sessionId: hostSession.id,
  role: hostUser.insightKmRole,
  department: hostUser.departmentCode,
  timestamp: Date.now(),
  nonce: randomUUID().replaceAll("-", "_"),
  origin: "https://portal.example.com",
};
const signature = createHmac("sha256", process.env.INSIGHTKM_WIDGET_SECRET!)
  .update(stableStringify(payload))
  .digest("base64url");
```

## JWT HS256

Use header `{ "alg": "HS256", "typ": "JWT", "kid": "KEY_ID_FROM_ADMIN" }` and the same identity claims as the JWT payload. Only HS256 is accepted. Tokens with another algorithm or key ID are rejected.

## Browser loader

```html
<script src="https://insightkm.example.com/widget/v1.js"></script>
<script>
  InsightKMWidget.init({
    botId: "BOT_ID",
    apiBase: "https://insightkm.example.com",
    hostOrigin: window.location.origin,
    payload: SIGNED_PAYLOAD_FROM_HOST_SERVER,
    signature: SIGNATURE_FROM_HOST_SERVER,
    theme: "indigo", // indigo, emerald, or slate
    position: "bottom-right", // or bottom-left
  });
</script>
```

The loader uses Shadow DOM to isolate host styles. The chat application is a separate iframe whose response sets a nonce-based Content Security Policy and a `frame-ancestors` directive derived from the tenant origin allowlist. The iframe checks both `event.origin` and `event.source` before accepting signed identity data.

Recommended host CSP additions:

```text
script-src https://insightkm.example.com
frame-src https://insightkm.example.com
connect-src https://insightkm.example.com
```

Do not add the InsightKM signing secret to a `NEXT_PUBLIC_*`, `VITE_*`, browser bundle, page source, analytics payload, or client log.

## Session continuity and limits

The same signed external user + Bot + `sessionId` resumes the stored conversation. Reusing the same `sessionId` for another external user is treated as session fixation and denied. Every exchange still requires a fresh nonce and timestamp.

Widget messages have a separate 20 requests/minute bucket keyed by Bot, normalized origin, user, and external session. The existing knowledge-chat user/Bot limit is also enforced.

## External Authentication API contract

Credential login selects the first enabled credential mode in the policy priority. Embedded mode is not a credential-login mode. Once External API is selected, provider rejection, timeout, malformed mapping, or transport failure does not fall back to Local.

The configured request mapping writes username and password to the selected GET/POST/PUT request. Prefer POST; GET may expose credentials in intermediary URL logs. A successful response must resolve `successPath` to the boolean `true` and return string values for external user ID and role. Unknown roles/departments are denied. Successful identities become shadow users with `passwordHash = null`; external passwords are never persisted or audited.

## Manual accessibility verification

- Keyboard: toggle opens the iframe, focus moves to the composer, Tab/Shift+Tab remain in the panel, Escape closes it, and focus returns to the toggle.
- Screen reader: toggle, close, input, send, status, and message log have names/roles; new messages are announced through the polite live region.
- Zoom/mobile: verify at 200% zoom and widths 320, 390, 768, and 1440 px without horizontal page overflow.
- Motion/contrast: `prefers-reduced-motion` is honored; verify focus indicators and text/control contrast in each theme.

The runnable example is at [`examples/widget-host`](../examples/widget-host/README.md).
