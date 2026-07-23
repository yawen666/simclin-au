import type { RubricCriterion } from '../types.js';

export function collectCaseRedFlagIds(content: Record<string, unknown>): Set<string> {
  const caseData = content.caseData as Record<string, unknown> | undefined;
  const ids = new Set<string>();
  for (const value of [
    ...(Array.isArray(caseData?.atomicFacts) ? caseData.atomicFacts : []),
    ...(Array.isArray(caseData?.redFlags) ? caseData.redFlags : []),
  ]) {
    if (!value || typeof value !== 'object') continue;
    const id = (value as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) ids.add(id);
  }
  return ids;
}

export function unknownRubricRedFlagIds(
  criteria: RubricCriterion[],
  content: Record<string, unknown>,
): string[] {
  const available = collectCaseRedFlagIds(content);
  return [...new Set(criteria.flatMap((criterion) => criterion.redFlagIds ?? []))]
    .filter((id) => !available.has(id));
}
