from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import rate_limit
from app.ai import MockAiProvider
from app.config import load_settings
from app.database import Database
from app.main import create_app
from app.rate_limit import SlidingWindowRateLimiter


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


def _student_client(
    database: Database | None = None,
    **overrides: int,
) -> Iterator[tuple[TestClient, Database]]:
    resolved_database = database or Database(":memory:")
    settings = load_settings(
        {
            "environment": "test",
            "database_path": ":memory:",
            "jwt_secret": "unit-test-secret-at-least-32-characters",
            "ai_provider": "mock",
            "deepseek_api_key": "",
            "web_origin": "http://localhost:5173",
            **overrides,
        }
    )
    application = create_app(settings=settings, database=resolved_database, ai_provider=MockAiProvider())
    with TestClient(application) as client:
        yield client, resolved_database
    resolved_database.close()


def test_same_visitor_relogin_does_not_consume_creation_quota() -> None:
    for client, database in _student_client(
        anonymous_profiles_per_ip_per_hour=1,
        anonymous_profiles_global_per_hour=1,
        max_anonymous_student_profiles=10,
    ):
        visitor_id = "same-browser-visitor"
        first = client.post("/api/auth/demo", json={"role": "student", "visitorId": visitor_id})
        repeated = client.post("/api/auth/demo", json={"role": "student", "visitorId": visitor_id})
        rejected = client.post(
            "/api/auth/demo",
            json={"role": "student", "visitorId": "different-browser-visitor"},
        )

        assert first.status_code == 200
        assert repeated.status_code == 200
        assert repeated.json()["user"]["id"] == first.json()["user"]["id"]
        assert rejected.status_code == 429
        assert rejected.json()["code"] == "ANONYMOUS_PROFILE_RATE_LIMITED"
        assert set(rejected.json()["error"]["details"]) == {"retryAfterSeconds"}
        with database.connection() as connection:
            count = connection.execute(
                "SELECT COUNT(*) AS count FROM users WHERE username GLOB 'demo_student_*'"
            ).fetchone()["count"]
        assert count == 1


def test_profile_capacity_excludes_seed_and_only_blocks_new_visitors() -> None:
    for client, database in _student_client(
        anonymous_profiles_per_ip_per_hour=10,
        anonymous_profiles_global_per_hour=10,
        max_anonymous_student_profiles=1,
    ):
        visitor_id = "first-capacity-visitor"
        first = client.post("/api/auth/demo", json={"role": "student", "visitorId": visitor_id})
        repeated = client.post("/api/auth/demo", json={"role": "student", "visitorId": visitor_id})
        rejected = client.post(
            "/api/auth/demo",
            json={"role": "student", "visitorId": "over-capacity-visitor"},
        )

        assert first.status_code == 200
        assert repeated.status_code == 200
        assert rejected.status_code == 503
        assert rejected.json()["code"] == "ANONYMOUS_PROFILE_CAPACITY_REACHED"
        assert "details" not in rejected.json()["error"]
        assert "1" not in rejected.json()["message"]
        with database.connection() as connection:
            seed_count = connection.execute(
                "SELECT COUNT(*) AS count FROM users WHERE username='demo_student'"
            ).fetchone()["count"]
            anonymous_count = connection.execute(
                "SELECT COUNT(*) AS count FROM users WHERE username GLOB 'demo_student_*'"
            ).fetchone()["count"]
        assert seed_count == 1
        assert anonymous_count == 1


def test_existing_visitor_is_read_only_and_raw_forwarded_header_cannot_evade_auth_gate() -> None:
    database = _TrackingDatabase()
    for client, _ in _student_client(
        database,
        auth_requests_per_ip_per_hour=2,
        auth_global_requests_per_hour=100,
        anonymous_profiles_per_ip_per_hour=1,
        anonymous_profiles_global_per_hour=10,
    ):
        visitor_id = "read-only-existing-visitor"
        first = client.post(
            "/api/auth/demo",
            headers={"X-Forwarded-For": "198.51.100.10"},
            json={"role": "student", "visitorId": visitor_id},
        )
        assert first.status_code == 200
        database.write_connections = 0

        repeated = client.post(
            "/api/auth/demo",
            headers={"X-Forwarded-For": "198.51.100.11"},
            json={"role": "student", "visitorId": visitor_id},
        )
        rejected = client.post(
            "/api/auth/demo",
            headers={"X-Forwarded-For": "198.51.100.12"},
            json={"role": "student", "visitorId": "another-unique-visitor"},
        )

        assert repeated.status_code == 200
        assert repeated.json()["user"]["id"] == first.json()["user"]["id"]
        assert rejected.status_code == 429
        assert rejected.json()["code"] == "AUTH_REQUEST_RATE_LIMITED"
        # TestClient is not a configured Uvicorn trusted proxy, so arbitrary
        # forwarding headers remain untrusted and neither request writes.
        assert database.write_connections == 0


def test_profile_creation_quota_rejects_before_opening_a_write_transaction() -> None:
    database = _TrackingDatabase()
    for client, _ in _student_client(
        database,
        auth_requests_per_ip_per_hour=10,
        auth_global_requests_per_hour=100,
        anonymous_profiles_per_ip_per_hour=1,
        anonymous_profiles_global_per_hour=10,
    ):
        assert (
            client.post(
                "/api/auth/demo",
                json={"role": "student", "visitorId": "profile-gate-first-visitor"},
            ).status_code
            == 200
        )
        database.write_connections = 0

        rejected = client.post(
            "/api/auth/demo",
            json={"role": "student", "visitorId": "profile-gate-second-visitor"},
        )

        assert rejected.status_code == 429
        assert rejected.json()["code"] == "ANONYMOUS_PROFILE_RATE_LIMITED"
        assert database.write_connections == 0


def test_profile_settings_load_from_environment_and_validate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_REQUESTS_PER_IP_PER_HOUR", "17")
    monkeypatch.setenv("AUTH_GLOBAL_REQUESTS_PER_HOUR", "111")
    monkeypatch.setenv("ANONYMOUS_PROFILES_PER_IP_PER_HOUR", "7")
    monkeypatch.setenv("ANONYMOUS_PROFILES_GLOBAL_PER_HOUR", "11")
    monkeypatch.setenv("MAX_ANONYMOUS_STUDENT_PROFILES", "101")
    settings = load_settings()
    assert settings.auth_requests_per_ip_per_hour == 17
    assert settings.auth_global_requests_per_hour == 111
    assert settings.anonymous_profiles_per_ip_per_hour == 7
    assert settings.anonymous_profiles_global_per_hour == 11
    assert settings.max_anonymous_student_profiles == 101

    with pytest.raises(RuntimeError, match="ANONYMOUS_PROFILES_GLOBAL_PER_HOUR"):
        load_settings(
            {
                "anonymous_profiles_per_ip_per_hour": 3,
                "anonymous_profiles_global_per_hour": 2,
            }
        )
    with pytest.raises(RuntimeError, match="positive"):
        load_settings({"max_anonymous_student_profiles": 0})
    with pytest.raises(RuntimeError, match="AUTH_GLOBAL_REQUESTS_PER_HOUR"):
        load_settings({"auth_requests_per_ip_per_hour": 12, "auth_global_requests_per_hour": 11})
    with pytest.raises(RuntimeError, match="at least the corresponding anonymous profile"):
        load_settings(
            {
                "auth_requests_per_ip_per_hour": 19,
                "anonymous_profiles_per_ip_per_hour": 20,
                "anonymous_profiles_global_per_hour": 20,
            }
        )


def test_session_guard_settings_load_from_environment_and_validate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_REQUESTS_PER_USER_PER_HOUR", "14")
    monkeypatch.setenv("SESSION_REQUESTS_PER_IP_PER_HOUR", "18")
    monkeypatch.setenv("SESSION_GLOBAL_REQUESTS_PER_HOUR", "22")
    monkeypatch.setenv("SESSION_STARTS_PER_USER_PER_HOUR", "4")
    monkeypatch.setenv("SESSION_STARTS_PER_IP_PER_HOUR", "8")
    monkeypatch.setenv("SESSION_STARTS_GLOBAL_PER_HOUR", "12")
    monkeypatch.setenv("MAX_SESSIONS_PER_STUDENT", "21")
    monkeypatch.setenv("MAX_TOTAL_SESSIONS", "210")
    settings = load_settings()
    assert settings.session_requests_per_user_per_hour == 14
    assert settings.session_requests_per_ip_per_hour == 18
    assert settings.session_global_requests_per_hour == 22
    assert settings.session_starts_per_user_per_hour == 4
    assert settings.session_starts_per_ip_per_hour == 8
    assert settings.session_starts_global_per_hour == 12
    assert settings.max_sessions_per_student == 21
    assert settings.max_total_sessions == 210

    with pytest.raises(RuntimeError, match="Session start budgets must satisfy"):
        load_settings(
            {
                "session_starts_per_user_per_hour": 10,
                "session_starts_per_ip_per_hour": 9,
                "session_starts_global_per_hour": 11,
            }
        )
    with pytest.raises(RuntimeError, match="MAX_TOTAL_SESSIONS"):
        load_settings({"max_sessions_per_student": 20, "max_total_sessions": 19})
    with pytest.raises(RuntimeError, match="positive"):
        load_settings({"session_starts_global_per_hour": 0})
    with pytest.raises(RuntimeError, match="Session request budgets must satisfy"):
        load_settings(
            {
                "session_requests_per_user_per_hour": 10,
                "session_requests_per_ip_per_hour": 9,
                "session_global_requests_per_hour": 11,
                "session_starts_per_user_per_hour": 9,
            }
        )
    with pytest.raises(RuntimeError, match="corresponding session start budgets"):
        load_settings(
            {
                "session_requests_per_user_per_hour": 29,
                "session_requests_per_ip_per_hour": 30,
                "session_global_requests_per_hour": 30,
                "session_starts_per_user_per_hour": 30,
                "session_starts_per_ip_per_hour": 30,
                "session_starts_global_per_hour": 30,
            }
        )


def test_render_uses_uvicorn_trusted_proxy_configuration() -> None:
    render_config = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")
    assert "--proxy-headers" in render_config
    assert '--forwarded-allow-ips "*"' in render_config


def test_failed_multibudget_request_does_not_retain_new_keys_and_stale_keys_are_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now)
    limiter = SlidingWindowRateLimiter(window_seconds=60)

    assert limiter.consume("saturated", 1) == 0
    assert limiter.consume_many((("untrusted-new-key", 1), ("saturated", 1))) == 60
    assert "untrusted-new-key" not in limiter._events

    now = 161.0
    assert limiter.consume("current", 1) == 0
    assert "saturated" not in limiter._events
    assert set(limiter._events) == {"current"}
