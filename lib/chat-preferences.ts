/**
 * Composer choices that outlive a single turn.
 *
 * Kept in a cookie rather than `localStorage` so the server component already
 * knows the value when it renders: reading it on the client would need an
 * effect, paint the default first, then correct itself in front of the reader.
 */

export const THINK_LEVEL_COOKIE = "insightkm-think-level";

/** "DEFAULT" leaves the choice to the bot configuration. */
export const THINK_LEVELS = ["DEFAULT", "low", "medium", "high"] as const;

export type ThinkLevel = (typeof THINK_LEVELS)[number];

/**
 * A cookie is a hint, never an authority. Anything unrecognised falls back to
 * the bot's own setting, and the effort that reaches the provider is validated
 * server-side regardless of what arrives here.
 */
export function isThinkLevel(value: unknown): value is ThinkLevel {
  return (
    typeof value === "string" && THINK_LEVELS.includes(value as ThinkLevel)
  );
}

/** Client-only: mirrors how the workspace locale is remembered. */
export function rememberThinkLevel(level: ThinkLevel) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THINK_LEVEL_COOKIE}=${level}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
