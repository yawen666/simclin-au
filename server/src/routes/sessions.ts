import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';
import type { AiProvider, TranscriptTurn } from '../ai/provider.js';
import { collectPermittedFacts, validatePatientReply } from '../ai/provider.js';
import { calculateScore } from '../domain/scoring.js';
import type { ModelRunRecord, RubricCriterion } from '../types.js';
import { AppError, assertFound } from '../lib/errors.js';
import { nowIso, parseJson } from '../lib/json.js';
import { PROMPT_VERSIONS } from '../ai/prompts.js';

const StartSchema = z.object({ caseId: z.coerce.number().int().positive() });
const MessageSchema = z.object({
  message: z.string().optional(),
  content: z.string().optional(),
}).transform((value, context) => {
  const message = (value.message ?? value.content ?? '').trim();
  if (!message || message.length > 2000) {
    context.addIssue({ code: 'custom', message: 'Message must contain 1 to 2000 characters' });
    return z.NEVER;
  }
  return { message };
});
const Params = z.object({ id: z.coerce.number().int().positive() });
const MAX_QUESTIONS_PER_SESSION = 30;

function recordModelRun(db: AppDatabase, run: ModelRunRecord): number {
  const result = db.prepare(`INSERT INTO model_runs
    (session_id,provider,model,purpose,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    run.sessionId ?? null, run.provider, run.model, run.purpose, run.promptVersion, run.latencyMs,
    run.inputTokens ?? null, run.outputTokens ?? null, run.status, run.errorCode ?? null,
    JSON.stringify(run.metadata ?? {}), nowIso(),
  );
  return Number(result.lastInsertRowid);
}

function getSession(db: AppDatabase, sessionId: number, userId: number, role: string) {
  const row = db.prepare(`SELECT s.*,c.title,c.slug,c.specialty,cv.content_json,rv.criteria_json
    FROM sessions s
    JOIN cases c ON c.id=s.case_id
    JOIN case_versions cv ON cv.id=s.case_version_id
    JOIN rubric_versions rv ON rv.id=s.rubric_version_id
    WHERE s.id=? ${role === 'faculty' ? '' : 'AND s.user_id=?'}`).get(...(role === 'faculty' ? [sessionId] : [sessionId, userId])) as Record<string, unknown> | undefined;
  return assertFound(row, 'Session');
}

function getTurns(db: AppDatabase, sessionId: number): TranscriptTurn[] {
  return db.prepare(`SELECT id,sequence,speaker,content,status FROM turns WHERE session_id=? ORDER BY sequence`).all(sessionId) as TranscriptTurn[];
}

type EvidenceStatus = 'covered' | 'asked_no_credit' | 'not_asked';

function evidenceStatus(
  criterion: RubricCriterion | undefined,
  evidenceTurnIds: number[],
  transcript: Array<{ id: string; role: string; content: string }>,
  content: Record<string, unknown>,
): EvidenceStatus {
  if (evidenceTurnIds.length) return 'covered';
  const studentMessages = transcript.filter((turn) => turn.role === 'student').map((turn) => turn.content.toLowerCase());
  const caseData = content.caseData as Record<string, unknown> | undefined;
  const facts = Array.isArray(caseData?.atomicFacts) ? caseData.atomicFacts : [];
  const factById = new Map(facts.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const fact = value as Record<string, unknown>;
    return typeof fact.id === 'string' ? [[fact.id, fact] as const] : [];
  }));
  const redFlags = Array.isArray(caseData?.redFlags) ? caseData.redFlags : [];
  const redFlagTriggers = (criterion?.redFlagIds ?? []).flatMap((redFlagId) => {
    const definition = redFlags.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).id === redFlagId) as Record<string, unknown> | undefined;
    const linkedIds = Array.isArray(definition?.linkedFactIds) ? definition.linkedFactIds.filter((id): id is string => typeof id === 'string') : [redFlagId];
    return linkedIds.flatMap((id) => {
      const fact = factById.get(id);
      return Array.isArray(fact?.triggers) ? fact.triggers.filter((trigger): trigger is string => typeof trigger === 'string') : [];
    });
  }).map((trigger) => trigger.toLowerCase().trim()).filter((trigger) => trigger.length >= 3);
  if (redFlagTriggers.some((trigger) => studentMessages.some((message) => message.includes(trigger)))) return 'asked_no_credit';
  const keywords = `${criterion?.label ?? ''} ${criterion?.description ?? ''}`
    .toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5 && !['history', 'patient', 'questions', 'relevant', 'information'].includes(word));
  return keywords.some((keyword) => studentMessages.some((message) => message.includes(keyword))) ? 'asked_no_credit' : 'not_asked';
}

export function redFlagLabelMap(content: Record<string, unknown>): Map<string, string> {
  const caseData = content.caseData as Record<string, unknown> | undefined;
  const labels = new Map<string, string>();
  // Faculty-authored cases may directly use a red-flag atomic fact ID in a
  // rubric; curated cases additionally define grouped red-flag IDs below.
  const facts = Array.isArray(caseData?.atomicFacts) ? caseData.atomicFacts : [];
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object') continue;
    const record = fact as Record<string, unknown>;
    if (typeof record.id === 'string' && typeof record.label === 'string') {
      labels.set(record.id, record.label);
    }
  }
  const redFlags = Array.isArray(caseData?.redFlags) ? caseData.redFlags : [];
  for (const redFlag of redFlags) {
    if (!redFlag || typeof redFlag !== 'object') continue;
    const record = redFlag as Record<string, unknown>;
    if (typeof record.id === 'string' && typeof record.label === 'string') {
      labels.set(record.id, record.label);
    }
  }
  return labels;
}

function serializeResult(db: AppDatabase, sessionId: number) {
  const evaluation = db.prepare(`SELECT e.*,s.case_id,c.title,c.specialty,s.started_at,s.completed_at,s.duration_seconds,
    u.display_name AS student_name,rv.criteria_json,cv.content_json,
    (SELECT override_score FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1) AS override_score,
    (SELECT reason FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1) AS override_reason
    FROM evaluations e JOIN sessions s ON s.id=e.session_id JOIN cases c ON c.id=s.case_id
    JOIN users u ON u.id=s.user_id JOIN rubric_versions rv ON rv.id=s.rubric_version_id
    JOIN case_versions cv ON cv.id=s.case_version_id
    WHERE e.session_id=?`).get(sessionId) as Record<string, unknown> | undefined;
  if (!evaluation) return null;
  const criteria = db.prepare(`SELECT criterion_id AS criterionId,score,weighted_score AS weightedScore,
    evidence_turn_ids_json,feedback FROM criterion_scores WHERE evaluation_id=? ORDER BY id`).all(evaluation.id) as Record<string, unknown>[];
  const finalScore = Number(evaluation.override_score ?? evaluation.score);
  const finalLevel = finalScore >= 85 ? 'Excellent' : finalScore >= 70 ? 'Competent' : finalScore >= 50 ? 'Developing' : 'Needs improvement';
  const rubric = parseJson<RubricCriterion[]>(String(evaluation.criteria_json), []);
  const rubricById = new Map(rubric.map((item) => [item.id, item]));
  const feedback = parseJson<Record<string, unknown>>(String(evaluation.feedback_json), {});
  const scoring = feedback.scoring && typeof feedback.scoring === 'object'
    ? feedback.scoring as Record<string, unknown>
    : {};
  const content = parseJson<Record<string, unknown>>(String(evaluation.content_json), {});
  const redFlagLabels = redFlagLabelMap(content);
  const missedRedFlagIds = Array.isArray(feedback.missed_red_flags)
    ? feedback.missed_red_flags.filter((value): value is string => typeof value === 'string')
    : [];
  const transcript = getTurns(db, sessionId).map((turn) => ({ id: String(turn.id), role: turn.speaker, content: turn.content, status: turn.status }));
  const transcriptById = new Map(transcript.map((turn) => [Number(turn.id), turn]));
  return {
    id: evaluation.id,
    sessionId,
    caseId: evaluation.case_id,
    caseTitle: evaluation.title,
    specialty: evaluation.specialty,
    studentName: evaluation.student_name,
    score: finalScore,
    aiScore: evaluation.score,
    level: finalLevel,
    overridden: evaluation.override_score != null,
    adjusted: evaluation.override_score != null,
    teacherScore: evaluation.override_score,
    teacherComment: evaluation.override_reason,
    overrideReason: evaluation.override_reason,
    feedback,
    summary: feedback.overall_feedback ?? '',
    strengths: feedback.strengths ?? [],
    improvements: feedback.improvements ?? [],
    scoringVersion: scoring.version ?? 'history-weighted-v1',
    scoringFormula: scoring.formula ?? 'sum((domain score / 3) × domain weight)',
    scoringRoundingRule: scoring.roundingRule ?? 'Final total rounded to the nearest whole point before any safety cap',
    totalWeight: Number(scoring.totalWeight ?? 100),
    uncappedScore: Number(scoring.uncappedScore ?? evaluation.score),
    capApplied: scoring.capApplied == null ? null : Number(scoring.capApplied),
    scoreCapReason: feedback.score_cap_reason ?? null,
    missedRedFlagIds,
    missedRedFlags: missedRedFlagIds.map((id) => redFlagLabels.get(id) ?? id),
    missedRedFlagReasons: parseJson<Record<string, string>>(JSON.stringify(feedback.missed_red_flag_reasons ?? {}), {}),
    criteria: criteria.map((item) => {
      const definition = rubricById.get(String(item.criterionId));
      const evidenceTurnIds = parseJson<number[]>(String(item.evidence_turn_ids_json), []);
      const numericScore = Number(item.score);
      return {
        criterionId: item.criterionId,
        name: definition?.label ?? item.criterionId,
        score: numericScore,
        maxScore: 3,
        weight: Number(definition?.weight ?? 0),
        level: numericScore >= 2.5 ? 'Excellent' : numericScore >= 2 ? 'Competent' : numericScore >= 1 ? 'Developing' : 'Needs improvement',
        weightedScore: Number(item.weightedScore),
        evidenceTurnIds,
        evidenceStatus: evidenceStatus(definition, evidenceTurnIds, transcript, content),
        evidence: evidenceTurnIds.flatMap((turnId) => {
          const turn = transcriptById.get(turnId);
          return turn ? [{ turnId: String(turnId), quote: turn.content }] : [];
        }),
        feedback: item.feedback,
      };
    }),
    transcript,
    startedAt: evaluation.started_at,
    createdAt: evaluation.created_at,
    completedAt: evaluation.completed_at,
    durationSeconds: evaluation.duration_seconds,
  };
}

function openingStatement(content: Record<string, unknown>): string {
  const direct = content.openingStatement ?? content.opening_statement;
  if (typeof direct === 'string') return direct;
  const patient = content.patient as Record<string, unknown> | undefined;
  const nested = patient?.openingStatement ?? patient?.opening_statement;
  return typeof nested === 'string'
    ? nested
    : 'Hello. I was told you would like to ask me some questions.';
}

export function sessionRoutes(db: AppDatabase, provider: AiProvider, modelName: string, providerName = 'deepseek'): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.authenticate);
    // The local MVP runs as one Node process. These guards prevent duplicate
    // model calls while the browser is already waiting for a response.
    const activeMessageSessions = new Set<number>();
    const activeEvaluations = new Set<number>();

    const runEvaluation = async (id: number) => {
      const existing = serializeResult(db, id);
      if (existing) {
        db.prepare("UPDATE sessions SET evaluation_status='completed',evaluation_error=NULL WHERE id=?").run(id);
        return;
      }
      const session = getSession(db, id, 0, 'faculty');
      db.prepare("UPDATE sessions SET evaluation_status='running',evaluation_error=NULL,evaluation_started_at=? WHERE id=?")
        .run(nowIso(), id);
      const transcript = getTurns(db, id).filter((turn) => turn.status !== 'failed' && turn.status !== 'pending');
      const content = parseJson<Record<string, unknown>>(String(session.content_json), {});
      const criteria = parseJson<RubricCriterion[]>(String(session.criteria_json), []);
      const started = Date.now();
      let evaluated;
      try {
        evaluated = await provider.evaluate({ sessionId: id, caseContent: content, transcript, criteria });
      } catch (error) {
        recordModelRun(db, {
          provider: providerName, model: providerName === 'mock' ? 'simclin-mock-v1' : modelName, purpose: 'evaluator', sessionId: id,
          promptVersion: PROMPT_VERSIONS.evaluator, latencyMs: Date.now() - started, status: 'error',
          errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
        });
        db.prepare("UPDATE sessions SET evaluation_status='failed',evaluation_error=? WHERE id=?")
          .run('Feedback generation failed. Please retry from practice history.', id);
        app.log.error({ err: error, sessionId: id }, 'Background evaluation failed');
        return;
      }

      const modelRunId = recordModelRun(db, {
        provider: evaluated.meta.provider ?? providerName, model: evaluated.meta.model, purpose: 'evaluator', sessionId: id,
        promptVersion: evaluated.meta.promptVersion ?? PROMPT_VERSIONS.evaluator, latencyMs: evaluated.meta.latencyMs,
        inputTokens: evaluated.meta.inputTokens, outputTokens: evaluated.meta.outputTokens, status: 'success',
      });
      try {
        const validStudentTurns = new Set(transcript.filter((turn) => turn.speaker === 'student').map((turn) => turn.id));
        const scoring = calculateScore(evaluated.value, criteria, validStudentTurns, { caseContent: content, transcript });
        const evaluatedAt = nowIso();
        db.transaction(() => {
          const evalResult = db.prepare(`INSERT INTO evaluations
            (session_id,model_run_id,score,level,feedback_json,raw_json,created_at) VALUES (?,?,?,?,?,?,?)`)
            .run(id, modelRunId, scoring.score, scoring.level, JSON.stringify(scoring.feedback), JSON.stringify(evaluated.value), evaluatedAt);
          const evaluationId = Number(evalResult.lastInsertRowid);
          const insertCriterion = db.prepare(`INSERT INTO criterion_scores
            (evaluation_id,criterion_id,score,weighted_score,evidence_turn_ids_json,feedback) VALUES (?,?,?,?,?,?)`);
          for (const item of scoring.criteria) insertCriterion.run(
            evaluationId, item.criterionId, item.score, item.weightedScore, JSON.stringify(item.evidenceTurnIds), item.feedback,
          );
          db.prepare("UPDATE sessions SET evaluation_status='completed',evaluation_error=NULL WHERE id=?").run(id);
        })();
      } catch (error) {
        db.prepare("UPDATE model_runs SET status='error',error_code='AI_OUTPUT_VALIDATION' WHERE id=?")
          .run(modelRunId);
        db.prepare("UPDATE sessions SET evaluation_status='failed',evaluation_error=? WHERE id=?")
          .run('The assessment response could not be validated. Please retry from practice history.', id);
        app.log.error({ err: error, sessionId: id }, 'Background scoring failed');
      }
    };

    const queueEvaluation = (id: number) => {
      if (activeEvaluations.has(id)) return;
      activeEvaluations.add(id);
      setImmediate(() => {
        void runEvaluation(id).finally(() => activeEvaluations.delete(id));
      });
    };

    app.post('/', async (request, reply) => {
      if (request.user.role !== 'student') throw new AppError(403, 'FORBIDDEN', 'Student access is required');
      const { caseId } = StartSchema.parse(request.body);
      const row = assertFound(db.prepare(`SELECT c.id,c.published_version,cv.id AS case_version_id,cv.content_json,
        rv.id AS rubric_version_id FROM cases c
        JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
        JOIN case_rubrics cr ON cr.case_id=c.id
        JOIN rubrics r ON r.id=cr.rubric_id AND r.status='published'
        JOIN rubric_versions rv ON rv.rubric_id=r.id AND rv.version=r.published_version
        WHERE c.id=? AND c.status='published'`).get(caseId) as Record<string, unknown> | undefined, 'Published case');
      const now = nowIso();
      let id = 0;
      const content = parseJson<Record<string, unknown>>(String(row.content_json), {});
      db.transaction(() => {
        const result = db.prepare(`INSERT INTO sessions
          (user_id,case_id,case_version_id,rubric_version_id,status,started_at) VALUES (?,?,?,?, 'active',?)`)
          .run(request.user.sub, caseId, row.case_version_id, row.rubric_version_id, now);
        id = Number(result.lastInsertRowid);
        db.prepare(`INSERT INTO turns (session_id,sequence,speaker,content,disclosed_facts_json,created_at)
          VALUES (?,1,'patient',?,'[]',?)`).run(id, openingStatement(content), now);
      })();
      reply.code(201);
      const opening = openingStatement(content);
      const firstTurn = db.prepare('SELECT id,sequence,speaker,content,created_at AS createdAt FROM turns WHERE session_id=?').get(id) as Record<string, unknown>;
      const session = {
        id, caseId, status: 'active', evaluationStatus: 'not_started', startedAt: now,
        turns: [{ ...firstTurn, role: firstTurn.speaker }], openingStatement: opening,
      };
      return { ...session, session, openingStatement: opening };
    });

    app.get('/', async (request) => {
      const rows = db.prepare(`SELECT s.id,s.case_id AS caseId,c.title AS caseTitle,
        CASE
          WHEN s.evaluation_status IN ('queued','running') THEN 'evaluating'
          WHEN s.evaluation_status='failed' THEN 'evaluation_failed'
          ELSE s.status
        END AS status,
        s.evaluation_status AS evaluationStatus,s.evaluation_error AS evaluationError,
        s.started_at AS startedAt,s.completed_at AS completedAt,s.duration_seconds AS durationSeconds,e.id AS resultId,
        COALESCE((SELECT override_score FROM teacher_overrides o WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score) AS score
        FROM sessions s JOIN cases c ON c.id=s.case_id LEFT JOIN evaluations e ON e.session_id=s.id
        WHERE s.user_id=? ORDER BY s.started_at DESC`).all(request.user.sub) as Array<Record<string, unknown>>;
      for (const row of rows) {
        if (row.resultId == null && (row.evaluationStatus === 'queued' || row.evaluationStatus === 'running')) {
          queueEvaluation(Number(row.id));
        }
      }
      return { sessions: rows, items: rows };
    });

    app.get('/:id', async (request) => {
      const { id } = Params.parse(request.params);
      const session = getSession(db, id, request.user.sub, request.user.role);
      const turns = getTurns(db, id).map((turn) => ({ ...turn, role: turn.speaker }));
      if (!serializeResult(db, id) && (session.evaluation_status === 'queued' || session.evaluation_status === 'running')) {
        queueEvaluation(id);
      }
      const status = session.evaluation_status === 'failed'
        ? 'evaluation_failed'
        : session.evaluation_status === 'queued' || session.evaluation_status === 'running'
          ? 'evaluating'
          : session.status;
      const detail = {
          id, caseId: session.case_id, caseTitle: session.title, specialty: session.specialty,
          status, evaluationStatus: session.evaluation_status, evaluationError: session.evaluation_error,
          startedAt: session.started_at, completedAt: session.completed_at,
          turns, result: serializeResult(db, id),
      };
      return { ...detail, session: detail };
    });

    const streamMessage = async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user.role !== 'student') throw new AppError(403, 'FORBIDDEN', 'Student access is required');
      const { id } = Params.parse(request.params);
      const { message } = MessageSchema.parse(request.body);
      const session = getSession(db, id, request.user.sub, request.user.role);
      if (session.status !== 'active') throw new AppError(409, 'SESSION_NOT_ACTIVE', 'This session is no longer active');
      if (activeMessageSessions.has(id)) throw new AppError(409, 'SESSION_BUSY', 'Please wait for the simulated patient to finish responding');
      const questionCount = db.prepare("SELECT COUNT(*) AS count FROM turns WHERE session_id=? AND speaker='student' AND status!='failed'").get(id) as { count: number };
      if (questionCount.count >= MAX_QUESTIONS_PER_SESSION) {
        throw new AppError(409, 'SESSION_LIMIT_REACHED', `This practice session is limited to ${MAX_QUESTIONS_PER_SESSION} questions`);
      }
      activeMessageSessions.add(id);
      const now = nowIso();
      let sequenceNext = 0;
      let studentResult: { lastInsertRowid: number | bigint };
      try {
        studentResult = db.transaction(() => {
          const sequenceRow = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM turns WHERE session_id=?').get(id) as { next: number };
          sequenceNext = sequenceRow.next;
          return db.prepare(`INSERT INTO turns (session_id,sequence,speaker,content,status,disclosed_facts_json,created_at)
            VALUES (?,?,'student',?,'pending','[]',?)`).run(id, sequenceRow.next, message, now);
        })();
      } catch (error) {
        activeMessageSessions.delete(id);
        throw error;
      }
      const transcript = getTurns(db, id);
      const content = parseJson<Record<string, unknown>>(String(session.content_json), {});

      // Fastify's normal response lifecycle applies CORS headers when it sends
      // a response. This endpoint hijacks the raw response for SSE, so mirror
      // the headers that earlier hooks (notably @fastify/cors) have prepared
      // before flushing the raw response.
      const preparedHeaders = reply.getHeaders();
      reply.hijack();
      reply.raw.statusCode = 200;
      for (const [name, value] of Object.entries(preparedHeaders)) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();
      const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('meta', { type: 'meta', studentTurnId: Number(studentResult.lastInsertRowid) });
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': keep-alive\n\n');
      }, 10_000);

      let planner;
      const plannerStarted = Date.now();
      try {
        planner = await provider.planDisclosure({ sessionId: id, caseContent: content, transcript, studentMessage: message });
        recordModelRun(db, {
          provider: planner.meta.provider ?? providerName, model: planner.meta.model, purpose: 'disclosure-planner', sessionId: id,
          promptVersion: planner.meta.promptVersion ?? PROMPT_VERSIONS.planner, latencyMs: planner.meta.latencyMs,
          inputTokens: planner.meta.inputTokens, outputTokens: planner.meta.outputTokens, status: 'success',
          metadata: { factCount: planner.disclosedFactIds.length },
        });
      } catch (error) {
        recordModelRun(db, {
          provider: providerName, model: providerName === 'mock' ? 'simclin-mock-v1' : modelName, purpose: 'disclosure-planner', sessionId: id,
          promptVersion: PROMPT_VERSIONS.planner, latencyMs: Date.now() - plannerStarted, status: 'error',
          errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
        });
        db.prepare("UPDATE turns SET status='failed' WHERE id=?").run(Number(studentResult.lastInsertRowid));
        activeMessageSessions.delete(id);
        clearInterval(heartbeat);
        send('error', {
          type: 'error',
          code: 'DISCLOSURE_PLANNER_FAILED',
          message: 'The simulated patient could not respond. Please retry.',
        });
        reply.raw.end();
        return;
      }
      const permittedFacts = collectPermittedFacts(content, planner.disclosedFactIds);
      const validDisclosedFactIds = permittedFacts.flatMap((fact) => {
        if (!fact || typeof fact !== 'object') return [];
        const record = fact as Record<string, unknown>;
        const factId = typeof record.id === 'string' ? record.id : typeof record.factId === 'string' ? record.factId : undefined;
        return factId ? [factId] : [];
      });

      let patientReply = '';
      const actorStarted = Date.now();
      try {
        for await (const chunk of provider.streamPatientReply({
          sessionId: id, caseContent: content, transcript, studentMessage: message,
          disclosedFactIds: validDisclosedFactIds, permittedFacts, questionStyle: planner.questionStyle,
        })) {
          patientReply += chunk;
          send('delta', { type: 'delta', text: chunk, delta: chunk });
        }
        if (!patientReply.trim()) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'Patient actor returned an empty response');
        validatePatientReply(patientReply.trim(), content, validDisclosedFactIds);
        const patientSequence = sequenceNext + 1;
        const result = db.transaction(() => {
          db.prepare("UPDATE turns SET status='completed' WHERE id=?").run(Number(studentResult.lastInsertRowid));
          return db.prepare(`INSERT INTO turns (session_id,sequence,speaker,content,status,disclosed_facts_json,created_at)
            VALUES (?,?,'patient',?,'completed',?,?)`).run(id, patientSequence, patientReply.trim(), JSON.stringify(validDisclosedFactIds), nowIso());
        })();
        recordModelRun(db, {
          provider: providerName, model: providerName === 'mock' ? 'simclin-mock-v1' : modelName, purpose: 'patient-actor', sessionId: id,
          promptVersion: PROMPT_VERSIONS.actor, latencyMs: Date.now() - actorStarted, status: 'success',
          metadata: { characterCount: patientReply.length },
        });
        send('complete', { type: 'done', patientTurnId: Number(result.lastInsertRowid), turnId: String(result.lastInsertRowid), text: patientReply.trim() });
      } catch (error) {
        db.prepare("UPDATE turns SET status='failed' WHERE id=?").run(Number(studentResult.lastInsertRowid));
        recordModelRun(db, {
          provider: providerName, model: providerName === 'mock' ? 'simclin-mock-v1' : modelName, purpose: 'patient-actor', sessionId: id,
          promptVersion: PROMPT_VERSIONS.actor, latencyMs: Date.now() - actorStarted, status: 'error',
          errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
        });
        send('error', { type: 'error', code: 'PATIENT_RESPONSE_FAILED', message: 'The simulated patient could not respond. Please retry.' });
      } finally {
        clearInterval(heartbeat);
        activeMessageSessions.delete(id);
        reply.raw.end();
      }
    };
    app.post('/:id/messages', streamMessage);
    app.post('/:id/messages/stream', streamMessage);

    app.post('/:id/complete', async (request, reply) => {
      if (request.user.role !== 'student') throw new AppError(403, 'FORBIDDEN', 'Student access is required');
      const { id } = Params.parse(request.params);
      const session = getSession(db, id, request.user.sub, request.user.role);
      const prior = serializeResult(db, id);
      if (prior) return { status: 'completed', resultId: String(prior.id), result: prior };
      if (session.status === 'abandoned') throw new AppError(409, 'SESSION_NOT_ACTIVE', 'This session is no longer active');
      if (activeMessageSessions.has(id)) throw new AppError(409, 'SESSION_BUSY', 'Please wait for the simulated patient to finish responding');
      const transcript = getTurns(db, id).filter((turn) => turn.status !== 'failed' && turn.status !== 'pending');
      if (!transcript.some((turn) => turn.speaker === 'student')) {
        throw new AppError(400, 'EMPTY_SESSION', 'Ask the patient at least one question before ending the consultation');
      }
      if (session.status === 'active') {
        const completedAt = nowIso();
        const durationSeconds = Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(String(session.started_at))) / 1000));
        db.prepare(`UPDATE sessions SET status='completed',completed_at=?,duration_seconds=?,
          evaluation_status='queued',evaluation_error=NULL WHERE id=?`)
          .run(completedAt, durationSeconds, id);
      } else if (session.evaluation_status === 'failed' || session.evaluation_status === 'not_started') {
        db.prepare("UPDATE sessions SET evaluation_status='queued',evaluation_error=NULL WHERE id=?").run(id);
      }
      queueEvaluation(id);
      reply.code(202);
      return {
        status: 'evaluating',
        sessionId: String(id),
        message: 'Feedback generation has started. You can review it from practice history when it is ready.',
      };
    });

    app.get('/:id/result', async (request) => {
      const { id } = Params.parse(request.params);
      getSession(db, id, request.user.sub, request.user.role);
      return { result: assertFound(serializeResult(db, id), 'Result') };
    });
  };
}

export { serializeResult };
