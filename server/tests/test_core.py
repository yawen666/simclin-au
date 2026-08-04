from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app.ai import collect_permitted_facts, extract_json, validate_patient_reply
from app.config import load_settings
from app.database import DDL, Database
from app.errors import AppError
from app.rate_limit import SlidingWindowRateLimiter
from app.scoring import calculate_score
from app.security import create_token, decode_token


def test_database_seeding_is_idempotent_and_integral() -> None:
    database = Database(":memory:")
    database.initialise()
    database.initialise()
    with database.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 5
        assert connection.execute("SELECT COUNT(*) FROM rubrics").fetchone()[0] == 5
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 5
    assert database.integrity_check() == {"integrity": "ok", "foreignKeyErrors": []}
    database.close()


def test_legacy_node_database_migrates_without_rewriting_existing_records(tmp_path: Path) -> None:
    legacy_path = tmp_path / "legacy-node.sqlite3"
    legacy_ddl = DDL
    additive_columns = (
        "  rubric_id INTEGER REFERENCES rubrics(id),\n",
        "  metadata_json TEXT,\n",
        "  case_title_snapshot TEXT,\n",
        "  case_specialty_snapshot TEXT,\n",
        "  evaluation_attempts INTEGER NOT NULL DEFAULT 0,\n",
        "  evaluation_next_attempt_at TEXT,\n",
        "  evaluation_lease_until TEXT,\n",
        "  evaluation_updated_at TEXT,\n",
        "  client_message_id TEXT,\n",
        "  processing_expires_at TEXT,\n",
    )
    for definition in additive_columns:
        assert definition in legacy_ddl
        legacy_ddl = legacy_ddl.replace(definition, "", 1)
    legacy_ddl = legacy_ddl.replace(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
""",
        "",
        1,
    )
    connection = sqlite3.connect(legacy_path)
    try:
        connection.executescript(legacy_ddl)
        connection.execute(
            "INSERT INTO users VALUES (99,'legacy_student','Legacy Student','student','2025-01-01T00:00:00Z')"
        )
        connection.execute(
            """INSERT INTO cases VALUES
            (99,'legacy-case','Legacy title','Legacy specialty','Legacy setting','Legacy summary',
             'Intermediate',12,'published',1,1,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z',NULL)"""
        )
        content = json.dumps(
            {
                "openingStatement": "Legacy opening",
                "patient": {"name": "Legacy Patient", "age": 50},
                "caseData": {"atomicFacts": [{"id": "legacy.fact", "label": "Fact", "value": "Legacy fact value"}]},
            }
        )
        connection.execute(
            "INSERT INTO case_versions VALUES (99,99,1,?,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z')",
            (content,),
        )
        connection.execute(
            """INSERT INTO rubrics VALUES
            (99,'legacy-rubric','Legacy rubric','Legacy description','published',1,1,
             '2025-01-01T00:00:00Z','2025-01-01T00:00:00Z',NULL)"""
        )
        criteria = json.dumps([{"id": "legacy", "label": "Legacy", "weight": 100, "maxScore": 3}])
        connection.execute(
            "INSERT INTO rubric_versions VALUES (99,99,1,?,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z')",
            (criteria,),
        )
        connection.execute("INSERT INTO case_rubrics VALUES (99,99)")
        connection.execute(
            """INSERT INTO sessions VALUES
            (99,99,99,99,99,'completed','not_started',NULL,NULL,
             '2025-01-01T00:00:00Z','2025-01-01T00:10:00Z',600)"""
        )
        connection.execute(
            """INSERT INTO turns VALUES
            (99,99,1,'student','Legacy question','completed','[]','2025-01-01T00:01:00Z')"""
        )
        connection.execute(
            """INSERT INTO evaluations VALUES
            (99,99,NULL,75,'Competent','{}','{}','2025-01-01T00:10:00Z')"""
        )
        connection.commit()
    finally:
        connection.close()

    database = Database(str(legacy_path))
    database.initialise()
    with database.connection() as migrated:
        case = migrated.execute("SELECT * FROM cases WHERE id=99").fetchone()
        version = migrated.execute("SELECT * FROM case_versions WHERE id=99").fetchone()
        session = migrated.execute("SELECT * FROM sessions WHERE id=99").fetchone()
        turn = migrated.execute("SELECT * FROM turns WHERE id=99").fetchone()
        assert (case["slug"], case["title"], case["published_version"]) == ("legacy-case", "Legacy title", 1)
        assert version["content_json"] == content
        assert version["rubric_id"] == 99
        assert json.loads(version["metadata_json"])["title"] == "Legacy title"
        assert session["evaluation_status"] == "completed"
        assert session["case_title_snapshot"] == "Legacy title"
        assert session["case_specialty_snapshot"] == "Legacy specialty"
        assert (turn["content"], turn["status"]) == ("Legacy question", "completed")
        assert migrated.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 5
    assert database.integrity_check() == {"integrity": "ok", "foreignKeyErrors": []}
    database.close()


def test_seed_json_contains_stable_catalog() -> None:
    seed_path = Path(__file__).resolve().parents[1] / "data" / "seed-content.json"
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    assert len(seed["cases"]) == 5
    assert len(seed["rubrics"]) == 5
    assert all(item["slug"] for item in seed["cases"])
    assert all(sum(float(criterion["weight"]) for criterion in rubric["criteria"]) == 100 for rubric in seed["rubrics"])


def test_jwt_round_trip_and_tamper_rejection() -> None:
    secret = "a-long-test-secret"
    token = create_token({"sub": 1, "role": "student"}, secret)
    assert decode_token(token, secret)["sub"] == 1
    header, claims, signature = token.split(".")
    replacement = "A" if signature[0] != "A" else "B"
    tampered = f"{header}.{claims}.{replacement}{signature[1:]}"
    with pytest.raises(AppError) as caught:
        decode_token(tampered, secret)
    assert caught.value.status_code == 401
    with pytest.raises(AppError) as malformed:
        decode_token("a.a.a", secret)
    assert malformed.value.status_code == 401


def test_environment_precedence_and_production_ai_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("ENVIRONMENT", "test")
    assert load_settings().environment == "test"

    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        load_settings(
            {
                "environment": "production",
                "jwt_secret": "production-secret-at-least-32-characters",
                "web_origin": "https://simclin.example",
                "faculty_demo_access_code": "faculty-code-at-least-12-characters",
                "ai_provider": "deepseek",
                "deepseek_api_key": "",
            }
        )


def test_single_process_rate_limiter_returns_retry_window() -> None:
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    assert limiter.consume("student:test", 1) == 0
    assert 1 <= limiter.consume("student:test", 1) <= 60
    assert limiter.consume("student:other", 1) == 0


def test_json_extraction_and_patient_disclosure_guard() -> None:
    assert extract_json('```json\n{"ok":true}\n```') == {"ok": True}
    case = {
        "caseData": {
            "atomicFacts": [
                {"id": "visible", "label": "Onset", "value": "It started yesterday morning."},
                {"id": "hidden", "label": "Risk", "value": "A deliberately hidden clinical fact."},
            ]
        }
    }
    assert collect_permitted_facts(case, ["visible"])[0]["id"] == "visible"
    validate_patient_reply("It started yesterday morning.", case, ["visible"])
    with pytest.raises(AppError) as caught:
        validate_patient_reply("A deliberately hidden clinical fact.", case, ["visible"])
    assert caught.value.code == "AI_POLICY_VIOLATION"


def test_scoring_requires_student_evidence_and_applies_safety_cap() -> None:
    rubric = [
        {
            "id": "safety",
            "label": "Safety screening",
            "weight": 100,
            "maxScore": 3,
            "critical": True,
            "redFlagIds": ["rf.critical"],
        }
    ]
    raw = {
        "criteria": [{"criterion_id": "safety", "score": 3, "evidence_turn_ids": [9], "feedback": "Covered."}],
        "missed_red_flags": ["rf.critical"],
        "strengths": [],
        "improvements": [],
        "overall_feedback": "Review safety screening.",
    }
    without_evidence = calculate_score(raw, rubric, set())
    assert without_evidence["score"] == 0
    capped = calculate_score(raw, rubric, {9})
    assert capped["uncappedScore"] == 100
    assert capped["score"] == 59
    assert capped["capApplied"] == 59


def test_scoring_rejects_fractional_scores_and_duplicate_criteria() -> None:
    rubric = [
        {"id": "communication", "label": "Communication", "weight": 40},
        {"id": "safety", "label": "Safety", "weight": 60},
    ]
    base = {
        "missed_red_flags": [],
        "strengths": [],
        "improvements": [],
        "overall_feedback": "",
    }
    with pytest.raises(AppError) as fractional:
        calculate_score(
            {
                **base,
                "criteria": [
                    {"criterion_id": "communication", "score": 2.5, "evidence_turn_ids": [10]},
                    {"criterion_id": "safety", "score": 3, "evidence_turn_ids": [10]},
                ],
            },
            rubric,
            {10},
        )
    assert fractional.value.code == "AI_OUTPUT_VALIDATION"
    with pytest.raises(AppError, match="Criterion IDs must be unique"):
        calculate_score(
            {
                **base,
                "criteria": [
                    {"criterion_id": "communication", "score": 2, "evidence_turn_ids": [10]},
                    {"criterion_id": "communication", "score": 3, "evidence_turn_ids": [10]},
                ],
            },
            rubric,
            {10},
        )

    for invalid_criteria in (
        [{"criterion_id": "communication", "score": 2, "evidence_turn_ids": [10]}],
        [
            {"criterion_id": "communication", "score": 2, "evidence_turn_ids": [10]},
            {"criterion_id": "safety", "score": 3, "evidence_turn_ids": [10]},
            {"criterion_id": "invented", "score": 3, "evidence_turn_ids": [10]},
        ],
    ):
        with pytest.raises(AppError, match="every rubric criterion exactly once"):
            calculate_score({**base, "criteria": invalid_criteria}, rubric, {10})


def test_scoring_ignores_invented_red_flags_and_requires_disclosure_evidence() -> None:
    rubric = [
        {
            "id": "safety",
            "label": "Safety",
            "weight": 100,
            "critical": True,
            "redFlagIds": ["rf.known"],
        }
    ]
    base = {
        "criteria": [{"criterion_id": "safety", "score": 3, "evidence_turn_ids": [10]}],
        "strengths": [],
        "improvements": [],
        "overall_feedback": "",
    }
    invented = calculate_score({**base, "missed_red_flags": ["rf.invented"]}, rubric, {10})
    assert invented["score"] == 100
    assert invented["feedback"]["missed_red_flags"] == []

    question_only = calculate_score(
        {**base, "missed_red_flags": ["rf.known"]},
        rubric,
        {10},
        case_content={
            "caseData": {
                "atomicFacts": [{"id": "fact.safety", "triggers": ["chest pain"]}],
                "redFlags": [{"id": "rf.known", "linkedFactIds": ["fact.safety"]}],
            }
        },
        transcript=[{"speaker": "student", "content": "Have you had any chest pain?", "status": "completed"}],
    )
    assert question_only["score"] == 59
    assert question_only["feedback"]["missed_red_flags"] == ["rf.known"]

    disclosed = calculate_score(
        {**base, "missed_red_flags": ["rf.known"]},
        rubric,
        {10},
        case_content={
            "caseData": {
                "atomicFacts": [{"id": "fact.safety", "triggers": ["chest pain"]}],
                "redFlags": [{"id": "rf.known", "linkedFactIds": ["fact.safety"]}],
            }
        },
        transcript=[
            {"speaker": "student", "content": "Have you had any chest pain?", "status": "completed"},
            {
                "speaker": "patient",
                "content": "Yes, I have.",
                "status": "completed",
                "disclosedFactIds": ["fact.safety"],
            },
        ],
    )
    assert disclosed["score"] == 100
    assert disclosed["feedback"]["missed_red_flags"] == []


def test_scoring_preserves_auditable_weighted_rounding() -> None:
    rubric = [
        {"id": "communication", "label": "Communication", "weight": 40},
        {"id": "safety", "label": "Safety", "weight": 60},
    ]
    result = calculate_score(
        {
            "criteria": [
                {"criterion_id": "communication", "score": 1, "evidence_turn_ids": [10]},
                {"criterion_id": "safety", "score": 0, "evidence_turn_ids": []},
            ],
            "missed_red_flags": [],
        },
        rubric,
        {10},
    )
    assert result["criteria"][0]["weightedScore"] == 13.3333
    assert result["uncappedScore"] == 13.33
    assert result["score"] == 13
    assert "nearest whole point" in result["feedback"]["scoring"]["roundingRule"]
