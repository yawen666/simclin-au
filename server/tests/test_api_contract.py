from __future__ import annotations

from conftest import login
from fastapi.testclient import TestClient

from app.ai import MockAiProvider
from app.config import load_settings
from app.database import Database
from app.main import create_app


def test_health_and_validation_envelope(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {
        **health.json(),
        "status": "ok",
        "database": "ok",
        "aiProvider": "mock",
        "aiModel": "deepseek-v4-flash",
        "facultyAccessProtected": False,
        "runtime": "python",
        "schemaVersion": 5,
    }
    assert "secret" not in health.text.lower()

    invalid = client.post("/api/auth/demo", json={"role": "administrator"})
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "VALIDATION_ERROR"
    assert invalid.json()["error"]["details"]


def test_request_body_limit_uses_stable_error_envelope(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    oversized = client.post(
        "/api/auth/demo",
        content=b"x" * (1024 * 1024 + 1),
        headers={"Content-Type": "application/json"},
    )
    assert oversized.status_code == 413
    assert oversized.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert oversized.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"

    chunked = client.post(
        "/api/auth/demo",
        content=(b"x" * 600_000 for _ in range(2)),
        headers={"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
    )
    assert chunked.status_code == 413
    assert chunked.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_authentication_and_role_boundaries(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    missing = client.get("/api/cases")
    assert missing.status_code == 401
    headers, user = login(client, "student")
    assert user["role"] == "student"
    assert client.get("/api/auth/me", headers=headers).json()["user"]["id"] == user["id"]
    blocked = client.post(
        "/api/cases",
        headers=headers,
        json={"slug": "blocked", "title": "Blocked", "specialty": "Medicine", "content": {}},
    )
    assert blocked.status_code == 403


def test_faculty_demo_access_code_can_protect_hosted_preview() -> None:
    database = Database(":memory:")
    settings = load_settings(
        {
            "environment": "test",
            "database_path": ":memory:",
            "jwt_secret": "unit-test-secret-at-least-32-characters",
            "faculty_demo_access_code": "faculty-test-access-code",
            "ai_provider": "mock",
            "ai_requests_per_hour": 1,
            "deepseek_api_key": "",
            "web_origin": "http://localhost:5173",
        }
    )
    application = create_app(settings=settings, database=database, ai_provider=MockAiProvider())
    with TestClient(application) as client:
        student_login = client.post("/api/auth/demo", json={"role": "student"})
        assert student_login.status_code == 200
        missing = client.post("/api/auth/demo", json={"role": "faculty"})
        assert missing.status_code == 403
        assert missing.json()["code"] == "FACULTY_ACCESS_REQUIRED"
        wrong = client.post(
            "/api/auth/demo",
            json={"role": "faculty", "accessCode": "wrong"},
        )
        assert wrong.status_code == 403
        allowed = client.post(
            "/api/auth/demo",
            json={"role": "faculty", "accessCode": "faculty-test-access-code"},
        )
        assert allowed.status_code == 200
        assert "faculty-test-access-code" not in allowed.text
        assert client.get("/api/health").json()["facultyAccessProtected"] is True

        student_headers = {"Authorization": f"Bearer {student_login.json()['token']}"}
        started = client.post("/api/sessions", headers=student_headers, json={"caseId": 1})
        session_id = started.json()["id"]
        first = client.post(
            f"/api/sessions/{session_id}/messages",
            headers=student_headers,
            json={"message": "What brought you in today?"},
        )
        assert first.status_code == 200
        limited = client.post(
            f"/api/sessions/{session_id}/messages",
            headers=student_headers,
            json={"message": "When did this begin?"},
        )
        assert limited.status_code == 429
        assert limited.json()["code"] == "AI_RATE_LIMITED"
    database.close()


def test_case_catalog_keeps_vue_compatibility_aliases(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    headers, _user = login(client, "student")
    response = client.get("/api/cases", headers=headers)
    assert response.status_code == 200
    assert response.json()["cases"] == response.json()["items"]
    assert len(response.json()["cases"]) == 5
    case_id = response.json()["cases"][0]["id"]
    detail = client.get(f"/api/cases/{case_id}", headers=headers).json()
    assert detail["id"] == detail["case"]["id"]
    assert isinstance(detail["learningObjectives"], list)
    assert "content" not in detail
    assert "caseData" not in detail
    assert "patientName" not in detail
    assert "rubric" not in detail
    student_payload = client.get(f"/api/cases/{case_id}", headers=headers).text
    for hidden_key in ("clinicalTruth", "atomicFacts", "evaluatorOnlyNote", "teachingPoints"):
        assert hidden_key not in student_payload

    faculty_headers, _faculty = login(client, "faculty")
    faculty_detail = client.get(f"/api/cases/{case_id}", headers=faculty_headers).json()
    assert isinstance(faculty_detail["patientName"], str)
    assert isinstance(faculty_detail["content"], dict)
    assert isinstance(faculty_detail["caseData"], dict)


def test_case_writes_return_canonical_detail_and_identical_patch_retry_is_idempotent(
    api: tuple[TestClient, Database],
) -> None:
    client, database = api
    headers, _user = login(client, "faculty")
    rubric_id = client.get("/api/rubrics", headers=headers).json()["rubrics"][0]["id"]
    content = {
        "openingStatement": "I have had a headache since this morning.",
        "patient": {"name": "Canonical Patient", "age": 38},
        "caseData": {
            "candidateInstructions": "Take a focused headache history.",
            "learningObjectives": [],
            "presentingComplaint": "A new headache.",
            "atomicFacts": [],
            "redFlags": [],
        },
    }
    created = client.post(
        "/api/cases",
        headers=headers,
        json={
            "slug": "canonical-write-contract",
            "title": "Canonical write contract",
            "specialty": "General Medicine",
            "setting": "General practice",
            "summary": "A focused headache case.",
            "rubricId": rubric_id,
            "content": content,
        },
    )

    assert created.status_code == 201
    created_body = created.json()
    case_id = created_body["id"]
    assert created_body["case"]["id"] == case_id
    assert created_body["title"] == "Canonical write contract"
    assert created_body["patientName"] == "Canonical Patient"
    assert created_body["content"]["caseData"]["presentingComplaint"] == "A new headache."

    patch_payload = {
        "title": "Canonical write contract updated",
        "summary": "An updated focused headache case.",
        "content": content,
        "rubricId": rubric_id,
    }
    first = client.patch(f"/api/cases/{case_id}", headers=headers, json=patch_payload)
    retry = client.patch(f"/api/cases/{case_id}", headers=headers, json=patch_payload)

    assert first.status_code == 200
    assert first.json()["version"] == 2
    assert first.json()["case"]["title"] == "Canonical write contract updated"
    assert retry.status_code == 200
    assert retry.json()["version"] == 2
    with database.connection() as connection:
        version_count = connection.execute(
            "SELECT COUNT(*) AS total FROM case_versions WHERE case_id=?",
            (case_id,),
        ).fetchone()["total"]
    assert version_count == 2


def test_faculty_case_and_rubric_validation(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    headers, _user = login(client, "faculty")
    rubrics = client.get("/api/rubrics", headers=headers)
    assert rubrics.status_code == 200
    assert rubrics.json()["rubrics"] == rubrics.json()["items"]

    invalid_rubric = client.post(
        "/api/rubrics",
        headers=headers,
        json={
            "slug": "invalid-weights",
            "name": "Invalid weights",
            "criteria": [{"id": "one", "name": "One", "weight": 90, "maxScore": 3}],
        },
    )
    assert invalid_rubric.status_code == 400
    assert invalid_rubric.json()["code"] == "INVALID_RUBRIC_WEIGHT"

    near_miss = client.post(
        "/api/rubrics",
        headers=headers,
        json={
            "slug": "near-miss-weights",
            "name": "Near miss weights",
            "criteria": [
                {"id": "one", "name": "One", "weight": 50, "maxScore": 3},
                {"id": "two", "name": "Two", "weight": 49.995, "maxScore": 3},
            ],
        },
    )
    assert near_miss.status_code == 400
    assert near_miss.json()["code"] == "INVALID_RUBRIC_WEIGHT"

    created = client.post(
        "/api/cases",
        headers=headers,
        json={
            "slug": "incomplete-case",
            "title": "Incomplete case",
            "specialty": "Medicine",
            "rubricId": rubrics.json()["rubrics"][0]["id"],
            "content": {},
        },
    )
    assert created.status_code == 201
    publish = client.post(f"/api/cases/{created.json()['id']}/publish", headers=headers)
    assert publish.status_code == 409
    assert publish.json()["code"] == "CASE_CONTENT_INCOMPLETE"


def test_unknown_route_uses_stable_error_contract(api: tuple[TestClient, Database]) -> None:
    client, _database = api
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == "ROUTE_NOT_FOUND"


def test_published_case_keeps_its_rubric_snapshot_until_republished(
    api: tuple[TestClient, Database],
) -> None:
    client, database = api
    faculty_headers, _faculty = login(client, "faculty")
    student_headers, _student = login(client, "student")
    cases = client.get("/api/cases", headers=faculty_headers).json()["cases"]
    rubrics = client.get("/api/rubrics", headers=faculty_headers).json()["rubrics"]
    case_id = cases[0]["id"]
    before = client.get(f"/api/cases/{case_id}", headers=student_headers).json()
    faculty_before = client.get(f"/api/cases/{case_id}", headers=faculty_headers).json()
    published_rubric_id = faculty_before["rubric"]["id"]
    draft_rubric_id = next(item["id"] for item in rubrics if item["id"] != published_rubric_id)

    relinked = client.patch(
        f"/api/cases/{case_id}",
        headers=faculty_headers,
        json={"rubricId": draft_rubric_id},
    )
    assert relinked.status_code == 200
    student_view = client.get(f"/api/cases/{case_id}", headers=student_headers).json()
    assert "rubric" not in student_view

    session = client.post("/api/sessions", headers=student_headers, json={"caseId": case_id})
    assert session.status_code == 201
    with database.connection() as connection:
        actual_rubric_id = connection.execute(
            """
            SELECT rv.rubric_id FROM sessions s
            JOIN rubric_versions rv ON rv.id=s.rubric_version_id
            WHERE s.id=?
            """,
            (session.json()["id"],),
        ).fetchone()["rubric_id"]
    assert actual_rubric_id == published_rubric_id

    original_title = before["title"]
    renamed = client.patch(
        f"/api/cases/{case_id}",
        headers=faculty_headers,
        json={"title": "Unpublished faculty title"},
    )
    assert renamed.status_code == 200
    published_view = client.get(f"/api/cases/{case_id}", headers=student_headers)
    assert published_view.json()["title"] == original_title
    session_detail = client.get(
        f"/api/sessions/{session.json()['id']}",
        headers=student_headers,
    )
    assert session_detail.json()["caseTitle"] == original_title
