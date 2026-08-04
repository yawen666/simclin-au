import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = resolve(tmpdir(), 'simclin-au-e2e.db')
const python = process.env.SIMCLIN_PYTHON || resolve(projectRoot, 'server/.venv/bin/python')

// This is an explicitly scoped, test-only database. Removing all three SQLite
// files makes every Playwright run independent from previous local activity.
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${databasePath}${suffix}`, { force: true })
}

const build = spawnSync(python, ['-m', 'compileall', '-q', 'server/app'], {
  cwd: projectRoot,
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const child = spawn(python, [
  '-m', 'uvicorn', 'app.main:app', '--app-dir', 'server',
  '--host', '127.0.0.1', '--port', '4000', '--workers', '1',
], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ENVIRONMENT: 'test',
    HOST: '127.0.0.1',
    PORT: '4000',
    DATABASE_PATH: databasePath,
    JWT_SECRET: 'simclin-e2e-isolated-jwt-secret',
    FACULTY_DEMO_ACCESS_CODE: 'simclin-e2e-faculty-code',
    AI_PROVIDER: 'mock',
    DEEPSEEK_API_KEY: '',
    LOG_LEVEL: 'warn',
    WEB_ORIGIN: 'http://127.0.0.1:5178',
  },
})

const stop = (signal) => {
  if (!child.killed) child.kill(signal)
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
