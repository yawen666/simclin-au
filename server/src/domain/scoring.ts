import { z } from 'zod';
import type { RubricCriterion } from '../types.js';
import { AppError } from '../lib/errors.js';

const CriterionAssessmentSchema = z.object({
  criterion_id: z.string(),
  score: z.coerce.number().int().min(0).max(3),
  evidence_turn_ids: z.array(z.coerce.number().int().positive()).default([]),
  feedback: z.string().default(''),
});

export const EvaluationSchema = z.object({
  criteria: z.array(CriterionAssessmentSchema),
  missed_red_flags: z.array(z.string()).default([]),
  missed_red_flag_reasons: z.record(z.string(), z.string()).default({}),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  overall_feedback: z.string().default(''),
}).superRefine((value, context) => {
  const ids = value.criteria.map((criterion) => criterion.criterion_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion IDs must be unique' });
  }
});

export type ParsedEvaluation = z.infer<typeof EvaluationSchema>;
export const SCORING_VERSION = 'history-weighted-v1';

export interface ScoreResult {
  score: number;
  uncappedScore: number;
  level: 'Excellent' | 'Competent' | 'Developing' | 'Needs improvement';
  capApplied: number | null;
  criteria: Array<{
    criterionId: string;
    score: number;
    weightedScore: number;
    evidenceTurnIds: number[];
    feedback: string;
  }>;
  feedback: ParsedEvaluation & {
    score_cap_reason?: string;
    scoring: {
      version: typeof SCORING_VERSION;
      formula: string;
      roundingRule: string;
      totalWeight: 100;
      uncappedScore: number;
      capApplied: number | null;
    };
  };
}

interface ScoreContext {
  caseContent?: Record<string, unknown>;
  transcript?: Array<{ speaker: string; content: string; status?: string }>;
}

export function calculateScore(
  raw: unknown,
  rubric: RubricCriterion[],
  validStudentTurnIds: Set<number>,
  context: ScoreContext = {},
): ScoreResult {
  const evaluation = EvaluationSchema.parse(raw);
  assertRubricScoringContract(rubric);
  const byId = new Map(evaluation.criteria.map((item) => [item.criterion_id, item]));

  const criteria = rubric.map((criterion) => {
    const item = byId.get(criterion.id);
    const evidenceTurnIds = (item?.evidence_turn_ids ?? []).filter((id) => validStudentTurnIds.has(id));
    // A positive model score without valid evidence is deterministically reduced to zero.
    const score = evidenceTurnIds.length > 0 ? Math.min(3, Math.max(0, item?.score ?? 0)) : 0;
    return {
      criterionId: criterion.id,
      score,
      weightedScore: Math.round(((score / 3) * criterion.weight) * 10_000) / 10_000,
      evidenceTurnIds,
      feedback: item?.feedback ?? '',
    };
  });

  const uncappedScore = Math.round(criteria.reduce((sum, item) => sum + item.weightedScore, 0) * 100) / 100;
  // Only rubric-defined red flags may affect a deterministic score. This keeps
  // a model-invented identifier from creating a false safety cap.
  const allowedRedFlagIds = new Set(rubric.flatMap((criterion) => criterion.redFlagIds ?? []));
  const validatedMissedRedFlags = [...new Set(evaluation.missed_red_flags)]
    .filter((id) => allowedRedFlagIds.has(id))
    // If the student explicitly screened the relevant fact, do not let a
    // model-only missed-red-flag claim create a deterministic score cap.
    .filter((id) => !studentScreenedRedFlag(context.caseContent, context.transcript, id));
  const validatedMissedRedFlagReasons = Object.fromEntries(
    Object.entries(evaluation.missed_red_flag_reasons)
      .filter(([id, reason]) => validatedMissedRedFlags.includes(id) && reason.trim().length > 0)
      .map(([id, reason]) => [id, reason.trim()]),
  );
  const missed = new Set(validatedMissedRedFlags);
  const criticalMissed = rubric.some((criterion) =>
    criterion.critical && (criterion.redFlagIds ?? []).some((id) => missed.has(id)),
  );
  const capApplied = criticalMissed ? 59 : validatedMissedRedFlags.length > 0 ? 69 : null;
  const roundedScore = Math.round(uncappedScore);
  const score = capApplied == null ? roundedScore : Math.min(roundedScore, capApplied);
  const level = score >= 85 ? 'Excellent' : score >= 70 ? 'Competent' : score >= 50 ? 'Developing' : 'Needs improvement';
  return {
    score,
    uncappedScore,
    level,
    capApplied,
    criteria,
    feedback: {
      ...evaluation,
      missed_red_flags: validatedMissedRedFlags,
      missed_red_flag_reasons: validatedMissedRedFlagReasons,
      ...(capApplied == null ? {} : {
        score_cap_reason: criticalMissed
          ? 'A critical red flag was not elicited.'
          : 'One or more safety red flags were not elicited.',
      }),
      scoring: {
        version: SCORING_VERSION,
        formula: 'sum((domain score / 3) × domain weight)',
        roundingRule: 'Final total rounded to the nearest whole point before any safety cap',
        totalWeight: 100,
        uncappedScore,
        capApplied,
      },
    },
  };
}

function assertRubricScoringContract(rubric: RubricCriterion[]): void {
  if (!rubric.length) {
    throw new AppError(500, 'INVALID_RUBRIC_CONFIGURATION', 'The assessment rubric has no criteria');
  }
  const ids = rubric.map((criterion) => criterion.id);
  const totalWeight = rubric.reduce((sum, criterion) => sum + Number(criterion.weight), 0);
  const invalidCriterion = rubric.some((criterion) =>
    !criterion.id || !Number.isFinite(criterion.weight) || criterion.weight <= 0 || (criterion.maxScore ?? 3) !== 3,
  );
  if (invalidCriterion || new Set(ids).size !== ids.length || Math.abs(totalWeight - 100) > 0.001) {
    throw new AppError(
      500,
      'INVALID_RUBRIC_CONFIGURATION',
      'The assessment rubric must contain unique domains scored 0–3 with positive weights totalling exactly 100',
    );
  }
}

function studentScreenedRedFlag(
  content: Record<string, unknown> | undefined,
  transcript: Array<{ speaker: string; content: string; status?: string }> | undefined,
  redFlagId: string,
): boolean {
  if (!content || !transcript) return false;
  const caseData = content.caseData as Record<string, unknown> | undefined;
  const facts = Array.isArray(caseData?.atomicFacts) ? caseData.atomicFacts : [];
  const factById = new Map<string, Record<string, unknown>>();
  for (const value of facts) {
    if (!value || typeof value !== 'object') continue;
    const fact = value as Record<string, unknown>;
    if (typeof fact.id === 'string') factById.set(fact.id, fact);
  }
  const redFlags = Array.isArray(caseData?.redFlags) ? caseData.redFlags : [];
  const definition = redFlags.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).id === redFlagId) as Record<string, unknown> | undefined;
  const linkedIds = Array.isArray(definition?.linkedFactIds)
    ? definition.linkedFactIds.filter((value): value is string => typeof value === 'string')
    : [redFlagId];
  const triggers = linkedIds.flatMap((id) => {
    const fact = factById.get(id);
    return Array.isArray(fact?.triggers) ? fact.triggers.filter((value): value is string => typeof value === 'string') : [];
  }).map((trigger) => trigger.trim().toLowerCase()).filter((trigger) => trigger.length >= 3);
  if (!triggers.length) return false;
  return transcript.some((turn) => turn.speaker === 'student' && turn.status !== 'failed' && turn.status !== 'pending'
    && triggers.some((trigger) => turn.content.toLowerCase().includes(trigger)));
}
