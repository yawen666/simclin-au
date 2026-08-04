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
- On Render, [Uvicorn's native proxy-header support](https://www.uvicorn.org/settings/#http) makes `request.client` contain the real client IP used by request limits. The Blueprint trusts all immediate proxy peers only because [Render documents](https://render.com/docs/web-services#port-binding) that the bound public HTTP port is not directly reachable from the internet and inbound traffic is forwarded by its managed load balancer. Do not reuse `--forwarded-allow-ips "*"` on a host whose Uvicorn port is directly reachable; supply only that deployment's trusted proxy IPs/networks instead. Application code never parses `X-Forwarded-For` itself.
- Completing a session returns HTTP 202 and persists `evaluation_status=queued`. The background evaluator retries one transient provider failure. On startup, evaluations left `queued` or `running` are reclaimed; a process cancelled mid-evaluation changes the task back to `queued`.
- Failed student turns remain stored for audit, but are excluded from later AI context, visible transcripts, evidence and question counts.

## Environment variables

| Variable | Purpose | Local default |
| --- | --- | --- |
| `ENVIRONMENT` | `development`, `test` or `production` | `development` |
| `HOST` / `PORT` | Uvicorn bind address and port | `127.0.0.1` / `4100` |
| `DATABASE_PATH` | SQLite file; relative paths resolve from `server/` | `./data/simclin-au.db` |
| `JWT_SECRET` | Signs the browser-scoped student and faculty JWTs | development-only default |
| `FACULTY_DEMO_ACCESS_CODE` | Protects the built-in faculty identity; required in production | unset |
| `AI_PROVIDER` | `deepseek` or explicit test-only `mock` | `deepseek` |
| `AI_REQUESTS_PER_HOUR` | Per-authenticated-user ceiling for patient, evaluator and preview workflow requests | `60` |
| `AI_REQUESTS_PER_IP_PER_HOUR` | Shared ceiling across users from one client IP; must be at least the user ceiling | `180` |
| `AI_GLOBAL_REQUESTS_PER_HOUR` | Process-wide ceiling across all clients | `360` |
| `AUTH_REQUESTS_PER_IP_PER_HOUR` | Pre-database sign-in request gate per real client IP | `120` |
| `AUTH_GLOBAL_REQUESTS_PER_HOUR` | Pre-database sign-in request gate process-wide | `1200` |
| `ANONYMOUS_PROFILES_PER_IP_PER_HOUR` | New browser-scoped student profiles allowed per IP per hour | `20` |
| `ANONYMOUS_PROFILES_GLOBAL_PER_HOUR` | New student profiles allowed process-wide per hour | `200` |
| `MAX_ANONYMOUS_STUDENT_PROFILES` | Hard cap on saved anonymous student identities | `5000` |
| `SESSION_REQUESTS_PER_USER_PER_HOUR` | Pre-write session-create request gate per student | `60` |
| `SESSION_REQUESTS_PER_IP_PER_HOUR` | Pre-write session-create request gate per real client IP | `240` |
| `SESSION_GLOBAL_REQUESTS_PER_HOUR` | Pre-write session-create request gate process-wide | `1000` |
| `SESSION_STARTS_PER_USER_PER_HOUR` | New practice sessions allowed per student per hour | `30` |
| `SESSION_STARTS_PER_IP_PER_HOUR` | New practice sessions allowed per IP per hour | `120` |
| `SESSION_STARTS_GLOBAL_PER_HOUR` | New practice sessions allowed process-wide per hour | `500` |
| `MAX_SESSIONS_PER_STUDENT` | Hard cap on saved sessions for one anonymous student | `100` |
| `MAX_TOTAL_SESSIONS` | Hard cap on saved sessions in the SQLite database | `50000` |
| `DEEPSEEK_API_KEY` | Server-only provider credential | unset |
| `DEEPSEEK_BASE_URL` | Provider API base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Model name recorded with each run | `deepseek-v4-pro` |
| `WEB_ORIGIN` | Comma-separated CORS origins | `http://localhost:5173` |
| `LOG_LEVEL` | API log level | `info` |

Production startup refuses the development JWT secret, a localhost `WEB_ORIGIN`, a missing/short faculty access code, or a missing DeepSeek key when the real provider is selected.

## API contract

All protected routes accept `Authorization: Bearer <token>`.

- `GET /api/health`
- `POST /api/auth/demo` — `{ "role": "student" | "faculty", "visitorId"?: string, "accessCode"?: string }`; web students use a stable browser-scoped visitor ID and the code is required for faculty when configured
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
npm run test:e2e:online:real
```

The API suite uses `pytest`, an isolated SQLite database and the injected mock provider. Browser tests start the FastAPI service against a temporary SQLite file. Local real-model tests load `server/.env`; the online E2E command instead targets the Render API and never reads a model key. Their output remains status-only and never includes provider credentials, authentication tokens or model response text.
