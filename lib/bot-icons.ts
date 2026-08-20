export const STANDARD_BOT_ICON_IDS = [
  "bot",
  "sparkles",
  "brain",
  "book",
  "headset",
  "message",
] as const;

export type StandardBotIconId = (typeof STANDARD_BOT_ICON_IDS)[number];

export function standardBotIconPath(icon: StandardBotIconId) {
  return `/bot-icons/${icon}.svg`;
}

export function standardBotIconId(value: string | null | undefined) {
  if (!value) return undefined;
  return STANDARD_BOT_ICON_IDS.find(
    (icon) => standardBotIconPath(icon) === value,
  );
}

export function isStandardBotIconPath(value: string | null | undefined) {
  return standardBotIconId(value) !== undefined;
}
