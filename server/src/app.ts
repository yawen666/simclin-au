import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { createDatabase, type AppDatabase } from './data/database.js';
import type { AiProvider } from './ai/provider.js';
import { DeepSeekProvider, MockAiProvider } from './ai/provider.js';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { caseRoutes } from './routes/cases.js';
import { rubricRoutes } from './routes/rubrics.js';
import { sessionRoutes } from './routes/sessions.js';
import { insightRoutes, resultRoutes } from './routes/results.js';
import { uploadRoutes } from './routes/uploads.js';
import { historyRoutes } from './routes/history.js';

export interface BuildAppOptions {
  config?: AppConfig;
  db?: AppDatabase;
  aiProvider?: AiProvider;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.LOG_LEVEL },
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });
  const ownedDb = !options.db;
  const db = options.db ?? createDatabase(config.DATABASE_PATH);
  const provider = options.aiProvider ?? (config.AI_PROVIDER === 'mock' ? new MockAiProvider() : new DeepSeekProvider(config));

  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(',').map((item) => item.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin, { secret: config.JWT_SECRET });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: 'ROUTE_NOT_FOUND', message: 'The requested API route does not exist' },
  }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Request validation failed', error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.issues } });
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error, code: error.code }, error.message);
      return reply.code(error.statusCode).send({ code: error.code, message: error.message, error: { code: error.code, message: error.message, ...(error.statusCode < 500 ? { details: error.details } : {}) } });
    }
    const sqlite = error as Error & { code?: unknown };
    if (typeof sqlite.code === 'string' && sqlite.code.startsWith('SQLITE_CONSTRAINT')) {
      return reply.code(409).send({ code: 'CONFLICT', message: 'A record with these details already exists or is in use', error: { code: 'CONFLICT', message: 'A record with these details already exists or is in use' } });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred', error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred' } });
  });

  app.get('/api/health', async () => {
    const database = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    return {
      status: database.ok === 1 ? 'ok' : 'degraded',
      service: 'simclin-au-api',
      database: 'ok',
      aiConfigured: Boolean(config.DEEPSEEK_API_KEY),
      aiProvider: config.AI_PROVIDER,
      timestamp: new Date().toISOString(),
    };
  });
  await app.register(authRoutes(db), { prefix: '/api/auth' });
  await app.register(caseRoutes(db, provider), { prefix: '/api/cases' });
  await app.register(rubricRoutes(db), { prefix: '/api/rubrics' });
  await app.register(sessionRoutes(db, provider, config.DEEPSEEK_MODEL, config.AI_PROVIDER), { prefix: '/api/sessions' });
  await app.register(resultRoutes(db), { prefix: '/api/results' });
  await app.register(historyRoutes(db), { prefix: '/api/history' });
  await app.register(insightRoutes(db), { prefix: '/api/insights' });
  await app.register(uploadRoutes(path.resolve(path.dirname(config.DATABASE_PATH), 'uploads')), { prefix: '/api/uploads' });

  if (ownedDb) app.addHook('onClose', async () => db.close());
  return app;
}
