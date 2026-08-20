import { env } from "@/schemas/env";

export async function deliverPasswordReset(email: string, token: string) {
  const config = env();
  if (!config.PASSWORD_RESET_DELIVERY_URL) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(config.PASSWORD_RESET_DELIVERY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.PASSWORD_RESET_DELIVERY_TOKEN
          ? { authorization: `Bearer ${config.PASSWORD_RESET_DELIVERY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        template: "password-reset",
        recipient: email,
        resetUrl: `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: config.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
