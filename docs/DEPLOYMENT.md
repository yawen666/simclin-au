# SimClin AU deployment guide

This guide describes the zero-cost internal-demo deployment for the current
1.0 architecture. It keeps the Fastify API and the Vue application separate:

```text
Browser -> Render Static Site (web) -> Render Web Service (Fastify API)
                                      -> DeepSeek API
                                      -> SQLite file
```

The included [`render.yaml`](../render.yaml) defines both Render services.
The service names are intentionally stable so the default URLs are:

- Frontend: `https://simclin-au-web.onrender.com`
- API: `https://simclin-au-api.onrender.com`

If you rename either service, update `WEB_ORIGIN` on the API and
`VITE_API_BASE_URL` on the web service before rebuilding.

## Before publishing the repository

1. Revoke the DeepSeek key that was used during development and create a new
   one. Never paste the replacement key into Git, a frontend variable, an issue,
   or a screenshot.
2. Confirm that `server/.env`, `server/data/*.db`, WAL files, uploads, logs,
   `dist/`, and test artifacts are not tracked. The root `.gitignore` already
   excludes these paths.
3. Keep `server/.env.example` and `web/.env.production.example` as templates
   containing placeholders only.
4. Enable GitHub Secret Scanning and Push Protection after creating the public
   repository.
5. Add the MIT license and keep the educational/non-clinical disclaimer visible
   in the repository README.

## Render deployment

1. Create a new public GitHub repository and push this project.
2. In Render, choose **New > Blueprint** and select the repository.
3. Review `render.yaml` and create the two services.
4. When Render asks for `DEEPSEEK_API_KEY`, enter the replacement key as a
   secret. It is marked `sync: false` so it is not stored in this repository.
5. Wait for the API health check at `/api/health`, then open the static-site
   URL.

The API must use `HOST=0.0.0.0`; Render supplies the runtime `PORT`. The
frontend is built with `VITE_API_BASE_URL`, while the API allows that origin via
`WEB_ORIGIN`.

## GitHub Pages product showcase

The public-facing introduction site is [`docs/index.html`](index.html). It is
a static, bilingual page with screenshots of the synthetic student and faculty
flows. The `Publish product site` workflow uploads the whole `docs/` directory
to GitHub Pages after a push to `main` or `master`.

After the first successful workflow run, enable **Settings > Pages > GitHub
Actions** if GitHub has not selected the workflow automatically. A project site
will normally be available at:

```text
https://<github-username>.github.io/<repository-name>/
```

This showcase is intentionally separate from the live application: GitHub
Pages displays the product story and screenshots, while the Render deployment
hosts the interactive Vue application and its API.

## Important free-tier limitation

The current app stores sessions, results, drafts, and uploads in SQLite under
the server filesystem. Render's free web service filesystem is ephemeral, so
these records can reset after a restart, redeploy, or instance recycle. This is
acceptable for a short demonstration, not for a real longitudinal student
pilot.

For persistent internal use, migrate the database layer from SQLite to a
managed PostgreSQL service such as Supabase Free, or run the API on a VM with a
persistent disk. The product data model and API contract should remain the
same, but the database adapter and deployment environment will change.

## Local production-like check

```bash
cp server/.env.example server/.env
# Set a real key only in server/.env, never in Git.
npm run build
NODE_ENV=production HOST=127.0.0.1 WEB_ORIGIN=http://localhost:5173 \
  npm --prefix server start
```

For the hosted demo, use the Render environment variables instead of putting
production values in local files.
