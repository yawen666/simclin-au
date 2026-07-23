# SimClin AU API

Node.js 20+ / TypeScript ESM / Fastify 5 / SQLite backend for the local SimClin AU 1.0 teaching loop.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

`DEEPSEEK_API_KEY` is read only on the server. `AI_PROVIDER=deepseek` is the default and fails explicitly when the key/provider fails. `AI_PROVIDER=mock` is deterministic and intended only for automated browser regression.

## API contract

All protected routes accept `Authorization: Bearer <token>`.

- `GET /api/health`
- `POST /api/auth/demo` — `{ "role": "student" | "faculty" }`
- `GET /api/auth/me`
- `GET|POST /api/cases`, `GET|PATCH /api/cases/:id`
- `POST /api/cases/:id/publish`, `POST /api/cases/:id/archive`
- `GET|POST /api/rubrics`, `GET|PATCH /api/rubrics/:id`
- `POST /api/rubrics/:id/publish`, `POST /api/rubrics/:id/archive`
- `POST /api/sessions` — `{ "caseId": number }`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/messages` — `{ "message": string }`, returns SSE `meta`, `delta`, `complete` or `error`
- `POST /api/sessions/:id/complete`
- `GET /api/sessions/:id/result`
- `GET /api/history`
- `GET /api/results`, `GET /api/results/:evaluationId`
- `POST /api/results/:evaluationId/override` — `{ "score": 0..100, "reason": string }`
- `GET /api/insights`
- `POST /api/uploads` — faculty multipart upload, PNG/JPEG/PDF up to 5 MB

Published case and rubric versions are immutable for existing sessions. Editing creates a new current version; the public version changes only after an explicit publish action.

## Verification

```bash
npm run typecheck
npm test
AI_PROVIDER=mock npm run dev
npm run test:smoke:real
```

The real smoke command uses the configured secret but prints only a status, score and criterion count.
