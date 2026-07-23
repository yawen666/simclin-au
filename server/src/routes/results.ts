import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';
import { AppError, assertFound } from '../lib/errors.js';
import { nowIso, parseJson } from '../lib/json.js';
import { redFlagLabelMap, serializeResult } from './sessions.js';

const Params = z.object({ id: z.coerce.number().int().positive() });
const Query = z.object({ caseId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const Override = z.object({
  score: z.coerce.number().min(0).max(100),
  reason: z.string().optional(),
  comment: z.string().optional(),
}).transform((value, context) => {
  const reason = (value.reason ?? value.comment ?? '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    context.addIssue({ code: 'custom', message: 'A review reason of 5 to 1000 characters is required' });
    return z.NEVER;
  }
  return { score: value.score, reason };
});

function evaluationFor(db: AppDatabase, id: number) {
  return db.prepare('SELECT id,session_id,score FROM evaluations WHERE id=?').get(id) as { id: number; session_id: number; score: number } | undefined;
}

export function resultRoutes(db: AppDatabase): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.authenticate);

    const listResults = async (request: FastifyRequest) => {
      const query = Query.parse(request.query);
      const conditions = ['s.status=\'completed\''];
      const args: unknown[] = [];
      if (request.user.role === 'student') {
        conditions.push('s.user_id=?');
        args.push(request.user.sub);
      }
      if (query.caseId) {
        conditions.push('s.case_id=?');
        args.push(query.caseId);
      }
      args.push(query.limit);
      const rows = db.prepare(`SELECT s.id FROM sessions s WHERE ${conditions.join(' AND ')} ORDER BY s.completed_at DESC LIMIT ?`).all(...args) as Array<{ id: number }>;
      const results = rows.map((row) => serializeResult(db, row.id)).filter(Boolean);
      return { results, items: results };
    };
    app.get('/', listResults);

    app.get('/:id', async (request) => {
      const { id } = Params.parse(request.params);
      const evaluation = assertFound(evaluationFor(db, id), 'Result');
      const session = db.prepare('SELECT user_id FROM sessions WHERE id=?').get(evaluation.session_id) as { user_id: number };
      if (request.user.role !== 'faculty' && session.user_id !== request.user.sub) throw new AppError(403, 'FORBIDDEN', 'This result is not available');
      const turns = db.prepare('SELECT id,sequence,speaker,content,created_at AS createdAt FROM turns WHERE session_id=? ORDER BY sequence').all(evaluation.session_id);
      const result = assertFound(serializeResult(db, evaluation.session_id), 'Result');
      return { ...result, result, turns };
    });

    const override = async (request: FastifyRequest) => {
      if (request.user.role !== 'faculty') throw new AppError(403, 'FORBIDDEN', 'Faculty access is required');
      const { id } = Params.parse(request.params);
      const input = Override.parse(request.body);
      const evaluation = assertFound(evaluationFor(db, id), 'Result');
      const prior = db.prepare('SELECT override_score FROM teacher_overrides WHERE evaluation_id=? ORDER BY id DESC LIMIT 1').get(id) as { override_score: number } | undefined;
      db.prepare(`INSERT INTO teacher_overrides
        (evaluation_id,faculty_user_id,previous_score,override_score,reason,created_at) VALUES (?,?,?,?,?,?)`)
        .run(id, request.user.sub, prior?.override_score ?? evaluation.score, input.score, input.reason, nowIso());
      const result = assertFound(serializeResult(db, evaluation.session_id), 'Result');
      return { ...result, result };
    };
    app.post('/:id/override', override);
    app.patch('/:id/override', override);
  };
}

export function insightRoutes(db: AppDatabase): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.requireRole('faculty'));
    app.get('/', async () => {
      const summary = db.prepare(`SELECT
        COUNT(*) AS completedSessions,
        ROUND(AVG(COALESCE((SELECT override_score FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score)),1) AS averageScore,
        ROUND(AVG(s.duration_seconds),0) AS averageDurationSeconds
        FROM evaluations e JOIN sessions s ON s.id=e.session_id`).get() as Record<string, unknown>;
      const byCase = db.prepare(`SELECT c.id AS caseId,c.title,c.specialty,COUNT(*) AS attempts,
        ROUND(AVG(COALESCE((SELECT override_score FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score)),1) AS averageScore
        FROM evaluations e JOIN sessions s ON s.id=e.session_id JOIN cases c ON c.id=s.case_id
        GROUP BY c.id ORDER BY c.id`).all();
      const domainRows = db.prepare(`SELECT cs.criterion_id AS criterionId,cs.score,rv.criteria_json AS criteriaJson
        FROM criterion_scores cs JOIN evaluations e ON e.id=cs.evaluation_id
        JOIN sessions s ON s.id=e.session_id JOIN rubric_versions rv ON rv.id=s.rubric_version_id`).all() as Array<{
          criterionId: string; score: number; criteriaJson: string;
        }>;
      const domainAccumulator = new Map<string, { criterionId: string; label: string; total: number; count: number }>();
      for (const row of domainRows) {
        const rubric = parseJson<Array<{ id?: string; label?: string; name?: string }>>(row.criteriaJson, []);
        const definition = rubric.find((criterion) => criterion.id === row.criterionId);
        const current = domainAccumulator.get(row.criterionId) ?? {
          criterionId: row.criterionId,
          label: definition?.label ?? definition?.name ?? row.criterionId,
          total: 0,
          count: 0,
        };
        current.total += Number(row.score);
        current.count += 1;
        domainAccumulator.set(row.criterionId, current);
      }
      const domains = [...domainAccumulator.values()]
        .map((item) => ({
          criterionId: item.criterionId,
          label: item.label,
          averageScore: Math.round((item.total / item.count) * 100) / 100,
          assessments: item.count,
        }))
        .sort((a, b) => a.averageScore - b.averageScore);
      const levelDistribution = db.prepare('SELECT level,COUNT(*) AS count FROM evaluations GROUP BY level ORDER BY count DESC').all();
      const attemptSummary = db.prepare(`SELECT COUNT(*) AS totalAttempts,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM sessions`).get() as { totalAttempts: number; completed: number };
      const published = db.prepare("SELECT COUNT(*) AS count FROM cases WHERE status='published'").get() as { count: number };
      const scoreRows = db.prepare(`SELECT COALESCE((SELECT override_score FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score) AS score
        FROM evaluations e ORDER BY score`).all() as Array<{ score: number }>;
      const sortedScores = scoreRows.map((item) => Number(item.score));
      const middle = Math.floor(sortedScores.length / 2);
      const medianScore = sortedScores.length === 0 ? 0 : sortedScores.length % 2
        ? sortedScores[middle]!
        : Math.round((sortedScores[middle - 1]! + sortedScores[middle]!) / 2);
      const scoreDistribution = [
        { label: '0–49', value: sortedScores.filter((s) => s < 50).length },
        { label: '50–69', value: sortedScores.filter((s) => s >= 50 && s < 70).length },
        { label: '70–84', value: sortedScores.filter((s) => s >= 70 && s < 85).length },
        { label: '85–100', value: sortedScores.filter((s) => s >= 85).length },
      ];
      const domainScores = domains.map((item) => ({
        id: item.criterionId,
        name: item.label,
        value: Math.round((Number(item.averageScore) / 3) * 100),
      }));
      const missedCounts = new Map<string, { label: string; count: number }>();
      const feedbackRows = db.prepare(`SELECT e.feedback_json,cv.content_json FROM evaluations e
        JOIN sessions s ON s.id=e.session_id JOIN case_versions cv ON cv.id=s.case_version_id`).all() as Array<{
          feedback_json: string; content_json: string;
        }>;
      for (const row of feedbackRows) {
        try {
          const missed = (JSON.parse(row.feedback_json) as { missed_red_flags?: string[] }).missed_red_flags ?? [];
          const labels = redFlagLabelMap(parseJson<Record<string, unknown>>(row.content_json, {}));
          for (const id of missed) {
            const current = missedCounts.get(id) ?? { label: labels.get(id) ?? id, count: 0 };
            current.count += 1;
            missedCounts.set(id, current);
          }
        } catch { /* Corrupt historical feedback is ignored in aggregate analytics. */ }
      }
      const commonMisses = [...missedCounts].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.count - a.count);
      const recentSessions = db.prepare("SELECT id FROM sessions WHERE status='completed' ORDER BY completed_at DESC LIMIT 5").all() as Array<{ id: number }>;
      const recentResults = recentSessions.map((item) => serializeResult(db, item.id)).filter(Boolean);
      const modelSummary = db.prepare(`SELECT COUNT(*) AS totalRuns,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successfulRuns,
        SUM(CASE WHEN status!='success' THEN 1 ELSE 0 END) AS failedRuns,
        ROUND(AVG(latency_ms),0) AS averageLatencyMs,
        COALESCE(SUM(input_tokens),0) AS inputTokens,
        COALESCE(SUM(output_tokens),0) AS outputTokens
        FROM model_runs`).get() as Record<string, unknown>;
      const modelByPurpose = db.prepare(`SELECT purpose,COUNT(*) AS total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successful,
        ROUND(AVG(latency_ms),0) AS averageLatencyMs
        FROM model_runs GROUP BY purpose ORDER BY purpose`).all();
      const recentModelRuns = db.prepare(`SELECT provider,model,purpose,prompt_version AS promptVersion,
        latency_ms AS latencyMs,status,error_code AS errorCode,created_at AS createdAt
        FROM model_runs ORDER BY created_at DESC LIMIT 12`).all();
      const totalRuns = Number(modelSummary.totalRuns ?? 0);
      return {
        summary, byCase, domains, levelDistribution,
        stats: {
          publishedCases: published.count,
          totalAttempts: attemptSummary.totalAttempts,
          completionRate: attemptSummary.totalAttempts ? Math.round((attemptSummary.completed / attemptSummary.totalAttempts) * 100) : 0,
          medianScore,
        },
        scoreDistribution, domainScores, commonMisses, recentResults,
        aiQuality: {
          totalRuns,
          successfulRuns: Number(modelSummary.successfulRuns ?? 0),
          failedRuns: Number(modelSummary.failedRuns ?? 0),
          successRate: totalRuns ? Math.round((Number(modelSummary.successfulRuns ?? 0) / totalRuns) * 100) : 0,
          averageLatencyMs: Number(modelSummary.averageLatencyMs ?? 0),
          inputTokens: Number(modelSummary.inputTokens ?? 0),
          outputTokens: Number(modelSummary.outputTokens ?? 0),
          byPurpose: modelByPurpose,
          recentRuns: recentModelRuns,
        },
      };
    });
  };
}
