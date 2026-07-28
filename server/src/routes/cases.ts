import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';
import type { AiProvider, TranscriptTurn } from '../ai/provider.js';
import { collectPermittedFacts, validatePatientReply } from '../ai/provider.js';
import type { RubricCriterion } from '../types.js';
import { unknownRubricRedFlagIds } from '../domain/content-integrity.js';
import { AppError, assertFound } from '../lib/errors.js';
import { nowIso, parseJson } from '../lib/json.js';

const CaseInput = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(160),
  specialty: z.string().min(2).max(100),
  setting: z.string().max(120).default(''),
  summary: z.string().max(1000).default(''),
  difficulty: z.string().max(60).default('Intermediate'),
  estimatedMinutes: z.coerce.number().int().min(3).max(60).default(12),
  content: z.record(z.string(), z.unknown()),
  rubricId: z.coerce.number().int().positive().optional(),
});
const CasePatch = CaseInput.partial().omit({ slug: true });
const IdParams = z.object({ id: z.coerce.number().int().positive() });
const PreviewMessage = z.object({ message: z.string().trim().min(1).max(2000) });

function mapCase(row: Record<string, unknown>) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    specialty: row.specialty,
    setting: row.setting,
    summary: row.summary,
    difficulty: row.difficulty,
    estimatedMinutes: row.estimated_minutes,
    durationMinutes: row.estimated_minutes,
    subtitle: row.summary,
    status: row.status,
    version: row.current_version,
    publishedVersion: row.published_version,
    attempts: Number(row.attempts ?? 0),
    updatedAt: row.updated_at,
  };
}

function requireFaculty(request: FastifyRequest) {
  if (request.user.role !== 'faculty') throw new AppError(403, 'FORBIDDEN', 'Faculty access is required');
}

function validatePublishableCase(db: AppDatabase, caseId: number, version: number) {
  const linkedRubric = db.prepare(`SELECT r.id,r.published_version AS publishedVersion FROM case_rubrics cr
    JOIN rubrics r ON r.id=cr.rubric_id
    WHERE cr.case_id=? AND r.status='published' AND r.published_version IS NOT NULL`).get(caseId) as {
      id: number; publishedVersion: number;
    } | undefined;
  if (!linkedRubric) {
    throw new AppError(409, 'PUBLISHED_RUBRIC_REQUIRED', 'Link a published rubric before publishing this case');
  }

  const versionRow = assertFound(
    db.prepare('SELECT content_json FROM case_versions WHERE case_id=? AND version=?').get(caseId, version) as { content_json: string } | undefined,
    'Case version',
  );
  const content = parseJson<Record<string, unknown>>(versionRow.content_json, {});
  const openingStatement = content.openingStatement ?? content.opening_statement;
  const patient = content.patient as Record<string, unknown> | undefined;
  const hasPatientIdentity = typeof patient?.name === 'string' && patient.name.trim().length > 0
    && typeof patient.age === 'number' && Number.isFinite(patient.age) && patient.age > 0;
  const caseData = content.caseData as Record<string, unknown> | undefined;
  const facts = caseData?.atomicFacts;
  const hasUsableFact = Array.isArray(facts) && facts.some((fact) => {
    if (!fact || typeof fact !== 'object') return false;
    const record = fact as Record<string, unknown>;
    return typeof record.id === 'string' && record.id.trim().length > 0
      && typeof record.label === 'string' && record.label.trim().length > 0
      && typeof record.value === 'string' && record.value.trim().length > 0;
  });
  if (typeof openingStatement !== 'string' || !openingStatement.trim() || !hasPatientIdentity || !hasUsableFact) {
    throw new AppError(
      409,
      'CASE_CONTENT_INCOMPLETE',
      'Add the patient identity, an opening statement and at least one structured patient fact before publishing this case',
    );
  }

  const rubricVersion = assertFound(
    db.prepare('SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?')
      .get(linkedRubric.id, linkedRubric.publishedVersion) as { criteria_json: string } | undefined,
    'Published rubric version',
  );
  const criteria = parseJson<RubricCriterion[]>(rubricVersion.criteria_json, []);
  const unknownRedFlagIds = unknownRubricRedFlagIds(criteria, content);
  if (unknownRedFlagIds.length) {
    throw new AppError(
      409,
      'RUBRIC_RED_FLAG_MISMATCH',
      `The linked rubric references red-flag IDs that are not in this case: ${unknownRedFlagIds.join(', ')}`,
    );
  }
}

export function caseRoutes(db: AppDatabase, provider?: AiProvider): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.authenticate);

    app.get('/', async (request) => {
      const rows = db.prepare(`SELECT c.*,
        (SELECT COUNT(*) FROM sessions s WHERE s.case_id=c.id) AS attempts
        FROM cases c ${request.user.role === 'faculty' ? '' : "WHERE c.status='published'"} ORDER BY c.id`).all() as Record<string, unknown>[];
      const cases = rows.map(mapCase);
      return { cases, items: cases };
    });

    app.get('/:id', async (request) => {
      const { id } = IdParams.parse(request.params);
      const row = assertFound(db.prepare('SELECT * FROM cases WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Case');
      if (request.user.role !== 'faculty' && row.status !== 'published') throw new AppError(404, 'NOT_FOUND', 'Case not found');
      const selectedVersion = request.user.role === 'faculty' ? row.current_version : row.published_version;
      const version = assertFound(db.prepare('SELECT * FROM case_versions WHERE case_id=? AND version=?').get(id, selectedVersion) as Record<string, unknown> | undefined, 'Case version');
      const rubric = db.prepare(`SELECT r.id,r.slug,r.name FROM case_rubrics cr JOIN rubrics r ON r.id=cr.rubric_id WHERE cr.case_id=?`).get(id);
      const content = parseJson<Record<string, unknown>>(String(version.content_json), {});
      const detail = {
        ...mapCase(row), content, caseData: content.caseData ?? content,
        patientName: (content.patient as Record<string, unknown> | undefined)?.name,
        patientAge: (content.patient as Record<string, unknown> | undefined)?.age,
        task: (content.caseData as Record<string, unknown> | undefined)?.candidateInstructions ?? '',
        learningObjectives: (content.caseData as Record<string, unknown> | undefined)?.learningObjectives ?? [],
        rubric,
      };
      return { ...detail, case: detail };
    });

    app.post('/', async (request, reply) => {
      requireFaculty(request);
      const input = CaseInput.parse(request.body);
      const now = nowIso();
      let id = 0;
      db.transaction(() => {
        const result = db.prepare(`INSERT INTO cases
          (slug,title,specialty,setting,summary,difficulty,estimated_minutes,status,current_version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'draft',1,?,?)`).run(
          input.slug, input.title, input.specialty, input.setting, input.summary, input.difficulty, input.estimatedMinutes, now, now,
        );
        id = Number(result.lastInsertRowid);
        db.prepare('INSERT INTO case_versions (case_id,version,content_json,created_at) VALUES (?,1,?,?)')
          .run(id, JSON.stringify({ ...input.content, slug: input.slug, title: input.title }), now);
        if (input.rubricId) db.prepare('INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)').run(id, input.rubricId);
      })();
      reply.code(201);
      return { id, version: 1, status: 'draft' };
    });

    app.patch('/:id', async (request) => {
      requireFaculty(request);
      const { id } = IdParams.parse(request.params);
      const input = CasePatch.parse(request.body);
      const row = assertFound(db.prepare('SELECT * FROM cases WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Case');
      const now = nowIso();
      const nextVersion = Number(row.current_version) + (input.content ? 1 : 0);
      db.transaction(() => {
        db.prepare(`UPDATE cases SET title=?,specialty=?,setting=?,summary=?,difficulty=?,estimated_minutes=?,current_version=?,updated_at=? WHERE id=?`).run(
          input.title ?? row.title, input.specialty ?? row.specialty, input.setting ?? row.setting,
          input.summary ?? row.summary, input.difficulty ?? row.difficulty,
          input.estimatedMinutes ?? row.estimated_minutes, nextVersion, now, id,
        );
        if (input.content) {
          db.prepare('INSERT INTO case_versions (case_id,version,content_json,created_at) VALUES (?,?,?,?)')
            .run(id, nextVersion, JSON.stringify({ ...input.content, slug: row.slug, title: input.title ?? row.title }), now);
        }
        if (input.rubricId) db.prepare(`INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)
          ON CONFLICT(case_id) DO UPDATE SET rubric_id=excluded.rubric_id`).run(id, input.rubricId);
      })();
      return { id, version: nextVersion };
    });

    app.post('/:id/publish', async (request) => {
      requireFaculty(request);
      const { id } = IdParams.parse(request.params);
      const row = assertFound(db.prepare('SELECT current_version FROM cases WHERE id=?').get(id) as { current_version: number } | undefined, 'Case');
      validatePublishableCase(db, id, row.current_version);
      const now = nowIso();
      db.transaction(() => {
        db.prepare("UPDATE cases SET status='published',published_version=current_version,archived_at=NULL,updated_at=? WHERE id=?").run(now, id);
        db.prepare('UPDATE case_versions SET published_at=COALESCE(published_at,?) WHERE case_id=? AND version=?').run(now, id, row.current_version);
      })();
      return { id, status: 'published' };
    });

    app.post('/:id/archive', async (request) => {
      requireFaculty(request);
      const { id } = IdParams.parse(request.params);
      const now = nowIso();
      const result = db.prepare("UPDATE cases SET status='archived',archived_at=?,updated_at=? WHERE id=?").run(now, now, id);
      if (!result.changes) throw new AppError(404, 'NOT_FOUND', 'Case not found');
      return { id, status: 'archived' };
    });

    app.post('/:id/preview', async (request) => {
      requireFaculty(request);
      const { id } = IdParams.parse(request.params);
      const row = assertFound(db.prepare('SELECT * FROM cases WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Case');
      return { ...mapCase(row), preview: true };
    });

    app.post('/:id/preview/respond', async (request) => {
      requireFaculty(request);
      if (!provider) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI preview is not available');
      const { id } = IdParams.parse(request.params);
      const { message } = PreviewMessage.parse(request.body);
      const row = assertFound(db.prepare('SELECT * FROM cases WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Case');
      const version = assertFound(
        db.prepare('SELECT content_json FROM case_versions WHERE case_id=? AND version=?').get(id, row.current_version) as { content_json: string } | undefined,
        'Case version',
      );
      const content = parseJson<Record<string, unknown>>(version.content_json, {});
      const opening = typeof content.openingStatement === 'string' ? content.openingStatement : 'Hello. I was told you would like to ask me some questions.';
      const transcript: TranscriptTurn[] = [{ id: 0, sequence: 1, speaker: 'patient', content: opening, status: 'completed' }];
      const planner = await provider.planDisclosure({ sessionId: 0, caseContent: content, transcript, studentMessage: message });
      const permittedFacts = collectPermittedFacts(content, planner.disclosedFactIds);
      const permittedFactIds = permittedFacts.flatMap((fact) => {
        if (!fact || typeof fact !== 'object') return [];
        const record = fact as Record<string, unknown>;
        return typeof record.id === 'string' ? [record.id] : [];
      });
      let text = '';
      for await (const chunk of provider.streamPatientReply({
        sessionId: 0, caseContent: content, transcript, studentMessage: message,
        disclosedFactIds: permittedFactIds, permittedFacts, questionStyle: planner.questionStyle,
      })) text += chunk;
      if (!text.trim()) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'Patient actor returned an empty response');
      validatePatientReply(text.trim(), content, permittedFactIds);
      return { text: text.trim(), disclosedFactIds: permittedFactIds, permittedFacts, model: planner.meta.model };
    });

    app.post('/:id/duplicate', async (request, reply) => {
      requireFaculty(request);
      const { id } = IdParams.parse(request.params);
      const row = assertFound(db.prepare('SELECT * FROM cases WHERE id=?').get(id) as Record<string, unknown> | undefined, 'Case');
      const version = assertFound(db.prepare('SELECT content_json FROM case_versions WHERE case_id=? AND version=?').get(id, row.current_version) as { content_json: string } | undefined, 'Case version');
      const link = db.prepare('SELECT rubric_id FROM case_rubrics WHERE case_id=?').get(id) as { rubric_id: number } | undefined;
      const now = nowIso();
      const suffix = Date.now().toString(36);
      let duplicateId = 0;
      db.transaction(() => {
        const result = db.prepare(`INSERT INTO cases
          (slug,title,specialty,setting,summary,difficulty,estimated_minutes,status,current_version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'draft',1,?,?)`).run(
          `${row.slug}-copy-${suffix}`, `${row.title} (copy)`, row.specialty, row.setting, row.summary,
          row.difficulty, row.estimated_minutes, now, now,
        );
        duplicateId = Number(result.lastInsertRowid);
        db.prepare('INSERT INTO case_versions (case_id,version,content_json,created_at) VALUES (?,1,?,?)')
          .run(duplicateId, version.content_json, now);
        if (link) db.prepare('INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)').run(duplicateId, link.rubric_id);
      })();
      reply.code(201);
      const duplicate = db.prepare('SELECT * FROM cases WHERE id=?').get(duplicateId) as Record<string, unknown>;
      return mapCase(duplicate);
    });
  };
}
