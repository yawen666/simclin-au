import { describe, expect, it } from 'vitest';
import { calculateScore } from './scoring.js';

const rubric = [
  { id: 'communication', label: 'Communication', weight: 40 },
  { id: 'red-flags', label: 'Red flags', weight: 60, critical: true, redFlagIds: ['rf-acs'] },
];

describe('deterministic scoring', () => {
  it('normalises weighted scores and removes unsupported model credit', () => {
    const result = calculateScore({
      criteria: [
        { criterion_id: 'communication', score: 3, evidence_turn_ids: [10], feedback: 'Clear' },
        { criterion_id: 'red-flags', score: 3, evidence_turn_ids: [999], feedback: 'Unsupported' },
      ],
      missed_red_flags: [], strengths: [], improvements: [], overall_feedback: '',
    }, rubric, new Set([10]));
    expect(result.score).toBe(40);
    expect(result.criteria[1]?.score).toBe(0);
  });

  it('caps a result at 59 when a critical red flag is missed', () => {
    const result = calculateScore({
      criteria: rubric.map((item) => ({ criterion_id: item.id, score: 3, evidence_turn_ids: [10], feedback: 'Evidence' })),
      missed_red_flags: ['rf-acs'], strengths: [], improvements: [], overall_feedback: '',
      missed_red_flag_reasons: { 'rf-acs': 'The transcript contains no explicit screening question.' },
    }, rubric, new Set([10]));
    expect(result.uncappedScore).toBe(100);
    expect(result.score).toBe(59);
    expect(result.capApplied).toBe(59);
    expect(result.feedback.missed_red_flag_reasons).toEqual({ 'rf-acs': 'The transcript contains no explicit screening question.' });
  });

  it('ignores a model-invented red flag identifier', () => {
    const result = calculateScore({
      criteria: rubric.map((item) => ({ criterion_id: item.id, score: 3, evidence_turn_ids: [10], feedback: 'Evidence' })),
      missed_red_flags: ['hallucinated.red.flag'], strengths: [], improvements: [], overall_feedback: '',
    }, rubric, new Set([10]));
    expect(result.score).toBe(100);
    expect(result.capApplied).toBeNull();
    expect(result.feedback.missed_red_flags).toEqual([]);
  });

  it('does not cap a red flag when the transcript explicitly screens it', () => {
    const result = calculateScore({
      criteria: rubric.map((item) => ({ criterion_id: item.id, score: 3, evidence_turn_ids: [10], feedback: 'Evidence' })),
      missed_red_flags: ['rf-acs'], strengths: [], improvements: [], overall_feedback: '',
    }, rubric, new Set([10]), {
      caseContent: { caseData: { atomicFacts: [{ id: 'rf-acs', triggers: ['chest pain'] }] } },
      transcript: [{ speaker: 'student', content: 'Have you had any chest pain?', status: 'completed' }],
    });
    expect(result.score).toBe(100);
    expect(result.feedback.missed_red_flags).toEqual([]);
  });
});
