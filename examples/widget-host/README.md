# InsightKM widget sample host

This dependency-free Node server demonstrates server-side HMAC signing and browser-side widget initialization.

1. In **Administration → Authentication**, enable Embedded Authentication and allow `http://127.0.0.1:4173`.
2. Assign the signed role access to the selected Bot.
3. Copy the one-time signing secret and run:

```bash
INSIGHTKM_BOT_ID="BOT_ID" \
INSIGHTKM_WIDGET_SIGNING_SECRET="ONE_TIME_SECRET" \
INSIGHTKM_WIDGET_ROLE="USER" \
node examples/widget-host/server.mjs
```

Open `http://127.0.0.1:4173`. Set `INSIGHTKM_BASE_URL` when InsightKM is not at `http://127.0.0.1:3000`.

The sample uses a stable external session ID to demonstrate conversation continuity. Production hosts should bind this value to their authenticated session and rotate it when the host session rotates.
