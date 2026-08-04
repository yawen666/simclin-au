from __future__ import annotations

from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai import MockAiProvider
from app.config import load_settings
from app.database import Database
from app.errors import AppError
from app.main import create_app
from app.routes import sessions as session_routes


class _TrackingDatabase(Database):
    def __init__(self) -> None:
        super().__init__(":memory:")
        self.write_connections = 0

    @contextmanager
    def connection(self, write: bool = False):
        if write:
            self.write_connections += 1
        with super().connection(write=write) as connection:
            yield connection


def _application(
    *,
    provider: MockAiProvider | None = None,
    database: Database | None = None,
    **overrides: Any,
) -> tuple[Any, Database]:
    resolved_database = database or Database(":memory:")
    settings_values: dict[str, Any] = {
        "environment": "test",
        "database_path": ":memory:",
        "jwt_secret": "session-capacity-tests-need-a-long-secret",
        "ai_provider": "mock",
        "deepseek_api_key": "",
        "web_origin": "http://localhost:5173",
        "session_starts_per_user_per_hour": 30,
        "session_starts_per_ip_per_hour": 120,
        "session_starts_global_per_hour": 500,
        "max_sessions_per_student": 100,
        "max_total_sessions": 50_000,
    }
    settings_values.update(overrides)
    application = create_app(
        settings=load_settings(settings_values),
        database=resolved_database,
        ai_provider=provider or MockAiProvider(),
    )
    return application, resolved_database


def _login(client: TestClient, visitor_id: str) -> dict[str, str]:
    response = client.post("/api/auth/demo", json={"role": "student", "visitorId": visitor_id})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def _start(client: TestClient, headers: dict[str, str]) -> int:
    response = client.post("/api/sessions", headers=headers, json={"caseId": 1})
    assert response.status_code == 201
    return int(response.json()["id"])


@pytest.mark.parametrize(
    ("settings_overrides", "reuse_user"),
    [
        ({"session_starts_per_user_per_hour": 1}, True),
        (
            {
                "session_starts_per_user_per_hour": 1,
                "session_starts_per_ip_per_hour": 1,
            },
            False,
        ),
        (
            {
                "session_starts_per_user_per_hour": 1,
                "session_starts_per_ip_per_hour": 1,
                "session_starts_global_per_hour": 1,
            },
            False,
        ),
    ],
)
def test_session_start_hourly_budgets_are_enforced_atomically(
    settings_overrides: dict[str, int],
    reuse_user: bool,
) -> None:
    application, database = _application(**settings_overrides)
    try:
        with TestClient(application) as client:
            first_headers = _login(client, "session-budget-first-0001")
            second_headers = first_headers if reuse_user else _login(client, "session-budget-second-0002")
            _start(client, first_headers)

            limited = client.post("/api/sessions", headers=second_headers, json={"caseId": 1})

            assert limited.status_code == 429
            assert limited.json()["code"] == "SESSION_START_RATE_LIMITED"
            assert limited.json()["error"]["details"]["retryAfterSeconds"] > 0
            with database.connection() as connection:
                assert connection.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()["count"] == 1
    finally:
        database.close()


def test_session_request_gate_rejects_before_opening_a_write_transaction() -> None:
    database = _TrackingDatabase()
    application, _ = _application(
        database=database,
        session_requests_per_user_per_hour=1,
        session_requests_per_ip_per_hour=2,
        session_global_requests_per_hour=3,
        session_starts_per_user_per_hour=1,
        session_starts_per_ip_per_hour=1,
        session_starts_global_per_hour=1,
    )
    try:
        with TestClient(application) as client:
            headers = _login(client, "session-request-gate-user-0001")
            _start(client, headers)
            database.write_connections = 0

            rejected = client.post(
                "/api/sessions",
                headers={**headers, "X-Forwarded-For": "203.0.113.77"},
                json={"caseId": 1},
            )

            assert rejected.status_code == 429
            assert rejected.json()["code"] == "SESSION_REQUEST_RATE_LIMITED"
            assert database.write_connections == 0
    finally:
        database.close()


def test_session_start_quota_rejects_before_opening_a_write_transaction() -> None:
    database = _TrackingDatabase()
    application, _ = _application(database=database, session_starts_per_user_per_hour=1)
    try:
        with TestClient(application) as client:
            headers = _login(client, "session-start-gate-user-0001")
            _start(client, headers)
            database.write_connections = 0

            rejected = client.post("/api/sessions", headers=headers, json={"caseId": 1})

            assert rejected.status_code == 429
            assert rejected.json()["code"] == "SESSION_START_RATE_LIMITED"
            assert database.write_connections == 0
    finally:
        database.close()


@pytest.mark.parametrize(
    ("settings_overrides", "reuse_user", "expected_status", "expected_code"),
    [
        (
            {"max_sessions_per_student": 1, "max_total_sessions": 10},
            True,
            409,
            "STUDENT_SESSION_CAPACITY_REACHED",
        ),
        (
            {"max_sessions_per_student": 1, "max_total_sessions": 1},
            False,
            503,
            "SESSION_STORAGE_CAPACITY_REACHED",
        ),
    ],
)
def test_session_database_capacity_is_checked_before_insert(
    settings_overrides: dict[str, int],
    reuse_user: bool,
    expected_status: int,
    expected_code: str,
) -> None:
    application, database = _application(**settings_overrides)
    try:
        with TestClient(application) as client:
            first_headers = _login(client, "session-capacity-first-0001")
            second_headers = first_headers if reuse_user else _login(client, "session-capacity-second-0002")
            _start(client, first_headers)

            rejected = client.post("/api/sessions", headers=second_headers, json={"caseId": 1})

            assert rejected.status_code == expected_status
            assert rejected.json()["code"] == expected_code
            with database.connection() as connection:
                assert connection.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()["count"] == 1
    finally:
        database.close()


def test_session_list_has_bounded_pagination_and_compatibility_aliases() -> None:
    application, database = _application()
    try:
        with TestClient(application) as client:
            headers = _login(client, "session-pagination-user-0001")
            created = [_start(client, headers) for _ in range(3)]

            response = client.get("/api/sessions?limit=2&offset=1", headers=headers)

            assert response.status_code == 200
            body = response.json()
            assert body["items"] == body["sessions"]
            assert body["total"] == 3
            assert body["limit"] == 2
            assert body["offset"] == 1
            assert [item["id"] for item in body["items"]] == list(reversed(created))[1:]
            assert client.get("/api/sessions?limit=101", headers=headers).status_code == 400
            assert client.get("/api/sessions?offset=-1", headers=headers).status_code == 400
    finally:
        database.close()


def test_repeated_completion_does_not_charge_ai_quota_while_queued(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application, database = _application()
    calls = 0
    original = session_routes.enforce_ai_rate_limit

    def counted_enforcement(request: Any, user: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        original(request, user)

    try:
        with TestClient(application) as client:
            headers = _login(client, "session-completion-user-0001")
            session_id = _start(client, headers)
            message = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": "When did this begin?", "clientMessageId": "complete-message-0001"},
            )
            assert message.status_code == 200
            application.state.evaluations._stopping = True
            monkeypatch.setattr(session_routes, "enforce_ai_rate_limit", counted_enforcement)

            first = client.post(f"/api/sessions/{session_id}/complete", headers=headers)
            repeated = client.post(f"/api/sessions/{session_id}/complete", headers=headers)

            assert first.status_code == 202
            assert repeated.status_code == 202
            assert first.json()["status"] == repeated.json()["status"] == "evaluating"
            assert calls == 1
            with database.connection() as connection:
                evaluation_status = connection.execute(
                    "SELECT evaluation_status FROM sessions WHERE id=?",
                    (session_id,),
                ).fetchone()["evaluation_status"]
            assert evaluation_status == "queued"
    finally:
        database.close()


class _FailFirstPlanner(MockAiProvider):
    def __init__(self) -> None:
        self.failed = False

    async def plan_disclosure(self, **kwargs: Any) -> dict[str, Any]:
        if kwargs["student_message"] == "Please describe the onset." and not self.failed:
            self.failed = True
            raise AppError(502, "AI_PROVIDER_ERROR", "Synthetic first-attempt failure")
        return await super().plan_disclosure(**kwargs)


def test_failed_idempotent_message_moves_after_later_turns_before_retry() -> None:
    application, database = _application(provider=_FailFirstPlanner())
    try:
        with TestClient(application) as client:
            headers = _login(client, "session-message-retry-user-0001")
            session_id = _start(client, headers)

            failed = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": "Please describe the onset.", "clientMessageId": "retry-message-0001"},
            )
            later = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": "Is it still present?", "clientMessageId": "later-message-0002"},
            )
            retried = client.post(
                f"/api/sessions/{session_id}/messages",
                headers=headers,
                json={"message": "Please describe the onset.", "clientMessageId": "retry-message-0001"},
            )

            assert failed.status_code == 200
            assert '"type":"error"' in failed.text
            assert later.status_code == 200
            assert '"type":"done"' in later.text
            assert retried.status_code == 200
            assert '"type":"done"' in retried.text
            with database.connection() as connection:
                turns = connection.execute(
                    """SELECT sequence,speaker,content,status,client_message_id
                    FROM turns WHERE session_id=? ORDER BY sequence""",
                    (session_id,),
                ).fetchall()
            assert [turn["sequence"] for turn in turns] == [1, 3, 4, 5, 6]
            retried_student = next(turn for turn in turns if turn["client_message_id"] == "retry-message-0001")
            assert retried_student["sequence"] == 5
            assert retried_student["status"] == "completed"
            assert turns[-1]["speaker"] == "patient"
    finally:
        database.close()
