import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const questions: Record<string, string> = {
  'pressure-in-my-chest': 'When did the chest pressure start, what were you doing, and does it travel anywhere?',
  'cant-catch-my-breath': 'When did the breathlessness worsen, and have your cough or sputum changed?',
  'burning-pain-after-meals': 'Please describe the pain, and have you noticed black stools or vomiting blood?',
  'worst-headache': 'Exactly how did the headache start, and did it reach maximum intensity immediately?',
  'always-thirsty': 'How long have you been thirsty and urinating more, and have you lost weight?',
};

function patientTextFromSse(body: string): string {
  let text = '';
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') continue;
    try {
      const event = JSON.parse(value) as { type?: string; delta?: string };
      if (event.type === 'delta' && event.delta) text += event.delta;
    } catch { /* Provider keep-alive text is not patient content. */ }
  }
  return text.trim();
}

const config = loadConfig({ DATABASE_PATH: ':memory:', AI_PROVIDER: 'deepseek', LOG_LEVEL: 'warn' });
if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for the real-provider regression');
const app = await buildApp({ config, logger: true });

try {
  const auth = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: { role: 'student' } });
  if (auth.statusCode !== 200) throw new Error(`Demo auth failed: HTTP ${auth.statusCode}`);
  const headers = { authorization: `Bearer ${auth.json().token as string}` };
  const list = await app.inject({ method: 'GET', url: '/api/cases', headers });
  const allCases = list.json().items as Array<{ id: number; slug: string }>;
  const selectedSlugs = (process.env.SIMCLIN_REAL_CASE_SLUG ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const cases = selectedSlugs.length
    ? allCases.filter((item) => selectedSlugs.includes(item.slug))
    : allCases;
  const expectedCount = selectedSlugs.length || 5;
  if (cases.length !== expectedCount) throw new Error(`Expected ${expectedCount} selected seed case(s), received ${cases.length}`);

  const results: Array<{ slug: string; actorCharacters: number; score: number; criteriaCount: number }> = [];
  for (const clinicalCase of cases) {
    const start = await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { caseId: clinicalCase.id } });
    const sessionId = start.json().session?.id as number | undefined;
    if (!sessionId) throw new Error(`${clinicalCase.slug}: session start failed (HTTP ${start.statusCode})`);
    const message = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/messages`, headers,
      payload: { message: questions[clinicalCase.slug] ?? 'Could you tell me more about what brought you in today?' },
    });
    const patientText = patientTextFromSse(message.body);
    if (message.statusCode !== 200 || !message.body.includes('event: complete') || patientText.length < 5) {
      throw new Error(`${clinicalCase.slug}: patient actor failed (HTTP ${message.statusCode})`);
    }
    if (/\b(?:fact[_ -]?id|rubric|system prompt|evaluatorOnlyNote)\b/i.test(patientText)) {
      throw new Error(`${clinicalCase.slug}: patient actor exposed internal simulation metadata`);
    }

    const complete = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, headers });
    if (complete.statusCode !== 200) throw new Error(`${clinicalCase.slug}: evaluator failed (HTTP ${complete.statusCode})`);
    const result = complete.json().result as { score: number; criteria: unknown[] };
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100 || result.criteria.length !== 7) {
      throw new Error(`${clinicalCase.slug}: evaluator returned an invalid structured score`);
    }
    const summary = { slug: clinicalCase.slug, actorCharacters: patientText.length, score: result.score, criteriaCount: result.criteria.length };
    results.push(summary);
    console.log(JSON.stringify({ casePassed: summary }));
  }
  console.log(JSON.stringify({ ok: true, casesPassed: results.length, results }));
} finally {
  await app.close();
}
