import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './data/database.js';
import { MockAiProvider } from './ai/provider.js';
import { redFlagLabelMap } from './routes/sessions.js';
import { AppError } from './lib/errors.js';

let app: FastifyInstance;
let db: Database.Database;

async function token(role: 'student' | 'faculty') {
  const response = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: { role } });
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}

async function waitForEvaluation(sessionId: number, headers: Record<string, string>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers });
    const result = response.json().result;
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Evaluation for session ${sessionId} did not finish`);
}

beforeEach(async () => {
  db = createDatabase(':memory:');
  app = await buildApp({
    db,
    aiProvider: new MockAiProvider(),
    logger: false,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', JWT_SECRET: 'unit-test-secret-at-least-32-characters', AI_PROVIDER: 'mock' }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('API integration', () => {
  it('maps curated and faculty-authored red-flag IDs to readable labels', () => {
    const labels = redFlagLabelMap({
      caseData: {
        atomicFacts: [{ id: 'custom.rf.01', label: 'Loss of consciousness', category: 'red_flag', value: 'Fainted once' }],
        redFlags: [{ id: 'curated.rf.group', label: 'Neurological danger symptoms' }],
      },
    });
    expect(labels.get('custom.rf.01')).toBe('Loss of consciousness');
    expect(labels.get('curated.rf.group')).toBe('Neurological danger symptoms');
  });

  it('reports health without leaking configuration', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok', aiProvider: 'mock' });
    expect(response.body).not.toContain('secret');
  });

  it('enforces role boundaries', async () => {
    const student = await token('student');
    const response = await app.inject({
      method: 'POST', url: '/api/cases', headers: { authorization: `Bearer ${student}` },
      payload: { slug: 'blocked-case', title: 'Blocked', specialty: 'Medicine', content: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it('lets faculty test an AI patient against the current case version', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const list = await app.inject({ method: 'GET', url: '/api/cases', headers });
    const caseId = list.json().cases[0].id as number;
    const response = await app.inject({
      method: 'POST', url: `/api/cases/${caseId}/preview/respond`, headers,
      payload: { message: 'When did it start?' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ model: 'simclin-mock-v1' });
    expect(response.json().text).toEqual(expect.any(String));
    expect(response.json().permittedFacts.length).toBeGreaterThan(0);
  });

  it('persists structured disclosure controls for faculty-authored cases', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const created = await app.inject({
      method: 'POST', url: '/api/cases', headers,
      payload: {
        slug: 'structured-controls-case', title: 'Structured controls case', specialty: 'Medicine',
        content: {
          patient: { name: 'Alex Morgan', age: 40 },
          openingStatement: 'I have had a symptom since yesterday.',
          caseData: {
            candidateInstructions: ['Take a focused history.'],
            patientActorRules: ['Do not volunteer facts until asked.'],
            unknownPolicy: { rule: 'Say you do not know.', defaultPhrases: ['I am not sure.'] },
            atomicFacts: [{ id: 'case.fact.01', label: 'Onset', value: 'It began yesterday.', disclosureLevel: 'direct_question', triggers: ['when did it start'] }],
            redFlags: [{ id: 'case.rf.01', label: 'Time-critical symptom', linkedFactIds: ['case.fact.01'], critical: true, requiredQuestions: ['onset'] }],
          },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const detail = await app.inject({ method: 'GET', url: `/api/cases/${created.json().id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().case.content.caseData.redFlags[0]).toMatchObject({ id: 'case.rf.01', linkedFactIds: ['case.fact.01'], critical: true });
    expect(detail.json().case.content.caseData.atomicFacts[0].triggers).toEqual(['when did it start']);
  });

  it('runs a complete student history-taking and faculty override loop', async () => {
    const student = await token('student');
    const faculty = await token('faculty');
    const auth = { authorization: `Bearer ${student}` };
    const casesResponse = await app.inject({ method: 'GET', url: '/api/cases', headers: auth });
    expect(casesResponse.statusCode).toBe(200);
    const caseId = casesResponse.json().cases[0].id as number;

    const start = await app.inject({ method: 'POST', url: '/api/sessions', headers: auth, payload: { caseId } });
    expect(start.statusCode).toBe(201);
    const sessionId = start.json().session.id as number;

    const message = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/messages`,
      headers: { ...auth, origin: 'http://localhost:5173' },
      payload: { message: 'Could you tell me more about what brought you in today?' },
    });
    expect(message.statusCode).toBe(200);
    expect(message.headers['content-type']).toContain('text/event-stream');
    expect(message.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(message.body).toContain('event: delta');
    expect(message.body).toContain('event: complete');

    const complete = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, headers: auth });
    expect(complete.statusCode).toBe(202);
    expect(complete.json()).toMatchObject({ status: 'evaluating', sessionId: String(sessionId) });
    const result = await waitForEvaluation(sessionId, auth);
    expect(result.score).toBeGreaterThan(0);
    expect(result.criteria.length).toBeGreaterThan(0);
    expect(result.transcript.every((turn: { createdAt?: string }) => typeof turn.createdAt === 'string')).toBe(true);
    expect(result.criteria.every((criterion: { evidenceStatus: string }) => criterion.evidenceStatus === 'covered')).toBe(true);
    expect(result.criteria.every((criterion: { feedback: string }) => !/\bturn\s+\d+\b/i.test(criterion.feedback))).toBe(true);
    const repeatedComplete = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, headers: auth });
    expect(repeatedComplete.json().resultId).toBe(String(result.id));

    const override = await app.inject({
      method: 'POST', url: `/api/results/${result.id}/override`,
      headers: { authorization: `Bearer ${faculty}` }, payload: { score: 78, reason: 'Faculty review against transcript evidence.' },
    });
    expect(override.statusCode).toBe(200);
    expect(override.json().result).toMatchObject({ score: 78, overridden: true });

    const insights = await app.inject({ method: 'GET', url: '/api/insights', headers: { authorization: `Bearer ${faculty}` } });
    expect(insights.statusCode).toBe(200);
    expect(insights.json().summary.completedSessions).toBe(1);
    expect(insights.json().domainScores[0].name).not.toMatch(/_/);
    expect(insights.json().aiQuality).toMatchObject({ totalRuns: 3, successfulRuns: 3, failedRuns: 0, successRate: 100 });
    const facultyCases = await app.inject({ method: 'GET', url: '/api/cases', headers: { authorization: `Bearer ${faculty}` } });
    expect(facultyCases.json().items.find((item: { id: number }) => item.id === caseId).attempts).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS count FROM model_runs').get() as { count: number }).count).toBe(3);
    expect((db.prepare('SELECT DISTINCT provider FROM model_runs').all() as Array<{ provider: string }>).map((row) => row.provider)).toEqual(['mock']);
    expect((db.prepare('SELECT purpose,prompt_version AS promptVersion FROM model_runs ORDER BY id').all() as Array<{ purpose: string; promptVersion: string }>).map((row) => `${row.purpose}:${row.promptVersion}`)).toEqual([
      'disclosure-planner:planner-v3', 'patient-actor:actor-v3', 'evaluator:evaluator-v4',
    ]);
  });

  it('automatically retries one transient evaluator failure and audits both attempts', async () => {
    await app.close();
    db.close();
    let evaluatorAttempts = 0;
    class FlakyEvaluatorProvider extends MockAiProvider {
      override async evaluate(input: Parameters<MockAiProvider['evaluate']>[0]) {
        evaluatorAttempts += 1;
        if (evaluatorAttempts === 1) throw new AppError(504, 'AI_TIMEOUT', 'Synthetic transient timeout');
        return super.evaluate(input);
      }
    }
    db = createDatabase(':memory:');
    app = await buildApp({
      db,
      aiProvider: new FlakyEvaluatorProvider(),
      logger: false,
      config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', JWT_SECRET: 'unit-test-secret-at-least-32-characters', AI_PROVIDER: 'mock' }),
    });
    await app.ready();
    const student = await token('student');
    const headers = { authorization: `Bearer ${student}` };
    const cases = await app.inject({ method: 'GET', url: '/api/cases', headers });
    const started = await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { caseId: cases.json().cases[0].id } });
    const sessionId = started.json().session.id as number;
    await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/messages`, headers,
      payload: { message: 'When did the chest discomfort start?' },
    });
    const queued = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, headers });
    expect(queued.statusCode).toBe(202);
    const result = await waitForEvaluation(sessionId, headers);
    expect(result).toBeTruthy();
    expect(evaluatorAttempts).toBe(2);
    expect(db.prepare("SELECT status,error_code AS errorCode FROM model_runs WHERE purpose='evaluator' ORDER BY id").all())
      .toEqual([
        { status: 'error', errorCode: 'AI_TIMEOUT' },
        { status: 'success', errorCode: null },
      ]);
  });

  it('marks failed turns and prevents runaway question counts', async () => {
    const student = await token('student');
    const headers = { authorization: `Bearer ${student}` };
    const list = await app.inject({ method: 'GET', url: '/api/cases', headers });
    const start = await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { caseId: list.json().cases[0].id } });
    const sessionId = start.json().session.id as number;
    for (let index = 0; index < 30; index += 1) {
      const response = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/messages`, headers, payload: { message: `Question ${index + 1}` } });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/messages`, headers, payload: { message: 'One more question' } });
    expect(limited.statusCode).toBe(409);
    expect(limited.json().error.code).toBe('SESSION_LIMIT_REACHED');
    const statuses = db.prepare("SELECT status,COUNT(*) AS count FROM turns WHERE session_id=? GROUP BY status").all(sessionId) as Array<{ status: string; count: number }>;
    expect(statuses.find((row) => row.status === 'pending')).toBeUndefined();
  });

  it('keeps the published case version stable until faculty explicitly republishes', async () => {
    const student = await token('student');
    const faculty = await token('faculty');
    const studentHeaders = { authorization: `Bearer ${student}` };
    const facultyHeaders = { authorization: `Bearer ${faculty}` };
    const list = await app.inject({ method: 'GET', url: '/api/cases', headers: studentHeaders });
    const caseId = list.json().cases[0].id as number;
    const before = await app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: studentHeaders });
    const originalOpening = before.json().case.content.openingStatement;
    const editedOpening = 'This is a new unpublished actor opening.';
    const edit = await app.inject({
      method: 'PATCH', url: `/api/cases/${caseId}`, headers: facultyHeaders,
      payload: { content: { ...before.json().case.content, openingStatement: editedOpening } },
    });
    expect(edit.statusCode).toBe(200);
    const stillPublished = await app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: studentHeaders });
    expect(stillPublished.json().case.content.openingStatement).toBe(originalOpening);
    await app.inject({ method: 'POST', url: `/api/cases/${caseId}/publish`, headers: facultyHeaders });
    const republished = await app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: studentHeaders });
    expect(republished.json().case.content.openingStatement).toBe(editedOpening);
  });

  it('does not evaluate an empty consultation', async () => {
    const student = await token('student');
    const headers = { authorization: `Bearer ${student}` };
    const list = await app.inject({ method: 'GET', url: '/api/cases', headers });
    const start = await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { caseId: list.json().cases[0].id } });
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${start.json().session.id}/complete`, headers });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('EMPTY_SESSION');
  });

  it('validates rubric weights before persistence', async () => {
    const faculty = await token('faculty');
    const response = await app.inject({
      method: 'POST', url: '/api/rubrics', headers: { authorization: `Bearer ${faculty}` },
      payload: { slug: 'bad-rubric', name: 'Bad rubric', criteria: [{ id: 'one', label: 'One', weight: 70 }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_RUBRIC_WEIGHT');
  });

  it('does not publish an incomplete case without a published rubric and structured facts', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const created = await app.inject({
      method: 'POST', url: '/api/cases', headers,
      payload: {
        slug: 'incomplete-case', title: 'Incomplete case', specialty: 'Medicine',
        content: { openingStatement: '', caseData: { atomicFacts: [] } },
      },
    });
    expect(created.statusCode).toBe(201);
    const published = await app.inject({
      method: 'POST', url: `/api/cases/${created.json().id}/publish`, headers,
    });
    expect(published.statusCode).toBe(409);
    expect(published.json().error.code).toBe('PUBLISHED_RUBRIC_REQUIRED');

    const rubrics = await app.inject({ method: 'GET', url: '/api/rubrics', headers });
    const createdWithRubric = await app.inject({
      method: 'POST', url: '/api/cases', headers,
      payload: {
        slug: 'empty-structured-case', title: 'Empty structured case', specialty: 'Medicine',
        rubricId: rubrics.json().items[0].id,
        content: { openingStatement: '', caseData: { atomicFacts: [] } },
      },
    });
    const contentRejected = await app.inject({
      method: 'POST', url: `/api/cases/${createdWithRubric.json().id}/publish`, headers,
    });
    expect(contentRejected.statusCode).toBe(409);
    expect(contentRejected.json().error.code).toBe('CASE_CONTENT_INCOMPLETE');
  });

  it('does not archive a rubric that is linked to a published case', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const rubrics = await app.inject({ method: 'GET', url: '/api/rubrics', headers });
    const response = await app.inject({
      method: 'POST', url: `/api/rubrics/${rubrics.json().items[0].id}/archive`, headers,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RUBRIC_IN_USE');
  });

  it('rejects publishing when a rubric contains a mistyped case red-flag ID', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const rubric = await app.inject({
      method: 'POST', url: '/api/rubrics', headers,
      payload: {
        slug: 'mismatched-safety-rubric', name: 'Mismatched safety rubric',
        criteria: [{
          id: 'safety', label: 'Safety', weight: 100, critical: true,
          redFlagIds: ['typo.rf.id'],
        }],
      },
    });
    await app.inject({ method: 'POST', url: `/api/rubrics/${rubric.json().id}/publish`, headers });
    const clinicalCase = await app.inject({
      method: 'POST', url: '/api/cases', headers,
      payload: {
        slug: 'red-flag-mismatch-case', title: 'Red flag mismatch case', specialty: 'Medicine',
        rubricId: rubric.json().id,
        content: {
          patient: { name: 'Taylor Morgan', age: 45 },
          openingStatement: 'I have come in because I briefly lost consciousness.',
          caseData: { atomicFacts: [{ id: 'actual.rf.id', label: 'Syncope', value: 'Fainted once' }] },
        },
      },
    });
    const publish = await app.inject({
      method: 'POST', url: `/api/cases/${clinicalCase.json().id}/publish`, headers,
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.json().error.code).toBe('RUBRIC_RED_FLAG_MISMATCH');
  });

  it('does not publish a new rubric version that breaks an already-published linked case', async () => {
    const faculty = await token('faculty');
    const headers = { authorization: `Bearer ${faculty}` };
    const list = await app.inject({ method: 'GET', url: '/api/rubrics', headers });
    const rubric = list.json().items[0];
    rubric.criteria[0].redFlagIds = ['mistyped.after.case.publish'];
    const updated = await app.inject({
      method: 'PATCH', url: `/api/rubrics/${rubric.id}`, headers,
      payload: { name: rubric.name, description: rubric.description, criteria: rubric.criteria },
    });
    expect(updated.statusCode).toBe(200);
    const published = await app.inject({
      method: 'POST', url: `/api/rubrics/${rubric.id}/publish`, headers,
    });
    expect(published.statusCode).toBe(409);
    expect(published.json().error.code).toBe('RUBRIC_RED_FLAG_MISMATCH');
  });
});
