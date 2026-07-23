export type Role = 'student' | 'faculty';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface RubricCriterion {
  id: string;
  label: string;
  description?: string;
  weight: number;
  maxScore?: number;
  critical?: boolean;
  redFlagIds?: string[];
  anchors?: Record<string, string>;
  [key: string]: unknown;
}

export interface ModelRunRecord {
  provider: string;
  model: string;
  purpose: string;
  sessionId?: number;
  promptVersion: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  status: 'success' | 'error';
  errorCode?: string;
  metadata?: unknown;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; username: string; displayName: string; role: Role };
    user: { sub: number; username: string; displayName: string; role: Role };
  }
}
