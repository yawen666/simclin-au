import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';

const allowed = new Set(['image/png', 'image/jpeg', 'application/pdf']);

export function uploadRoutes(directory: string): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', app.requireRole('faculty'));
    app.post('/', async (request, reply) => {
      const part = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
      if (!part) throw new AppError(400, 'FILE_REQUIRED', 'Attach one file');
      if (!allowed.has(part.mimetype)) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PNG, JPEG and PDF files are supported');
      fs.mkdirSync(directory, { recursive: true });
      const extension = part.mimetype === 'image/png' ? '.png' : part.mimetype === 'image/jpeg' ? '.jpg' : '.pdf';
      const filename = `${randomUUID()}${extension}`;
      await pipeline(part.file, fs.createWriteStream(path.join(directory, filename), { flags: 'wx' }));
      reply.code(201);
      return { file: { id: filename, originalName: part.filename, mimeType: part.mimetype, url: `/uploads/${filename}` } };
    });
  };
}
