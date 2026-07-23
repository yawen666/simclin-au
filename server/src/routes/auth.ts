import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../data/database.js';

const BodySchema = z.object({ role: z.enum(['student', 'faculty']) });

export function authRoutes(db: AppDatabase): FastifyPluginAsync {
  return async (app) => {
    app.post('/demo', async (request) => {
      const { role } = BodySchema.parse(request.body);
      const user = db.prepare(`SELECT id,username,display_name AS displayName,role FROM users WHERE role=?`).get(role) as {
        id: number; username: string; displayName: string; role: 'student' | 'faculty';
      };
      const token = await app.jwt.sign({
        sub: user.id, username: user.username, displayName: user.displayName, role: user.role,
      }, { expiresIn: '12h' });
      return { token, user: { ...user, name: user.displayName } };
    });

    app.get('/me', { preHandler: app.authenticate }, async (request) => ({
      user: {
        id: request.user.sub,
        username: request.user.username,
        displayName: request.user.displayName,
        role: request.user.role,
      },
    }));
  };
}
