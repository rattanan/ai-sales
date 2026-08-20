const baseUrl = process.env.PHASE8_SECURITY_BASE_URL ?? "http://127.0.0.1:3000";
const response = await fetch(baseUrl, { redirect: "manual" });
const required = {
  "content-security-policy": [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ],
  "x-content-type-options": ["nosniff"],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "permissions-policy": ["camera=()", "microphone=()", "geolocation=()"],
};
const failures = [];
for (const [name, fragments] of Object.entries(required)) {
  const value = response.headers.get(name) ?? "";
  for (const fragment of fragments)
    if (!value.includes(fragment)) failures.push(`${name} missing ${fragment}`);
}
if (
  baseUrl.startsWith("https://") &&
  !response.headers.get("strict-transport-security")
)
  failures.push("strict-transport-security missing on HTTPS deployment");
if (response.headers.get("access-control-allow-origin") === "*")
  failures.push("credentialed application response exposes wildcard CORS");
if (failures.length) {
  process.stderr.write(`${JSON.stringify({ status: "failed", failures })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ status: "passed", url: new URL(baseUrl).origin, httpStatus: response.status })}\n`,
  );
}
