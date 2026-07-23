export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function extractJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(...['{', '['].map((c) => trimmed.indexOf(c)).filter((i) => i >= 0));
    const objectEnd = trimmed.lastIndexOf('}');
    const arrayEnd = trimmed.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    if (!Number.isFinite(start) || end <= start) throw new Error('Model did not return valid JSON');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
