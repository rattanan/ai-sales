const MAX_GROUNDING_CHARS = 80_000;

export function appendDisplayGrounding(
  current: string | undefined,
  value: string,
) {
  return `${current ?? ""}\n${value}`.slice(-MAX_GROUNDING_CHARS);
}

function normalizedText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function displayTextIsGrounded(
  grounding: string | undefined,
  value: string,
) {
  const source = normalizedText(grounding ?? "");
  const candidate = normalizedText(value);
  return Boolean(candidate && source.includes(candidate));
}

function numericFacts(value: string) {
  const facts = new Set<number>();
  for (const match of value.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)) {
    const parsed = Number(match[0].replaceAll(",", ""));
    if (Number.isFinite(parsed)) facts.add(parsed);
  }
  return facts;
}

export function displayNumbersAreGrounded(
  grounding: string | undefined,
  values: number[],
) {
  const facts = numericFacts(grounding ?? "");
  return values.every((value) => facts.has(value));
}
