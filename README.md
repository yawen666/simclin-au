# SimClin AU 1.0

SimClin AU is a local, English-first formative history-taking product with a Chinese/English interface option for Australian undergraduate medical education. It provides a complete demonstration loop for built-in student and faculty identities without registration; hosted faculty access is protected by a deployment-only access code.

## Included in 1.0

- Five synthetic, primarily internal-medicine cases for Years 2–4
- Streaming AI standardised-patient conversations powered by a server-side large language model
- Transcript-based assessment with a deterministic scoring and safety-rule layer
- Overall score, level, seven assessment domains, transcript evidence, missed safety questions and improvement goals
- Student case library, consultations, feedback and persistent practice history
- Faculty case authoring, structured patient facts, preview, versioning, publishing, duplication and archiving
- Faculty rubric authoring, weight validation, safety mappings, versioning, publishing and archiving
- Results review, audited educator score overrides and teaching insights
- One-click English / 中文 interface switch in the landing page and portal sidebar (clinical case and AI dialogue content stays in English)

Clinical summaries, differential diagnoses and management plans are intentionally out of scope for this version.

## Technology

- Web: Vue 3.5, TypeScript, Vite 8, Vue Router 4, Pinia 3, Axios, native Fetch/SSE, ECharts, Markdown-it, KaTeX and Highlight.js
- API: Python 3.12, FastAPI, Uvicorn, HTTPX, server-signed JWT and multipart support
- Data: Python's native `sqlite3`, connection-per-operation access, WAL mode, a five-second busy timeout, startup migration/bootstrap and JSON content columns
- AI: server-side large language model integration; the browser never receives the provider key

The Python API preserves the Vue application's existing REST and SSE contract. Patient replies still stream as `meta`, `delta`, `complete` (`type: done`) and `error` events, so the product workflow and visual design did not need to be rebuilt for the 1.0 backend migration.

## Run locally

Requirements: Python 3.12, Node.js 20.19+ or 22.12+ and npm.

The local model API key is configured in `server/.env` for this workspace. That file is ignored by Git.

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/pip install -r server/requirements-dev.txt
npm install
npm --prefix web install
cp server/.env.example server/.env   # only when server/.env does not already exist
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API health endpoint is [http://localhost:4100/api/health](http://localhost:4100/api/health).

Choose either built-in role on the landing page:

- Student: Alex Morgan
- Faculty: Dr Sarah Chen

Data persists in `server/data/simclin-au.db`. Startup seeding is idempotent and does not modify faculty-created drafts. The API runs as one Uvicorn worker: this is deliberate because SQLite and the in-process message/evaluation concurrency guards are designed for a single application process.

Completing a consultation queues its evaluation and immediately returns an `evaluating` state. Evaluation state is stored in SQLite; transient provider failures are retried once, and work left `queued` or `running` by a process restart is reclaimed at the next API startup. Students can leave the page and retrieve the result later from Practice history.

The hosted faculty identity is protected by a deployment-only access code, while patient, evaluator and faculty-preview model calls share a configurable per-client hourly budget. Student case responses expose only the student brief and learning objectives; hidden patient facts and assessment content remain server-side.

## Verification commands

```bash
npm run lint:api
npm run build
npm run test
npm run test:e2e
npm run test:smoke:real
npm run test:regression:real
```

`npm run test` runs the Python API tests and Vue unit tests. The browser suite uses an isolated temporary SQLite database and the explicit deterministic AI provider. The real-provider smoke test separately verifies authentication, a streamed patient response, background evaluation and structured scoring against the configured model. The real-provider regression repeats the actor/evaluator checks across all five supplied cases. Real-provider commands read `server/.env` without printing the key.

## Open-source and free deployment

The repository is prepared for a public GitHub repository and a two-service
Render deployment. `render.yaml` provisions a static Vue frontend and a
single-worker FastAPI service; the model API key is entered in Render as a secret and is never
bundled into the browser. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
publishing checklist, environment variables, and free-tier limitations.

The `docs/` directory also contains a standalone, bilingual product showcase
for GitHub Pages. The `Publish product site` workflow publishes it whenever
the `docs/` content changes.

The committed Blueprint still uses Render's free plan and is intended for a
short internal demonstration. Its filesystem is ephemeral, so SQLite records
and uploads can reset when the service is restarted, redeployed or recycled.
A stable longitudinal SQLite pilot requires explicit approval to move the API
to a paid Starter instance with a persistent disk mounted at `/var/data` and
`DATABASE_PATH=/var/data/simclin-au.db`.

## Safety and scope

- All supplied people and histories are fictional and contain no real patient data.
- The product is for formative undergraduate learning, not clinical care, diagnosis or summative assessment.
- AI scores are evidence-linked but remain reviewable by an educator.
- The five cases are clinically structured drafts grounded in Australian sources; they have not been signed off by a medical-school governance committee or specialist reviewer.
- Rotate model API credentials before wider sharing and on the organisation's normal secret-rotation schedule.

See the [product architecture](docs/PRODUCT-ARCHITECTURE.md), [AI prompt
design](docs/AI-MODEL-PROMPT-DESIGN.md), [internal trial checklist](docs/INTERNAL-TRIAL-CHECKLIST.md),
and the final [test report](docs/TEST-REPORT.md).
