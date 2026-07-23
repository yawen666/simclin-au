import { describe, expect, it } from 'vitest';
import { seedCases, seedRubrics } from './seed-content.js';

describe('clinical teaching seed integrity', () => {
  it('keeps five complete, internally linked cases and seven-domain rubrics', () => {
    expect(seedCases).toHaveLength(5);
    expect(seedRubrics).toHaveLength(5);
    expect(new Set(seedCases.map((item) => item.slug)).size).toBe(5);
    expect(new Set(seedRubrics.map((item) => item.slug)).size).toBe(5);

    const globalFactIds = new Set<string>();
    let factCount = 0;
    for (const clinicalCase of seedCases) {
      const facts = clinicalCase.caseData.atomicFacts;
      const factIds = new Set(facts.map((fact) => fact.id));
      const redFlagIds = new Set(clinicalCase.caseData.redFlags.map((redFlag) => redFlag.id));
      expect(facts.length).toBeGreaterThanOrEqual(20);
      expect(factIds.size).toBe(facts.length);
      expect(clinicalCase.openingStatement.trim().length).toBeGreaterThan(10);
      expect(clinicalCase.patient.name.trim()).not.toBe('');
      expect(clinicalCase.patient.age).toBeGreaterThan(0);
      expect(clinicalCase.caseData.contentStatus).toBe('synthetic-educational-draft');
      expect(clinicalCase.caseData.expertApprovalStatus).toBe('not-reviewed');
      expect(clinicalCase.caseData.sourceBasis.length).toBeGreaterThan(0);
      expect(clinicalCase.caseData.sourceBasis.every((source) => source.url.startsWith('https://'))).toBe(true);

      for (const fact of facts) {
        expect(fact.label.trim()).not.toBe('');
        expect(fact.value.trim()).not.toBe('');
        expect(globalFactIds.has(fact.id)).toBe(false);
        globalFactIds.add(fact.id);
        factCount += 1;
      }
      for (const redFlag of clinicalCase.caseData.redFlags) {
        expect(redFlag.linkedFactIds.every((id) => factIds.has(id))).toBe(true);
      }
      for (const item of clinicalCase.caseData.criticalItems) {
        expect(item.linkedFactIds.every((id) => factIds.has(id))).toBe(true);
      }

      const rubric = seedRubrics.find((item) => item.slug === clinicalCase.slug);
      expect(rubric).toBeDefined();
      expect(rubric!.criteria).toHaveLength(7);
      expect(rubric!.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBe(100);
      for (const criterion of rubric!.criteria) {
        expect(Object.keys(criterion.anchors).sort()).toEqual(['0', '1', '2', '3']);
        expect(criterion.redFlagIds.every((id) => redFlagIds.has(id))).toBe(true);
        for (const item of criterion.caseSpecificItems) {
          expect(item.linkedFactIds.every((id) => factIds.has(id))).toBe(true);
        }
      }
    }
    expect(factCount).toBe(123);
  });
});
