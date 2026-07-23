import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nowIso } from '../lib/json.js';
import { seedCases, seedRubrics } from './seed-content.js';

export type AppDatabase = Database.Database;

const ddl = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','faculty')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  specialty TEXT NOT NULL,
  setting TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'Intermediate',
  estimated_minutes INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS case_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(case_id, version)
);
CREATE TABLE IF NOT EXISTS rubrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS rubric_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rubric_id INTEGER NOT NULL REFERENCES rubrics(id),
  version INTEGER NOT NULL,
  criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(rubric_id, version)
);
CREATE TABLE IF NOT EXISTS case_rubrics (
  case_id INTEGER PRIMARY KEY REFERENCES cases(id),
  rubric_id INTEGER NOT NULL REFERENCES rubrics(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  case_version_id INTEGER NOT NULL REFERENCES case_versions(id),
  rubric_version_id INTEGER NOT NULL REFERENCES rubric_versions(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_seconds INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK(speaker IN ('student','patient','system')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  disclosed_facts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence)
);
CREATE TABLE IF NOT EXISTS model_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id),
  model_run_id INTEGER REFERENCES model_runs(id),
  score REAL NOT NULL,
  level TEXT NOT NULL,
  feedback_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS criterion_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  criterion_id TEXT NOT NULL,
  score REAL NOT NULL,
  weighted_score REAL NOT NULL,
  evidence_turn_ids_json TEXT NOT NULL DEFAULT '[]',
  feedback TEXT NOT NULL DEFAULT '',
  UNIQUE(evaluation_id, criterion_id)
);
CREATE TABLE IF NOT EXISTS teacher_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  faculty_user_id INTEGER NOT NULL REFERENCES users(id),
  previous_score REAL NOT NULL,
  override_score REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_model_runs_session ON model_runs(session_id, created_at);
`;

export function createDatabase(filename: string): AppDatabase {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(ddl);
  ensureColumn(db, 'cases', 'published_version', 'INTEGER');
  ensureColumn(db, 'rubrics', 'published_version', 'INTEGER');
  ensureColumn(db, 'turns', 'status', "TEXT NOT NULL DEFAULT 'completed'");
  seedDatabase(db);
  return db;
}

function ensureColumn(db: AppDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function seedDatabase(db: AppDatabase): void {
  const now = nowIso();
  const seed = db.transaction(() => {
    const addUser = db.prepare('INSERT OR IGNORE INTO users (username,display_name,role,created_at) VALUES (?,?,?,?)');
    addUser.run('demo_student', 'Alex Morgan', 'student', now);
    addUser.run('demo_faculty', 'Dr Sarah Chen', 'faculty', now);

    const addCase = db.prepare(`INSERT OR IGNORE INTO cases
      (slug,title,specialty,setting,summary,difficulty,estimated_minutes,status,current_version,published_version,created_at,updated_at)
      VALUES (@slug,@title,@specialty,@setting,@summary,@difficulty,@estimatedMinutes,'published',1,1,@now,@now)`);
    const addCaseVersion = db.prepare(`INSERT OR IGNORE INTO case_versions
      (case_id,version,content_json,created_at,published_at) VALUES (?,1,?,?,?)`);
    for (const item of seedCases) {
      addCase.run({
        slug: item.slug, title: item.title, specialty: item.specialty,
        setting: item.setting ?? '', summary: item.summary ?? '', difficulty: item.difficulty ?? 'Intermediate',
        estimatedMinutes: item.estimatedMinutes ?? 12, now,
      });
      const row = db.prepare('SELECT id FROM cases WHERE slug=?').get(item.slug) as { id: number };
      addCaseVersion.run(row.id, JSON.stringify(item), now, now);
    }

    const addRubric = db.prepare(`INSERT OR IGNORE INTO rubrics
      (slug,name,description,status,current_version,published_version,created_at,updated_at)
      VALUES (@slug,@name,@description,'published',1,1,@now,@now)`);
    const addRubricVersion = db.prepare(`INSERT OR IGNORE INTO rubric_versions
      (rubric_id,version,criteria_json,created_at,published_at) VALUES (?,1,?,?,?)`);
    for (const item of seedRubrics) {
      addRubric.run({ slug: item.slug, name: item.name, description: item.description ?? '', now });
      const row = db.prepare('SELECT id FROM rubrics WHERE slug=?').get(item.slug) as { id: number };
      addRubricVersion.run(row.id, JSON.stringify(item.criteria), now, now);
    }
    db.prepare("UPDATE cases SET published_version=current_version WHERE status='published' AND published_version IS NULL").run();
    db.prepare("UPDATE rubrics SET published_version=current_version WHERE status='published' AND published_version IS NULL").run();

    const defaultRubric = db.prepare('SELECT id FROM rubrics ORDER BY id LIMIT 1').get() as { id: number } | undefined;
    if (defaultRubric) {
      const link = db.prepare('INSERT OR IGNORE INTO case_rubrics (case_id,rubric_id) VALUES (?,?)');
      // Bootstrap only product-owned seed cases. Never mutate a faculty-created
      // draft merely because the application restarted.
      for (const seedCase of seedCases) {
        const caseRow = db.prepare('SELECT id FROM cases WHERE slug=?').get(seedCase.slug) as { id: number } | undefined;
        if (!caseRow) continue;
        const matched = db.prepare('SELECT id FROM rubrics WHERE slug=?').get(seedCase.slug) as { id: number } | undefined;
        link.run(caseRow.id, matched?.id ?? defaultRubric.id);
      }
    }
  });
  seed();
}
