import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig({ DATABASE_PATH: ':memory:', AI_PROVIDER: 'deepseek', LOG_LEVEL: 'warn' });
if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for the real-provider smoke test');
const app = await buildApp({ config, logger: true });

try {
  const authResponse = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: { role: 'student' } });
  if (authResponse.statusCode !== 200) throw new Error(`Demo auth failed: HTTP ${authResponse.statusCode}`);
  const token = authResponse.json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const casesResponse = await app.inject({ method: 'GET', url: '/api/cases', headers });
  const firstCase = casesResponse.json().cases?.[0] as { id: number } | undefined;
  if (!firstCase) throw new Error('No published seed case is available');
  const startResponse = await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { caseId: firstCase.id } });
  const sessionId = startResponse.json().session?.id as number | undefined;
  if (!sessionId) throw new Error(`Session start failed: HTTP ${startResponse.statusCode}`);
  const messageResponse = await app.inject({
    method: 'POST', url: `/api/sessions/${sessionId}/messages`, headers,
    payload: { message: 'Hello, my name is Alex, a medical student. Could you tell me what brought you in today?' },
  });
  if (messageResponse.statusCode !== 200 || !messageResponse.body.includes('event: complete')) {
    const code = (() => { try { return messageResponse.json().error?.code; } catch { return undefined; } })();
    throw new Error(`Patient actor smoke failed: HTTP ${messageResponse.statusCode}${code ? ` (${code})` : ''}`);
  }
  const completeResponse = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, headers });
  if (completeResponse.statusCode !== 200) throw new Error(`Evaluator smoke failed: HTTP ${completeResponse.statusCode}`);
  const result = completeResponse.json().result as { score: number; criteria: unknown[] };
  console.log(JSON.stringify({ ok: true, score: result.score, criteriaCount: result.criteria.length }));
} finally {
  await app.close();
}
