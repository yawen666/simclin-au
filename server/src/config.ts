import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('./data/simclin-au.db'),
  JWT_SECRET: z.string().min(16).default('local-development-secret-change-me'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-pro'),
  AI_PROVIDER: z.enum(['deepseek', 'mock']).default('deepseek'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}): AppConfig {
  const parsed = EnvSchema.parse({ ...process.env, ...overrides });
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === 'local-development-secret-change-me') {
    throw new Error('JWT_SECRET must be set to a unique secret in production');
  }
  if (parsed.NODE_ENV === 'production' && parsed.WEB_ORIGIN.includes('localhost')) {
    throw new Error('WEB_ORIGIN must be set to the deployed frontend origin in production');
  }
  return {
    ...parsed,
    DATABASE_PATH: parsed.DATABASE_PATH === ':memory:' || path.isAbsolute(parsed.DATABASE_PATH)
      ? parsed.DATABASE_PATH
      : path.resolve(serverRoot, parsed.DATABASE_PATH),
  };
}
