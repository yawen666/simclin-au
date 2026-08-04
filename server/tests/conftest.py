from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai import MockAiProvider
from app.config import load_settings
from app.database import Database
from app.main import create_app


@pytest.fixture
def api() -> Iterator[tuple[TestClient, Database]]:
    database = Database(":memory:")
    settings = load_settings(
        {
            "environment": "test",
            "database_path": ":memory:",
            "jwt_secret": "unit-test-secret-at-least-32-characters",
            "ai_provider": "mock",
            "deepseek_api_key": "",
            "web_origin": "http://localhost:5173",
        }
    )
    application = create_app(settings=settings, database=database, ai_provider=MockAiProvider())
    with TestClient(application) as client:
        yield client, database
    database.close()


def login(client: TestClient, role: str) -> tuple[dict[str, str], dict[str, Any]]:
    response = client.post("/api/auth/demo", json={"role": role})
    assert response.status_code == 200
    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]
