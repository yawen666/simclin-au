from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Generator, Iterable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .identities import synthetic_student_name
from .utils import compact_json, now_iso

DDL = """
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
  rubric_id INTEGER REFERENCES rubrics(id),
  metadata_json TEXT,
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
  case_title_snapshot TEXT,
  case_specialty_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  evaluation_status TEXT NOT NULL DEFAULT 'not_started',
  evaluation_error TEXT,
  evaluation_started_at TEXT,
  evaluation_attempts INTEGER NOT NULL DEFAULT 0,
  evaluation_next_attempt_at TEXT,
  evaluation_lease_until TEXT,
  evaluation_updated_at TEXT,
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
  client_message_id TEXT,
  processing_expires_at TEXT,
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
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
"""

SCHEMA_VERSION = 5


class Database:
    """Small connection-per-operation SQLite adapter safe for FastAPI threads."""

    def __init__(self, path: str, seed_path: Path | None = None) -> None:
        self.path = path
        self.seed_path = seed_path or Path(__file__).resolve().parents[1] / "data" / "seed-content.json"
        self._init_lock = threading.Lock()
        self._initialised = False
        self._keeper: sqlite3.Connection | None = None
        if path == ":memory:":
            self._target = f"file:simclin-{uuid.uuid4().hex}?mode=memory&cache=shared"
            self._uri = True
            self._keeper = self._new_connection()
        else:
            self._target = path
            self._uri = False

    def _new_connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._target, uri=self._uri, timeout=5, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        if self.path != ":memory:":
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = FULL")
        return connection

    @contextmanager
    def connection(self, write: bool = False) -> Generator[sqlite3.Connection, None, None]:
        connection = self._new_connection()
        try:
            yield connection
            if write:
                connection.commit()
        except Exception:
            if write:
                connection.rollback()
            raise
        finally:
            connection.close()

    def initialise(self) -> None:
        with self._init_lock:
            if self._initialised:
                return
            if self.path != ":memory:":
                Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            with self.connection(write=True) as connection:
                migrations_table = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
                ).fetchone()
                if migrations_table is not None:
                    newest = connection.execute("SELECT MAX(version) AS version FROM schema_migrations").fetchone()[
                        "version"
                    ]
                    if newest is not None and int(newest) > SCHEMA_VERSION:
                        raise RuntimeError(
                            f"Database schema version {newest} is newer than supported version {SCHEMA_VERSION}"
                        )
                connection.executescript(DDL)
                self._ensure_column(connection, "cases", "published_version", "INTEGER")
                self._ensure_column(connection, "rubrics", "published_version", "INTEGER")
                self._ensure_column(connection, "case_versions", "rubric_id", "INTEGER REFERENCES rubrics(id)")
                self._ensure_column(connection, "case_versions", "metadata_json", "TEXT")
                self._ensure_column(connection, "turns", "status", "TEXT NOT NULL DEFAULT 'completed'")
                self._ensure_column(connection, "sessions", "evaluation_status", "TEXT NOT NULL DEFAULT 'not_started'")
                self._ensure_column(connection, "sessions", "evaluation_error", "TEXT")
                self._ensure_column(connection, "sessions", "evaluation_started_at", "TEXT")
                self._ensure_column(connection, "sessions", "evaluation_attempts", "INTEGER NOT NULL DEFAULT 0")
                self._ensure_column(connection, "sessions", "evaluation_next_attempt_at", "TEXT")
                self._ensure_column(connection, "sessions", "evaluation_lease_until", "TEXT")
                self._ensure_column(connection, "sessions", "evaluation_updated_at", "TEXT")
                self._ensure_column(connection, "sessions", "case_title_snapshot", "TEXT")
                self._ensure_column(connection, "sessions", "case_specialty_snapshot", "TEXT")
                self._ensure_column(connection, "turns", "client_message_id", "TEXT")
                self._ensure_column(connection, "turns", "processing_expires_at", "TEXT")
                # A process that stopped during an SSE response can leave a
                # pending student turn behind. It was never shown as a
                # completed exchange and must not block the recovered app.
                connection.execute("UPDATE turns SET status='failed' WHERE status='pending'")
                connection.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_client_message
                    ON turns(session_id, client_message_id) WHERE client_message_id IS NOT NULL
                """)
                connection.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_one_pending_student
                    ON turns(session_id) WHERE speaker='student' AND status='pending'
                """)
                connection.execute("""
                    UPDATE sessions SET evaluation_status='completed'
                    WHERE evaluation_status='not_started'
                      AND EXISTS (SELECT 1 FROM evaluations WHERE evaluations.session_id=sessions.id)
                """)
                self._seed(connection)
                anonymous_students = connection.execute(
                    "SELECT id,username FROM users WHERE username GLOB 'demo_student_*'"
                ).fetchall()
                for student in anonymous_students:
                    digest = student["username"].removeprefix("demo_student_")
                    if len(digest) >= 8 and all(character in "0123456789abcdef" for character in digest[:8].lower()):
                        connection.execute(
                            "UPDATE users SET display_name=? WHERE id=?",
                            (synthetic_student_name(digest), student["id"]),
                        )
                connection.execute("""
                    UPDATE case_versions
                    SET rubric_id=(
                      SELECT cr.rubric_id FROM case_rubrics cr
                      WHERE cr.case_id=case_versions.case_id
                    )
                    WHERE rubric_id IS NULL
                """)
                missing_metadata = connection.execute("""
                    SELECT cv.id,c.title,c.specialty,c.setting,c.summary,c.difficulty,c.estimated_minutes
                    FROM case_versions cv JOIN cases c ON c.id=cv.case_id
                    WHERE cv.metadata_json IS NULL
                """).fetchall()
                for row in missing_metadata:
                    connection.execute(
                        "UPDATE case_versions SET metadata_json=? WHERE id=?",
                        (
                            compact_json(
                                {
                                    "title": row["title"],
                                    "specialty": row["specialty"],
                                    "setting": row["setting"],
                                    "summary": row["summary"],
                                    "difficulty": row["difficulty"],
                                    "estimated_minutes": row["estimated_minutes"],
                                }
                            ),
                            row["id"],
                        ),
                    )
                connection.execute("""
                    UPDATE sessions
                    SET case_title_snapshot=(SELECT title FROM cases WHERE cases.id=sessions.case_id)
                    WHERE case_title_snapshot IS NULL
                """)
                connection.execute("""
                    UPDATE sessions
                    SET case_specialty_snapshot=(SELECT specialty FROM cases WHERE cases.id=sessions.case_id)
                    WHERE case_specialty_snapshot IS NULL
                """)
                connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (?,?)",
                    (SCHEMA_VERSION, now_iso()),
                )
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                foreign_key_error = connection.execute("PRAGMA foreign_key_check").fetchone()
                if integrity != "ok" or foreign_key_error is not None:
                    raise RuntimeError("SQLite integrity validation failed during startup")
            self._initialised = True

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _seed(self, connection: sqlite3.Connection) -> None:
        seed = json.loads(self.seed_path.read_text(encoding="utf-8"))
        now = now_iso()
        connection.execute(
            "INSERT OR IGNORE INTO users (username,display_name,role,created_at) VALUES (?,?,?,?)",
            ("demo_student", "Alex Morgan", "student", now),
        )
        connection.execute(
            "INSERT OR IGNORE INTO users (username,display_name,role,created_at) VALUES (?,?,?,?)",
            ("demo_faculty", "Dr Sarah Chen", "faculty", now),
        )
        for item in seed["cases"]:
            connection.execute(
                """
                INSERT OR IGNORE INTO cases
                (slug,title,specialty,setting,summary,difficulty,estimated_minutes,status,current_version,published_version,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,'published',1,1,?,?)
            """,
                (
                    item["slug"],
                    item["title"],
                    item["specialty"],
                    item.get("setting", ""),
                    item.get("summary", ""),
                    item.get("difficulty", "Intermediate"),
                    item.get("estimatedMinutes", 12),
                    now,
                    now,
                ),
            )
            case_id = connection.execute("SELECT id FROM cases WHERE slug=?", (item["slug"],)).fetchone()["id"]
            connection.execute(
                """
                INSERT OR IGNORE INTO case_versions (case_id,version,content_json,created_at,published_at)
                VALUES (?,1,?,?,?)
            """,
                (case_id, compact_json(item), now, now),
            )
        for item in seed["rubrics"]:
            connection.execute(
                """
                INSERT OR IGNORE INTO rubrics
                (slug,name,description,status,current_version,published_version,created_at,updated_at)
                VALUES (?,?,?,'published',1,1,?,?)
            """,
                (item["slug"], item["name"], item.get("description", ""), now, now),
            )
            rubric_id = connection.execute("SELECT id FROM rubrics WHERE slug=?", (item["slug"],)).fetchone()["id"]
            connection.execute(
                """
                INSERT OR IGNORE INTO rubric_versions (rubric_id,version,criteria_json,created_at,published_at)
                VALUES (?,1,?,?,?)
            """,
                (rubric_id, compact_json(item["criteria"]), now, now),
            )
        connection.execute(
            "UPDATE cases SET published_version=current_version WHERE status='published' AND published_version IS NULL"
        )
        connection.execute(
            "UPDATE rubrics SET published_version=current_version WHERE status='published' AND published_version IS NULL"
        )
        default = connection.execute("SELECT id FROM rubrics ORDER BY id LIMIT 1").fetchone()
        if default:
            for seed_case in seed["cases"]:
                case_row = connection.execute("SELECT id FROM cases WHERE slug=?", (seed_case["slug"],)).fetchone()
                matched = connection.execute("SELECT id FROM rubrics WHERE slug=?", (seed_case["slug"],)).fetchone()
                if case_row:
                    connection.execute(
                        "INSERT OR IGNORE INTO case_rubrics (case_id,rubric_id) VALUES (?,?)",
                        (case_row["id"], matched["id"] if matched else default["id"]),
                    )

    def close(self) -> None:
        if self._keeper is not None:
            self._keeper.close()
            self._keeper = None

    def integrity_check(self) -> dict[str, Any]:
        with self.connection() as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = [dict(row) for row in connection.execute("PRAGMA foreign_key_check")]
        return {"integrity": integrity, "foreignKeyErrors": foreign_keys}


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]
