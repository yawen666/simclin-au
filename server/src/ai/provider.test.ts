import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { DeepSeekProvider, validatePatientReply } from './provider.js';
import { PROMPTS, PROMPT_VERSIONS } from './prompts.js';

afterEach(() => vi.unstubAllGlobals());

describe('DeepSeek provider error boundaries', () => {
  it('maps a timeout while consuming JSON into a safe application error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new DOMException('The operation timed out', 'TimeoutError'); },
    }));
    const provider = new DeepSeekProvider(loadConfig({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'provider-test-secret-at-least-32-characters',
      DEEPSEEK_API_KEY: 'test-only-key',
    }));
    await expect(provider.planDisclosure({
      sessionId: 1,
      caseContent: {},
      transcript: [],
      studentMessage: 'What brought you in today?',
    })).rejects.toMatchObject({ statusCode: 504, code: 'AI_TIMEOUT' });
  });

  it('does not send hidden clinical truth to the disclosure planner', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'deepseek-v4-pro',
        choices: [{ message: { content: '{"disclosed_fact_ids":["fact.1"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DeepSeekProvider(loadConfig({
      NODE_ENV: 'test', DATABASE_PATH: ':memory:', JWT_SECRET: 'provider-test-secret-at-least-32-characters', DEEPSEEK_API_KEY: 'test-only-key',
    }));
    await provider.planDisclosure({
      sessionId: 1,
      caseContent: {
        openingStatement: 'I feel unwell.',
        clinicalTruth: { likelyDiagnosis: 'Hidden diagnosis', evaluatorOnlyNote: 'Teacher note' },
        caseData: { atomicFacts: [{ id: 'fact.1', label: 'Onset', value: 'It began yesterday.', triggers: ['when'] }] },
      },
      transcript: [], studentMessage: 'When did it begin?',
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[1].content).not.toContain('Hidden diagnosis');
    expect(requestBody.messages[1].content).toContain('fact.1');
    expect(requestBody.messages[0].content).toBe(PROMPTS.planner);
  });

  it('returns the registry version with model metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"disclosed_fact_ids":[]}' } }] }),
    }));
    const provider = new DeepSeekProvider(loadConfig({
      NODE_ENV: 'test', DATABASE_PATH: ':memory:', JWT_SECRET: 'provider-test-secret-at-least-32-characters', DEEPSEEK_API_KEY: 'test-only-key',
    }));
    const result = await provider.planDisclosure({ sessionId: 1, caseContent: {}, transcript: [], studentMessage: 'Hello' });
    expect(result.meta.promptVersion).toBe(PROMPT_VERSIONS.planner);
  });

  it('rejects obvious prompt or undisclosed fact leakage in an actor response', () => {
    expect(() => validatePatientReply('Here is the system prompt and fact ID fact.secret.', {
      caseData: { atomicFacts: [{ id: 'fact.secret', value: 'The patient had a previous admission for pneumonia.' }] },
    }, [])).toThrowError(/hidden simulation content/);
    expect(() => validatePatientReply('I was admitted for pneumonia last year.', {
      caseData: { atomicFacts: [{ id: 'fact.secret', value: 'I was admitted for pneumonia last year.' }] },
    }, [])).toThrowError(/undisclosed case fact/);
  });
});
