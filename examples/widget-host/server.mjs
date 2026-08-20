import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const insightKmBase = new URL(
  process.env.INSIGHTKM_BASE_URL ?? "http://127.0.0.1:3000",
).origin;
const botId = process.env.INSIGHTKM_BOT_ID;
const signingSecret = process.env.INSIGHTKM_WIDGET_SIGNING_SECRET;
const port = Number(process.env.PORT ?? 4173);
const hostOrigin = `http://127.0.0.1:${port}`;

if (!botId || !signingSecret)
  throw new Error(
    "INSIGHTKM_BOT_ID and INSIGHTKM_WIDGET_SIGNING_SECRET are required",
  );

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function page() {
  const payload = {
    externalUserId: "sample-employee-001",
    username: "sample.employee",
    name: "Sample Employee",
    sessionId: "sample-browser-session-001",
    role: process.env.INSIGHTKM_WIDGET_ROLE ?? "USER",
    ...(process.env.INSIGHTKM_WIDGET_DEPARTMENT
      ? { department: process.env.INSIGHTKM_WIDGET_DEPARTMENT }
      : {}),
    timestamp: Date.now(),
    nonce: randomUUID().replaceAll("-", "_"),
    origin: hostOrigin,
  };
  const signature = createHmac("sha256", signingSecret)
    .update(stableStringify(payload))
    .digest("base64url");
  const config = JSON.stringify({
    botId,
    apiBase: insightKmBase,
    hostOrigin,
    payload,
    signature,
    theme: "indigo",
    position: "bottom-right",
  }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InsightKM Widget Sample Host</title><style>body{margin:0;min-height:100vh;font-family:system-ui;background:linear-gradient(135deg,#eef2ff,#f8fafc);color:#172033}.content{max-width:760px;margin:auto;padding:72px 24px}h1{font-size:clamp(2rem,7vw,4rem);margin:0}.card{margin-top:28px;padding:24px;border:1px solid #dbe2f0;border-radius:20px;background:#ffffffcc;box-shadow:0 18px 50px #17203312}code{word-break:break-all}</style></head><body><main class="content"><p>Sample host application</p><h1>InsightKM embedded securely.</h1><section class="card"><h2>Signed on the host server</h2><p>The browser receives a short-lived payload and signature, but never the signing secret.</p><p>Host origin: <code>${hostOrigin}</code></p></section></main><script src="${insightKmBase}/widget/v1.js"></script><script>InsightKMWidget.init(${config});</script></body></html>`;
}

createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-inline' ${insightKmBase}; frame-src ${insightKmBase}; style-src 'unsafe-inline'`,
  });
  response.end(page());
}).listen(port, "127.0.0.1", () => {
  console.log(`Widget sample host: ${hostOrigin}`);
});
