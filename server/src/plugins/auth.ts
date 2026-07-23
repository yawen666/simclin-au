import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '../types.js';
import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireRole(role: Role): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance, options: { secret: string }) => {
  await app.register(jwt, { secret: options.secret });
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'A valid demo access token is required');
    }
  });
  app.decorate('requireRole', (role: Role) => async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (request.user.role !== role) throw new AppError(403, 'FORBIDDEN', `${role} access is required`);
  });
});
