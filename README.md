# SimClin AU 1.0

SimClin AU is a local, English-first formative history-taking product with a Chinese/English interface option for Australian undergraduate medical education. It provides a complete demonstration loop for a built-in student and faculty user without registration or passwords.

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
- API: Node.js, TypeScript ESM, Fastify 5, Zod, JWT and multipart support
- Data: SQLite through better-sqlite3, WAL mode, raw SQL, startup migration/bootstrap and JSON content columns
- AI: server-side large language model integration; the browser never receives the provider key

## Run locally

Requirements: Node.js 20 or newer and npm.

The local model API key is configured in `server/.env` for this workspace. That file is ignored by Git.

```bash
npm install
npm --prefix server install
npm --prefix web install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API health endpoint is [http://localhost:4100/api/health](http://localhost:4100/api/health).

Choose either built-in role on the landing page:

- Student: Alex Morgan
- Faculty: Dr Sarah Chen

Data persists in `server/data/simclin-au.db`. Startup seeding is idempotent and does not modify faculty-created drafts.

## Verification commands

```bash
npm run build
npm run test
npm run test:e2e
npm --prefix server run test:smoke:real
npm --prefix server run test:regression:real
```

The browser suite uses an isolated temporary SQLite database and the explicit deterministic AI provider. The real-provider smoke test separately verifies authentication, a streamed patient response, evaluation and structured scoring against the configured model. The real-provider regression repeats the actor/evaluator checks across all five supplied cases.

## Open-source and free deployment

The repository is prepared for a public GitHub repository and a two-service
Render deployment. `render.yaml` provisions a static Vue frontend and a
Fastify API; the model API key is entered in Render as a secret and is never
bundled into the browser. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
publishing checklist, environment variables, and free-tier limitations.

The `docs/` directory also contains a standalone, bilingual product showcase
for GitHub Pages. The `Publish product site` workflow publishes it whenever
the `docs/` content changes.

The free deployment is intended for a short internal demonstration. SQLite is
stored on the API filesystem, so records can reset when a free instance is
restarted or redeployed. Use a persistent PostgreSQL deployment before any
longitudinal student pilot.

## Safety and scope

- All supplied people and histories are fictional and contain no real patient data.
- The product is for formative undergraduate learning, not clinical care, diagnosis or summative assessment.
- AI scores are evidence-linked but remain reviewable by an educator.
- The five cases are clinically structured drafts grounded in Australian sources; they have not been signed off by a medical-school governance committee or specialist reviewer.
- Rotate the current model API key before wider sharing because it was supplied through a development conversation.

See the [product architecture](docs/PRODUCT-ARCHITECTURE.md), [AI prompt
design](docs/AI-MODEL-PROMPT-DESIGN.md), [internal trial checklist](docs/INTERNAL-TRIAL-CHECKLIST.md),
and the final [test report](docs/TEST-REPORT.md).
