import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';
import type { RubricCriterion } from '../types.js';
import { AppError, assertFound } from '../lib/errors.js';
import { nowIso, parseJson } from '../lib/json.js';
import { unknownRubricRedFlagIds } from '../domain/content-integrity.js';

const CriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  weight: z.coerce.number().positive().max(100),
  maxScore: z.coerce.number().int().refine((value) => value === 3, 'Criterion maxScore must be 3').default(3),
  critical: z.boolean().optional(),
  redFlagIds: z.array(z.string()).optional(),
}).passthrough().transform((value, context) => {
  const label = value.label ?? value.name;
  if (!label) {
    context.addIssue({ code: 'custom', message: 'Criterion label is required' });
    return z.NEVER;
  }
  return { ...value, label };
});
const RubricInputBase = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(160),
  description: z.string().max(1000).default(''),
  criteria: z.array(CriterionSchema).min(1),
});
const uniqueCriterionIds = (
  value: { criteria?: Array<{ id: string }> },
  context: z.RefinementCtx,
) => {
  if (!value.criteria) return;
  const ids = value.criteria.map((criterion) => criterion.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion IDs must be unique' });
  }
};
const RubricInput = RubricInputBase.superRefine(uniqueCriterionIds);
const RubricPatch = RubricInputBase.partial().omit({ slug: true }).superRefine(uniqueCriterionIds);
const Params = z.object({ id: z.coerce.number().int().positive() });

function faculty(request: FastifyRequest) {
  if (request.user.role !== 'faculty') throw new AppError(403, 'FORBIDDEN', 'Faculty access is required');
}

function validateWeights(criteria: RubricCriterion[]) {
  const total = criteria.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(total - 100) > 0.01) throw new AppError(400, 'INVALID_RUBRIC_WEIGHT', 'Rubric criterion weights must total 100');
}

function clientCriteria(criteria: RubricCriterion[]) {
  return criteria.map((criterion) => ({
    ...criterion,
    name: criterion.label,
    anchors: Array.isArray(criterion.anchors)
      ? criterion.anchors
      : Object.entries(criterion.anchors ?? {}).map(([score, description]) => ({
          score: Number(score), label: Number(score) === 0 ? 'Not demonstrated' : Number(score) === 3 ? 'Proficient' : 'Developing', description,
        })),
  }));
}

export function rubricRoutes(db: AppDatabase): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.authenticate);

    app.get('/', async (request) => {
      const rows = db.prepare(`SELECT * FROM rubrics ${request.user.role === 'faculty' ? '' : "WHERE status='published'"} ORDER BY id`).all() as Record<string, unknown>[];
      const rubrics = rows.map((r) => {
        const selectedVersion = request.user.role === 'faculty' ? r.current_version : r.published_version;
        const version = db.prepare('SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?').get(r.id, selectedVersion) as { criteria_json: string };
        return {
          id: r.id, slug: r.slug, name: r.name, description: r.description,
          status: r.status, version: r.current_version, publishedVersion: r.published_version, updatedAt: r.updated_at,
          criteria: clientCriteria(parseJson<RubricCriterion[]>(version.criteria_json, [])),
        };
      });
      return { rubrics, items: rubrics };
    });

    app.get('/:id', async (request) => {
      const { id } = Params.parse(request.params);
      const row = assertFound(db.prepare('SELECT * FROM rubrics WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Rubric');
      if (request.user.role !== 'faculty' && row.status !== 'published') throw new AppError(404, 'NOT_FOUND', 'Rubric not found');
      const selectedVersion = request.user.role === 'faculty' ? row.current_version : row.published_version;
      const version = assertFound(db.prepare('SELECT * FROM rubric_versions WHERE rubric_id=? AND version=?').get(id, selectedVersion) as Record<string, unknown> | undefined, 'Rubric version');
      const rubric = {
        id, slug: row.slug, name: row.name, description: row.description,
        status: row.status, version: row.current_version, publishedVersion: row.published_version,
        criteria: clientCriteria(parseJson<RubricCriterion[]>(String(version.criteria_json), [])),
      };
      return { ...rubric, rubric };
    });

    app.post('/', async (request, reply) => {
      faculty(request);
      const input = RubricInput.parse(request.body);
      validateWeights(input.criteria);
      const now = nowIso();
      let id = 0;
      db.transaction(() => {
        const result = db.prepare(`INSERT INTO rubrics (slug,name,description,status,current_version,created_at,updated_at)
          VALUES (?,?,?,'draft',1,?,?)`).run(input.slug, input.name, input.description, now, now);
        id = Number(result.lastInsertRowid);
        db.prepare('INSERT INTO rubric_versions (rubric_id,version,criteria_json,created_at) VALUES (?,1,?,?)')
          .run(id, JSON.stringify(input.criteria), now);
      })();
      reply.code(201);
      return { id, version: 1, status: 'draft' };
    });

    app.patch('/:id', async (request) => {
      faculty(request);
      const { id } = Params.parse(request.params);
      const input = RubricPatch.parse(request.body);
      if (input.criteria) validateWeights(input.criteria);
      const row = assertFound(db.prepare('SELECT * FROM rubrics WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Rubric');
      const now = nowIso();
      const version = Number(row.current_version) + (input.criteria ? 1 : 0);
      db.transaction(() => {
        db.prepare('UPDATE rubrics SET name=?,description=?,current_version=?,updated_at=? WHERE id=?')
          .run(input.name ?? row.name, input.description ?? row.description, version, now, id);
        if (input.criteria) db.prepare('INSERT INTO rubric_versions (rubric_id,version,criteria_json,created_at) VALUES (?,?,?,?)')
          .run(id, version, JSON.stringify(input.criteria), now);
      })();
      return { id, version };
    });

    app.post('/:id/publish', async (request) => {
      faculty(request);
      const { id } = Params.parse(request.params);
      const row = assertFound(db.prepare('SELECT current_version FROM rubrics WHERE id=?').get(id) as { current_version: number } | undefined, 'Rubric');
      const rubricVersion = assertFound(
        db.prepare('SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?').get(id, row.current_version) as { criteria_json: string } | undefined,
        'Rubric version',
      );
      const criteria = parseJson<RubricCriterion[]>(rubricVersion.criteria_json, []);
      const linkedPublishedCases = db.prepare(`SELECT c.title,cv.content_json AS contentJson FROM case_rubrics cr
        JOIN cases c ON c.id=cr.case_id
        JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
        WHERE cr.rubric_id=? AND c.status='published'`).all(id) as Array<{ title: string; contentJson: string }>;
      for (const linkedCase of linkedPublishedCases) {
        const unknownIds = unknownRubricRedFlagIds(criteria, parseJson<Record<string, unknown>>(linkedCase.contentJson, {}));
        if (unknownIds.length) {
          throw new AppError(
            409,
            'RUBRIC_RED_FLAG_MISMATCH',
            `This rubric cannot be published for "${linkedCase.title}" because these red-flag IDs are not in that case: ${unknownIds.join(', ')}`,
          );
        }
      }
      const now = nowIso();
      db.transaction(() => {
        db.prepare("UPDATE rubrics SET status='published',published_version=current_version,archived_at=NULL,updated_at=? WHERE id=?").run(now, id);
        db.prepare('UPDATE rubric_versions SET published_at=COALESCE(published_at,?) WHERE rubric_id=? AND version=?').run(now, id, row.current_version);
      })();
      return { id, status: 'published' };
    });

    app.post('/:id/archive', async (request) => {
      faculty(request);
      const { id } = Params.parse(request.params);
      const linkedPublishedCase = db.prepare(`SELECT c.id,c.title FROM case_rubrics cr
        JOIN cases c ON c.id=cr.case_id
        WHERE cr.rubric_id=? AND c.status='published' LIMIT 1`).get(id) as { id: number; title: string } | undefined;
      if (linkedPublishedCase) {
        throw new AppError(
          409,
          'RUBRIC_IN_USE',
          `Archive or relink the published case "${linkedPublishedCase.title}" before archiving this rubric`,
        );
      }
      const now = nowIso();
      const result = db.prepare("UPDATE rubrics SET status='archived',archived_at=?,updated_at=? WHERE id=?").run(now, now, id);
      if (!result.changes) throw new AppError(404, 'NOT_FOUND', 'Rubric not found');
      return { id, status: 'archived' };
    });
  };
}
