import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig({ DATABASE_PATH: ':memory:', AI_PROVIDER: 'deepseek', LOG_LEVEL: 'warn' });
if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for the real-provider smoke test');
const app = await buildApp({ config, logger: true });

async function waitForEvaluation(sessionId: number, headers: Record<string, string>) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers });
    const result = response.json().result as {
      score: number;
      uncappedScore: number;
      totalWeight: number;
      scoringVersion: string;
      criteria: Array<{ score: number; weight: number; weightedScore: number }>;
    } | null;
    if (result) return result;
    if (response.json().evaluationStatus === 'failed') throw new Error('Evaluator reported a failed status');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Evaluator did not finish within 120 seconds');
}

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
  if (completeResponse.statusCode !== 202) throw new Error(`Evaluator queue failed: HTTP ${completeResponse.statusCode}`);
  const result = await waitForEvaluation(sessionId, headers);
  if (result.criteria.length !== 7) throw new Error(`Expected 7 rubric domains, received ${result.criteria.length}`);
  if (result.totalWeight !== 100) throw new Error(`Expected total rubric weight 100, received ${result.totalWeight}`);
  if (result.criteria.reduce((sum, item) => sum + item.weight, 0) !== 100) {
    throw new Error('Criterion weights do not total 100');
  }
  if (result.criteria.some((item) => !Number.isInteger(item.score) || item.score < 0 || item.score > 3)) {
    throw new Error('Evaluator returned a score outside the integer 0–3 anchors');
  }
  const weightedTotal = Math.round(result.criteria.reduce((sum, item) => sum + item.weightedScore, 0) * 100) / 100;
  if (weightedTotal !== result.uncappedScore) {
    throw new Error(`Weighted contributions ${weightedTotal} do not match uncapped score ${result.uncappedScore}`);
  }
  console.log(JSON.stringify({
    ok: true,
    score: result.score,
    uncappedScore: result.uncappedScore,
    criteriaCount: result.criteria.length,
    totalWeight: result.totalWeight,
    scoringVersion: result.scoringVersion,
  }));
} finally {
  await app.close();
}
