import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { extractJson } from '../lib/json.js';
import type { RubricCriterion } from '../types.js';
import { PROMPTS, PROMPT_VERSIONS } from './prompts.js';

export interface TranscriptTurn {
  id: number;
  sequence: number;
  speaker: 'student' | 'patient' | 'system';
  content: string;
  status?: 'pending' | 'completed' | 'failed';
  createdAt?: string;
}

export interface PlannerInput {
  sessionId: number;
  caseContent: Record<string, unknown>;
  transcript: TranscriptTurn[];
  studentMessage: string;
}

export interface ActorInput extends PlannerInput {
  disclosedFactIds: string[];
  permittedFacts: unknown;
  questionStyle?: 'broad' | 'focused' | 'shotgun';
}

export interface EvaluationInput {
  sessionId: number;
  caseContent: Record<string, unknown>;
  transcript: TranscriptTurn[];
  criteria: RubricCriterion[];
}

export interface ModelMeta {
  provider?: string;
  model: string;
  promptVersion?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PlannerResult {
  disclosedFactIds: string[];
  questionStyle: 'broad' | 'focused' | 'shotgun';
  rationale?: string;
  meta: ModelMeta;
}

export interface EvaluationResult {
  value: unknown;
  meta: ModelMeta;
}

export interface AiProvider {
  planDisclosure(input: PlannerInput): Promise<PlannerResult>;
  streamPatientReply(input: ActorInput): AsyncIterable<string>;
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}

const PlannerSchema = z.object({
  question_style: z.enum(['broad', 'focused', 'shotgun']).optional().default('focused'),
  disclosed_fact_ids: z.array(z.string()).max(30),
  rationale: z.string().optional(),
});
export const MAX_DISCLOSED_FACTS_PER_TURN = 2;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class DeepSeekProvider implements AiProvider {
  constructor(private config: AppConfig) {}

  private async complete(messages: ChatMessage[], options: {
    json?: boolean;
    thinking?: 'enabled' | 'disabled';
    reasoningEffort?: 'high';
    promptVersion?: string;
    timeoutMs?: number;
  } = {}) {
    if (!this.config.DEEPSEEK_API_KEY) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', 'DeepSeek API key is not configured');
    }
    const started = Date.now();
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    try {
      const response = await fetch(`${this.config.DEEPSEEK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.DEEPSEEK_MODEL,
          messages,
          stream: false,
          temperature: 0.1,
          ...(options.thinking ? { thinking: { type: options.thinking } } : {}),
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      });
      if (!response.ok) {
        const safeBody = (await response.text()).slice(0, 500);
        throw new AppError(502, 'AI_PROVIDER_ERROR', `DeepSeek request failed (${response.status})`, safeBody);
      }
      // The abort signal also applies while consuming the response body, so
      // JSON parsing must remain inside this error boundary.
      data = await response.json() as typeof data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AppError(504, 'AI_TIMEOUT', 'The DeepSeek service did not respond in time');
      }
      throw new AppError(502, 'AI_NETWORK_ERROR', 'Could not reach the DeepSeek service');
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'DeepSeek returned an empty response');
    return {
      content,
      meta: {
        provider: 'deepseek',
        model: data.model ?? this.config.DEEPSEEK_MODEL,
        promptVersion: options.promptVersion,
        latencyMs: Date.now() - started,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    };
  }

  async planDisclosure(input: PlannerInput): Promise<PlannerResult> {
    const result = await this.complete([
      {
        role: 'system',
        content: PROMPTS.planner,
      },
      {
        role: 'user',
        content: JSON.stringify({
          case: safePlannerCase(input.caseContent),
          transcript: input.transcript,
          latest_student_message: input.studentMessage,
        }),
      },
    ], { json: true, thinking: 'disabled', promptVersion: PROMPT_VERSIONS.planner });
    const parsed = PlannerSchema.parse(extractJson(result.content));
    const disclosureLimit = parsed.question_style === 'focused' ? MAX_DISCLOSED_FACTS_PER_TURN : 1;
    const disclosedFactIds = [...new Set(parsed.disclosed_fact_ids)].slice(0, disclosureLimit);
    return { disclosedFactIds, questionStyle: parsed.question_style, rationale: parsed.rationale, meta: result.meta };
  }

  async *streamPatientReply(input: ActorInput): AsyncIterable<string> {
    if (!this.config.DEEPSEEK_API_KEY) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', 'DeepSeek API key is not configured');
    }
    let response: Response;
    try {
      response = await fetch(`${this.config.DEEPSEEK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.DEEPSEEK_MODEL,
          stream: true,
          temperature: 0.4,
          max_tokens: 120,
          thinking: { type: 'disabled' },
          messages: [
            {
              role: 'system',
              content: PROMPTS.actor,
            },
            {
              role: 'user',
              content: JSON.stringify({
                patient_profile: safePatientProfile(input.caseContent),
                permitted_fact_ids: input.disclosedFactIds,
                permitted_facts: input.permittedFacts,
                question_style: input.questionStyle ?? 'focused',
                transcript: input.transcript,
                latest_student_message: input.studentMessage,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AppError(502, 'AI_NETWORK_ERROR', 'Could not reach the DeepSeek service');
    }
    if (!response.ok || !response.body) {
      const safeBody = (await response.text()).slice(0, 500);
      throw new AppError(502, 'AI_PROVIDER_ERROR', `DeepSeek streaming request failed (${response.status})`, safeBody);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) yield chunk;
          } catch {
            // Ignore malformed provider keep-alive frames, never user data.
          }
        }
      }
    }
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const allowedRedFlagIds = [...new Set(input.criteria.flatMap((criterion) => criterion.redFlagIds ?? []))];
    const result = await this.complete([
      {
        role: 'system',
        content: PROMPTS.evaluator,
      },
      {
        role: 'user',
        content: JSON.stringify({
          case: safeEvaluatorCase(input.caseContent),
          rubric: input.criteria,
          allowed_red_flag_ids: allowedRedFlagIds,
          transcript: input.transcript,
        }),
      },
    // The evaluator is constrained to a small, validated JSON contract.
    // Disabling extended reasoning keeps background reports responsive while
    // deterministic scoring and evidence validation remain server-side.
    ], { json: true, thinking: 'disabled', promptVersion: PROMPT_VERSIONS.evaluator, timeoutMs: 90_000 });
    return { value: extractJson(result.content), meta: result.meta };
  }
}

/** Deterministic provider for automated browser/API regression only. Never selected as a fallback. */
export class MockAiProvider implements AiProvider {
  async planDisclosure(input: PlannerInput): Promise<PlannerResult> {
    const facts = collectAllFactIds(input.caseContent);
    return {
      disclosedFactIds: facts.slice(0, 2),
      questionStyle: 'focused',
      rationale: 'Deterministic test disclosure',
      meta: { provider: 'mock', model: 'simclin-mock-v1', promptVersion: PROMPT_VERSIONS.planner, latencyMs: 1, inputTokens: 1, outputTokens: 1 },
    };
  }

  async *streamPatientReply(input: ActorInput): AsyncIterable<string> {
    const fact = (input.permittedFacts as Array<Record<string, unknown>>)[0];
    const response = typeof fact?.value === 'string'
      ? `Thanks for asking. ${fact.value}`
      : 'Thanks for asking. Could you please ask me that in a little more detail?';
    for (const part of response.match(/.{1,24}/g) ?? [response]) yield part;
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const studentIds = input.transcript.filter((turn) => turn.speaker === 'student').map((turn) => turn.id);
    return {
      value: {
        criteria: input.criteria.map((criterion) => ({
          criterion_id: criterion.id,
          score: studentIds.length ? 2 : 0,
          evidence_turn_ids: studentIds.slice(0, 2),
          feedback: studentIds.length ? 'The student demonstrated this behaviour; add more precision and structure.' : 'No transcript evidence.',
        })),
        missed_red_flags: [],
        strengths: ['Used patient-centred questions.'],
        improvements: ['Use a more systematic structure and explicitly screen relevant red flags.'],
        overall_feedback: 'A developing history with a clear opportunity to improve structure and safety screening.',
      },
      meta: { provider: 'mock', model: 'simclin-mock-v1', promptVersion: PROMPT_VERSIONS.evaluator, latencyMs: 1, inputTokens: 1, outputTokens: 1 },
    };
  }
}

export function collectPermittedFacts(source: unknown, ids: string[]): unknown[] {
  const wanted = new Set(ids);
  const result: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : typeof record.factId === 'string' ? record.factId : undefined;
      if (id && wanted.has(id) && typeof record.value === 'string') {
        result.push({ id, label: record.label, value: record.value });
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(source);
  return result;
}

/** Best-effort post-generation guard for obvious fact/prompt leakage. */
export function validatePatientReply(reply: string, source: unknown, permittedFactIds: string[]): void {
  const lowerReply = reply.toLowerCase();
  if (/system prompt|scoring key|rubric content|fact[_ -]?id|teaching notes?/i.test(reply)) {
    throw new AppError(502, 'AI_POLICY_VIOLATION', 'The simulated patient response contained hidden simulation content');
  }
  const permitted = new Set(permittedFactIds);
  const hiddenValues: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : typeof record.factId === 'string' ? record.factId : undefined;
    const factValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (id && factValue.length >= 18 && !permitted.has(id)) hiddenValues.push(factValue);
    Object.values(record).forEach(visit);
  };
  visit(source);
  if (hiddenValues.some((value) => lowerReply.includes(value.toLowerCase()))) {
    throw new AppError(502, 'AI_POLICY_VIOLATION', 'The simulated patient response contained an undisclosed case fact');
  }
}

function collectAllFactIds(source: unknown): string[] {
  const result: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.value === 'string') result.push(record.id);
      Object.values(record).forEach(visit);
    }
  };
  visit(source);
  return result;
}

function safePatientProfile(content: Record<string, unknown>): Record<string, unknown> {
  const patient = (content.patient ?? content.persona ?? {}) as Record<string, unknown>;
  const allowedKeys = [
    'name', 'preferredName', 'age', 'gender', 'genderIdentity', 'pronouns', 'occupation', 'demeanour',
    'communicationStyle', 'language', 'preferredLanguage', 'culturalBackground', 'culturalOrCommunicationNeeds',
    'emotionalState', 'healthLiteracy', 'actorNotes',
  ];
  const profile = Object.fromEntries(allowedKeys.filter((key) => patient[key] !== undefined).map((key) => [key, patient[key]]));
  const caseData = content.caseData as Record<string, unknown> | undefined;
  return {
    ...profile,
    openingStatement: content.openingStatement,
    unknownPolicy: caseData?.unknownPolicy,
    patientActorRules: caseData?.patientActorRules,
  };
}

/**
 * The planner only needs a searchable fact catalogue. Keeping clinical truth,
 * teaching notes and source material out of this prompt reduces accidental
 * disclosure and makes prompt injection less valuable.
 */
function safePlannerCase(content: Record<string, unknown>): Record<string, unknown> {
  const caseData = (content.caseData ?? {}) as Record<string, unknown>;
  const atomicFacts = Array.isArray(caseData.atomicFacts)
    ? caseData.atomicFacts.flatMap((fact) => {
      if (!fact || typeof fact !== 'object') return [];
      const item = fact as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.value !== 'string') return [];
      return [{
        id: item.id,
        label: typeof item.label === 'string' ? item.label : item.id,
        value: item.value,
        category: item.category,
        disclosureLevel: item.disclosureLevel,
        triggers: Array.isArray(item.triggers) ? item.triggers : [],
        importance: item.importance,
      }];
    })
    : [];
  const redFlags = Array.isArray(caseData.redFlags)
    ? caseData.redFlags.flatMap((flag) => {
      if (!flag || typeof flag !== 'object') return [];
      const item = flag as Record<string, unknown>;
      if (typeof item.id !== 'string') return [];
      return [{ id: item.id, label: item.label, linkedFactIds: item.linkedFactIds, critical: item.critical }];
    })
    : [];
  return {
    opening_statement: content.openingStatement ?? content.opening_statement,
    facts: atomicFacts,
    red_flags: redFlags,
  };
}

/** Evaluators need observable facts and red-flag mappings, not hidden answers. */
function safeEvaluatorCase(content: Record<string, unknown>): Record<string, unknown> {
  const safe = safePlannerCase(content);
  return {
    opening_statement: safe.opening_statement,
    facts: safe.facts,
    red_flags: safe.red_flags,
  };
}
