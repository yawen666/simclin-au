from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from conftest import login
from fastapi.testclient import TestClient

from app.ai import MockAiProvider
from app.config import load_settings
from app.database import SCHEMA_VERSION, Database
from app.main import create_app
from app.security import create_token
from app.utils import now_iso

TEST_JWT_SECRET = "v1-hardening-test-secret-at-least-32-characters"
ALLOWED_ORIGIN = "http://localhost:5173"


def _settings(**overrides: Any) -> Any:
    values: dict[str, Any] = {
        "environment": "test",
        "database_path": ":memory:",
        "jwt_secret": TEST_JWT_SECRET,
        "ai_provider": "mock",
        "deepseek_api_key": "",
        "web_origin": ALLOWED_ORIGIN,
    }
    values.update(overrides)
    return load_settings(values)


def _student_login(client: TestClient, visitor_id: str) -> tuple[dict[str, str], dict[str, Any]]:
    response = client.post(
        "/api/auth/demo",
        json={"role": "student", "visitorId": visitor_id},
    )
    assert response.status_code == 200
    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]


def _start_session(client: TestClient, headers: dict[str, str], case_id: int | None = None) -> int:
    if case_id is None:
        catalog = client.get("/api/cases", headers=headers)
        assert catalog.status_code == 200
        case_id = int(catalog.json()["cases"][0]["id"])
    response = client.post("/api/sessions", headers=headers, json={"caseId": case_id})
    assert response.status_code == 201
    return int(response.json()["id"])


def _complete_rubric_payload(slug: str) -> dict[str, Any]:
    return {
        "slug": slug,
        "name": "Complete hardening rubric",
        "description": "A complete synthetic rubric used only for API contract testing.",
        "criteria": [
            {
                "id": "history",
                "label": "Focused history",
                "description": "Obtains a focused and structured history from the simulated patient.",
                "weight": 100,
                "maxScore": 3,
                "redFlagIds": [],
                "anchors": {
                    "0": "Not demonstrated.",
                    "1": "Partially demonstrated with major omissions.",
                    "2": "Mostly demonstrated with one important omission.",
                    "3": "Demonstrated comprehensively and efficiently.",
                },
            }
        ],
    }


def _complete_case_content() -> dict[str, Any]:
    return {
        "openingStatement": "I have come in because I have felt unwell today.",
        "patient": {"name": "Synthetic Patient", "age": 42},
        "caseData": {
            "candidateInstructions": "Take a focused history from this simulated patient.",
            "presentingComplaint": "A new symptom requiring a focused clinical history.",
            "atomicFacts": [
                {
                    "id": "history.onset",
                    "label": "Onset",
                    "value": "The symptom began earlier today.",
                    "category": "history",
                    "disclosureLevel": "direct_question",
                    "triggers": ["when did it start"],
                }
            ],
            "redFlags": [],
            "learningObjectives": [],
            "patientActorRules": [],
        },
    }


def test_visitor_identity_is_stable_and_sessions_are_isolated(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    first_headers, first_user = _student_login(client, "visitor-hardening-a-0001")
    repeated_headers, repeated_user = _student_login(client, "visitor-hardening-a-0001")
    other_headers, other_user = _student_login(client, "visitor-hardening-b-0002")

    assert repeated_user["id"] == first_user["id"]
    assert repeated_user["username"] == first_user["username"]
    assert other_user["id"] != first_user["id"]
    assert other_user["username"] != first_user["username"]

    session_id = _start_session(client, first_headers)
    repeated_list = client.get("/api/sessions", headers=repeated_headers)
    other_list = client.get("/api/sessions", headers=other_headers)
    assert repeated_list.status_code == 200
    assert [item["id"] for item in repeated_list.json()["sessions"]] == [session_id]
    assert other_list.status_code == 200
    assert other_list.json()["sessions"] == []

    assert client.get(f"/api/sessions/{session_id}", headers=other_headers).status_code == 404
    blocked_message = client.post(
        f"/api/sessions/{session_id}/messages",
        headers=other_headers,
        json={"message": "When did the symptom begin?"},
    )
    assert blocked_message.status_code == 404


@pytest.mark.parametrize(
    "claim_changes",
    [
        {"role": "faculty"},
        {"username": "a-different-database-username"},
    ],
)
def test_signed_jwt_claims_must_match_the_database_user(
    api: tuple[TestClient, Database],
    claim_changes: dict[str, str],
) -> None:
    client, _database = api
    _headers, user = _student_login(client, "visitor-jwt-hardening-0001")
    claims = {
        "sub": user["id"],
        "username": user["username"],
        "displayName": user["displayName"],
        "role": user["role"],
        **claim_changes,
    }
    test_secret = client.app.state.settings.jwt_secret
    forged_headers = {"Authorization": f"Bearer {create_token(claims, test_secret)}"}

    response = client.get("/api/auth/me", headers=forged_headers)
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHENTICATED"


def test_students_cannot_read_rubric_definitions(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    headers, _user = _student_login(client, "visitor-rubric-boundary-0001")

    rubric_list = client.get("/api/rubrics", headers=headers)
    rubric_detail = client.get("/api/rubrics/1", headers=headers)
    assert rubric_list.status_code == 403
    assert rubric_detail.status_code == 403
    assert rubric_list.json()["code"] == "FORBIDDEN"
    assert rubric_detail.json()["code"] == "FORBIDDEN"


def test_oversized_request_keeps_cors_headers(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    response = client.post(
        "/api/auth/demo",
        content=b"x" * (1024 * 1024 + 1),
        headers={"Content-Type": "application/json", "Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 413
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN


def test_client_message_id_replays_without_duplicate_turns_or_model_calls() -> None:
    class CountingProvider(MockAiProvider):
        def __init__(self) -> None:
            self.planner_calls = 0
            self.actor_calls = 0

        async def plan_disclosure(self, **kwargs: Any) -> dict[str, Any]:
            self.planner_calls += 1
            return await super().plan_disclosure(**kwargs)

        async def stream_patient_reply(self, **kwargs: Any):  # type: ignore[no-untyped-def]
            self.actor_calls += 1
            async for chunk in super().stream_patient_reply(**kwargs):
                yield chunk

    provider = CountingProvider()
    database = Database(":memory:")
    application = create_app(settings=_settings(), database=database, ai_provider=provider)
    client_message_id = "message-hardening-0001"
    question = "When did the symptom begin?"
    try:
        with TestClient(application) as client:
            headers, _user = _student_login(client, "visitor-message-replay-0001")
            session_id = _start_session(client, headers)
            first = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": question, "clientMessageId": client_message_id},
            )
            replay = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": question, "clientMessageId": client_message_id},
            )

            assert first.status_code == 200
            assert replay.status_code == 200
            assert '"replayed":true' in replay.text
            assert provider.planner_calls == 1
            assert provider.actor_calls == 1
            with database.connection() as connection:
                turn_count = connection.execute(
                    "SELECT COUNT(*) AS count FROM turns WHERE session_id=?",
                    (session_id,),
                ).fetchone()["count"]
                keyed_turns = connection.execute(
                    "SELECT COUNT(*) AS count FROM turns WHERE session_id=? AND client_message_id=?",
                    (session_id, client_message_id),
                ).fetchone()["count"]
                model_call_count = connection.execute(
                    """SELECT COUNT(*) AS count FROM model_runs
                    WHERE session_id=? AND purpose IN ('disclosure-planner','patient-actor')""",
                    (session_id,),
                ).fetchone()["count"]
            assert turn_count == 3
            assert keyed_turns == 1
            assert model_call_count == 2

            conflict = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": "Is the symptom still present?", "clientMessageId": client_message_id},
            )
            assert conflict.status_code == 409
            assert conflict.json()["code"] == "MESSAGE_ID_CONFLICT"
            assert provider.planner_calls == 1
            assert provider.actor_calls == 1
            with database.connection() as connection:
                assert (
                    connection.execute(
                        "SELECT COUNT(*) AS count FROM turns WHERE session_id=?",
                        (session_id,),
                    ).fetchone()["count"]
                    == 3
                )
    finally:
        database.close()


def test_upload_content_and_access_are_faculty_only(tmp_path: Path) -> None:
    database = Database(":memory:")
    application = create_app(settings=_settings(), database=database, ai_provider=MockAiProvider())
    application.state.upload_dir = str(tmp_path / "uploads")
    valid_png = b"\x89PNG\r\n\x1a\nsynthetic-test-content"
    try:
        with TestClient(application) as client:
            student_headers, _student = _student_login(client, "visitor-upload-boundary-0001")
            faculty_headers, _faculty = login(client, "faculty")

            anonymous = client.post(
                "/api/uploads/",
                files={"file": ("test.png", valid_png, "image/png")},
            )
            student = client.post(
                "/api/uploads/",
                headers=student_headers,
                files={"file": ("test.png", valid_png, "image/png")},
            )
            invalid_signature = client.post(
                "/api/uploads/",
                headers=faculty_headers,
                files={"file": ("test.png", b"not-an-image", "image/png")},
            )
            assert anonymous.status_code == 401
            assert student.status_code == 403
            assert invalid_signature.status_code == 415
            assert invalid_signature.json()["code"] == "INVALID_FILE_CONTENT"

            uploaded = client.post(
                "/api/uploads/",
                headers=faculty_headers,
                files={"file": ("test.png", valid_png, "image/png")},
            )
            assert uploaded.status_code == 201
            file_id = uploaded.json()["file"]["id"]
            download_path = f"/api/uploads/{file_id}"

            assert client.get(download_path).status_code == 401
            assert client.get(download_path, headers=student_headers).status_code == 403
            downloaded = client.get(download_path, headers=faculty_headers)
            assert downloaded.status_code == 200
            assert downloaded.content == valid_png
            assert downloaded.headers["cache-control"] == "private, no-store"
            assert downloaded.headers["x-content-type-options"] == "nosniff"
    finally:
        database.close()


@pytest.mark.parametrize(
    ("invalid_override", "expected_setting"),
    [
        ({"jwt_secret": "weak"}, "JWT_SECRET"),
        ({"ai_provider": "mock"}, "AI_PROVIDER"),
        ({"deepseek_base_url": "http://provider.invalid"}, "DEEPSEEK_BASE_URL"),
    ],
)
def test_production_rejects_unsafe_runtime_configuration(
    invalid_override: dict[str, str],
    expected_setting: str,
) -> None:
    values: dict[str, Any] = {
        "environment": "production",
        "database_path": ":memory:",
        "jwt_secret": "production-test-secret-that-is-long-and-unique",
        "faculty_demo_access_code": "faculty-test-code",
        "ai_provider": "deepseek",
        "deepseek_api_key": "configured-test-value",
        "deepseek_base_url": "https://provider.invalid",
        "web_origin": "https://simclin.example",
    }
    values.update(invalid_override)

    with pytest.raises(RuntimeError, match=expected_setting):
        load_settings(values)


def test_database_rejects_a_newer_schema_version(tmp_path: Path) -> None:
    database_path = tmp_path / "newer.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        connection.execute(
            "INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)",
            (SCHEMA_VERSION + 1, now_iso()),
        )
        connection.commit()
    finally:
        connection.close()

    database = Database(str(database_path))
    try:
        with pytest.raises(RuntimeError, match="newer than supported"):
            database.initialise()
    finally:
        database.close()


@pytest.mark.parametrize("missing_field", ["candidateInstructions", "presentingComplaint", "summary"])
def test_case_publish_requires_complete_student_brief(
    api: tuple[TestClient, Database],
    missing_field: str,
) -> None:
    client, _database = api
    headers, _faculty = login(client, "faculty")
    slug_suffix = missing_field.lower()
    rubric = client.post(
        "/api/rubrics",
        headers=headers,
        json=_complete_rubric_payload(f"hardening-case-{slug_suffix}"),
    )
    assert rubric.status_code == 201
    rubric_id = int(rubric.json()["id"])
    assert client.post(f"/api/rubrics/{rubric_id}/publish", headers=headers).status_code == 200

    content = _complete_case_content()
    summary = "A concise synthetic learner-facing case subtitle."
    if missing_field == "summary":
        summary = ""
    else:
        del content["caseData"][missing_field]
    created = client.post(
        "/api/cases",
        headers=headers,
        json={
            "slug": f"hardening-case-{slug_suffix}",
            "title": "Incomplete learner brief",
            "specialty": "Medicine",
            "setting": "Synthetic outpatient room",
            "summary": summary,
            "estimatedMinutes": 10,
            "rubricId": rubric_id,
            "content": content,
        },
    )
    assert created.status_code == 201

    published = client.post(f"/api/cases/{created.json()['id']}/publish", headers=headers)
    assert published.status_code == 409
    assert published.json()["code"] == "CASE_CONTENT_INCOMPLETE"


def test_rubric_publish_requires_all_zero_to_three_anchors(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    headers, _faculty = login(client, "faculty")
    payload = _complete_rubric_payload("hardening-incomplete-anchors")
    payload["criteria"][0]["anchors"].pop("3")

    created = client.post("/api/rubrics", headers=headers, json=payload)
    assert created.status_code == 201
    published = client.post(f"/api/rubrics/{created.json()['id']}/publish", headers=headers)
    assert published.status_code == 409
    assert published.json()["code"] == "RUBRIC_CONTENT_INCOMPLETE"


def test_result_pagination_totals_match_search_review_and_ownership_filters(
    api: tuple[TestClient, Database],
) -> None:
    client, database = api
    first_headers, first_user = _student_login(client, "visitor-result-filter-a-0001")
    second_headers, _second_user = _student_login(client, "visitor-result-filter-b-0002")
    faculty_headers, faculty_user = login(client, "faculty")
    cases = client.get("/api/cases", headers=first_headers).json()["cases"]
    first_case_id = int(cases[0]["id"])
    second_case_id = int(cases[1]["id"])
    session_ids = [
        _start_session(client, first_headers, first_case_id),
        _start_session(client, first_headers, second_case_id),
        _start_session(client, second_headers, first_case_id),
    ]
    created_at = now_iso()
    evaluation_ids: list[int] = []
    with database.connection(write=True) as connection:
        for index, session_id in enumerate(session_ids):
            connection.execute(
                """UPDATE sessions SET status='completed',evaluation_status='completed',
                completed_at=?,duration_seconds=? WHERE id=?""",
                (created_at, 60 + index, session_id),
            )
            result = connection.execute(
                """INSERT INTO evaluations
                (session_id,score,level,feedback_json,raw_json,created_at)
                VALUES (?,?,?,'{}','{}',?)""",
                (session_id, 70 + index, "Competent", created_at),
            )
            evaluation_ids.append(int(result.lastrowid))
        connection.execute(
            """INSERT INTO teacher_overrides
            (evaluation_id,faculty_user_id,previous_score,override_score,reason,created_at)
            VALUES (?,?,?,?,?,?)""",
            (evaluation_ids[0], faculty_user["id"], 70, 80, "Synthetic faculty review", created_at),
        )

    faculty_page = client.get("/api/results?limit=2&offset=0", headers=faculty_headers)
    assert faculty_page.status_code == 200
    assert faculty_page.json()["total"] == 3
    assert len(faculty_page.json()["results"]) == 2
    assert all("transcript" not in item for item in faculty_page.json()["results"])

    adjusted = client.get("/api/results?review=adjusted&limit=1", headers=faculty_headers)
    unadjusted = client.get("/api/results?review=unadjusted&limit=1", headers=faculty_headers)
    assert adjusted.json()["total"] == 1
    assert len(adjusted.json()["results"]) == 1
    assert adjusted.json()["results"][0]["adjusted"] is True
    assert unadjusted.json()["total"] == 2
    assert len(unadjusted.json()["results"]) == 1

    title_query = str(cases[0]["title"])
    searched = client.get(
        "/api/results",
        headers=faculty_headers,
        params={"query": title_query, "limit": 1},
    )
    searched_and_adjusted = client.get(
        "/api/results",
        headers=faculty_headers,
        params={"query": title_query, "review": "adjusted", "limit": 1},
    )
    assert searched.json()["total"] == 2
    assert len(searched.json()["results"]) == 1
    assert searched_and_adjusted.json()["total"] == 1
    assert len(searched_and_adjusted.json()["results"]) == 1

    first_student = client.get("/api/results?limit=1", headers=first_headers)
    second_student = client.get("/api/results?limit=1", headers=second_headers)
    assert first_student.status_code == 200
    assert first_student.json()["total"] == 2
    assert len(first_student.json()["results"]) == 1
    assert {item["studentName"] for item in first_student.json()["results"]} == {first_user["displayName"]}
    assert second_student.status_code == 200
    assert second_student.json()["total"] == 1
    assert len(second_student.json()["results"]) == 1
