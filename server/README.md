# SimClin AU API

Python 3.12 / FastAPI / Uvicorn / native `sqlite3` backend for the SimClin AU 1.0 teaching loop. The migration preserves the REST response aliases, error envelope and SSE event contract used by the existing Vue 3 frontend.

## Run locally

From the repository root:

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/pip install -r server/requirements-dev.txt
cp server/.env.example server/.env   # only when no local file exists
npm install
npm --prefix web install
npm run dev
```

The API is available at `http://127.0.0.1:4100`; its health endpoint is `/api/health`. In development only, OpenAPI is available at `/api/docs`.

`DEEPSEEK_API_KEY` is read only by the Python process. `AI_PROVIDER=deepseek` is the default and fails explicitly when the key or provider fails. `AI_PROVIDER=mock` is deterministic and is intended only for automated tests. Neither mode logs or returns the key.

## Runtime design

- A short-lived `sqlite3.Connection` is opened per database operation with foreign keys enabled, `busy_timeout=5000`, WAL journalling and full synchronous writes.
- Schema bootstrap and seed import are idempotent. Existing case, rubric, session, evaluation and override tables remain compatible with the pre-migration database.
- Uvicorn must run with one worker. The durable state is in SQLite, while duplicate message/evaluation guards are intentionally process-local.
- Completing a session returns HTTP 202 and persists `evaluation_status=queued`. The background evaluator retries one transient provider failure. On startup, evaluations left `queued` or `running` are reclaimed; a process cancelled mid-evaluation changes the task back to `queued`.
- Failed student turns remain stored for audit, but are excluded from later AI context, visible transcripts, evidence and question counts.

## Environment variables

| Variable | Purpose | Local default |
| --- | --- | --- |
| `ENVIRONMENT` | `development`, `test` or `production` | `development` |
| `HOST` / `PORT` | Uvicorn bind address and port | `127.0.0.1` / `4100` |
| `DATABASE_PATH` | SQLite file; relative paths resolve from `server/` | `./data/simclin-au.db` |
| `JWT_SECRET` | Signs the demo-role JWT | development-only default |
| `FACULTY_DEMO_ACCESS_CODE` | Protects the built-in faculty identity; required in production | unset |
| `AI_PROVIDER` | `deepseek` or explicit test-only `mock` | `deepseek` |
| `AI_REQUESTS_PER_HOUR` | Per-client ceiling for patient, evaluator and preview model calls | `60` |
| `DEEPSEEK_API_KEY` | Server-only provider credential | unset |
| `DEEPSEEK_BASE_URL` | Provider API base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Model name recorded with each run | `deepseek-v4-pro` |
| `WEB_ORIGIN` | Comma-separated CORS origins | `http://localhost:5173` |
| `LOG_LEVEL` | API log level | `info` |

Production startup refuses the development JWT secret, a localhost `WEB_ORIGIN`, a missing/short faculty access code, or a missing DeepSeek key when the real provider is selected.

## API contract

All protected routes accept `Authorization: Bearer <token>`.

- `GET /api/health`
- `POST /api/auth/demo` — `{ "role": "student" | "faculty", "accessCode"?: string }`; the code is required for faculty when configured
- `GET /api/auth/me`
- `GET|POST /api/cases`, `GET|PATCH /api/cases/:id`
- `POST /api/cases/:id/publish|archive|preview|duplicate`
- `POST /api/cases/:id/preview/respond`
- `GET|POST /api/rubrics`, `GET|PATCH /api/rubrics/:id`
- `POST /api/rubrics/:id/publish|archive`
- `GET|POST /api/sessions`, `GET /api/sessions/:id`
- `POST /api/sessions/:id/messages` — accepts `{ "message": string }` or the legacy `{ "content": string }`; `/messages/stream` is retained as an alias
- `POST /api/sessions/:id/complete` — queues background evaluation and normally returns HTTP 202
- `GET /api/sessions/:id/result`
- `GET /api/history`
- `GET /api/results`, `GET /api/results/:evaluationId`
- `POST|PATCH /api/results/:evaluationId/override`
- `GET /api/insights`
- `POST /api/uploads/` — faculty multipart upload, PNG/JPEG/PDF up to 5 MB

SSE replies retain the frontend contract: `meta`, zero or more `delta`, then `complete` whose payload has `type: "done"`, or an `error` event. HTTP errors expose top-level `code` and `message` plus the nested `error` object expected by existing clients.

Published case and rubric versions are immutable for existing sessions. Editing creates a new current version; the public version changes only after an explicit publish action.

## Verification

From the repository root:

```bash
npm run lint:api
npm run build:api
npm run test:api
npm run test:e2e
npm run test:smoke:real
npm run test:regression:real
```

The API suite uses `pytest`, an isolated SQLite database and the injected mock provider. Browser tests start the FastAPI service against a temporary SQLite file. Real-model tests load `server/.env`; their output must remain status-only and must never include the provider credential.
