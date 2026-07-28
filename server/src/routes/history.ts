import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';
import { serializeResult } from './sessions.js';

const Query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

export function historyRoutes(db: AppDatabase): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.authenticate);
    app.get('/', async (request) => {
      const { limit } = Query.parse(request.query);
      const rows = db.prepare(`SELECT s.id,s.case_id AS caseId,c.title,c.specialty,
        CASE
          WHEN s.evaluation_status IN ('queued','running') THEN 'evaluating'
          WHEN s.evaluation_status='failed' THEN 'evaluation_failed'
          ELSE s.status
        END AS status,
        s.evaluation_status AS evaluationStatus,s.evaluation_error AS evaluationError,
        s.started_at AS startedAt,s.completed_at AS completedAt,s.duration_seconds AS durationSeconds,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id=s.id AND t.speaker='student') AS questionCount
        FROM sessions s JOIN cases c ON c.id=s.case_id
        WHERE s.user_id=? ORDER BY s.started_at DESC LIMIT ?`).all(request.user.sub, limit) as Array<Record<string, unknown>>;
      return { history: rows.map((row) => ({
        ...row,
        result: serializeResult(db, Number(row.id)),
      })) };
    });
  };
}
