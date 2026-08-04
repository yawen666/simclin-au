from __future__ import annotations

import json
import logging
import math
import os
import re
import tempfile
import time
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from dotenv import load_dotenv

from .config import load_settings
from .main import create_app

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

SERVER_ROOT = Path(__file__).resolve().parents[1]
INTERNAL_METADATA_PATTERN = re.compile(
    r"\b(?:fact[_ -]?id|rubric|system prompt|evaluatorOnlyNote)\b",
    flags=re.IGNORECASE,
)


class RealTestFailure(RuntimeError):
    """A deliberately sanitised real-provider test failure."""

    def __init__(self, stage: str, case_slug: str = "setup") -> None:
        super().__init__(stage)
        self.stage = stage
        self.case_slug = case_slug


def emit_status(
    status: str,
    case_slug: str,
    score: int | float | None,
    criteria_count: int,
) -> None:
    """Print only the non-sensitive fields allowed by the real-test contract."""

    print(
        json.dumps(
            {
                "status": status,
                "caseSlug": case_slug,
                "score": score,
                "criteriaCount": criteria_count,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )


@contextmanager
def real_provider_client() -> Iterator[TestClient]:
    """Create a lifespan-aware API client backed by a disposable SQLite file."""

    load_dotenv(SERVER_ROOT / ".env", override=False)
    settings = load_settings(
        {
            "environment": "test",
            "jwt_secret": "simclin-real-test-only-secret-at-least-32-characters",
            "ai_provider": "deepseek",
            "log_level": "warn",
            "web_origin": "http://localhost:5173",
        }
    )
    if not settings.deepseek_api_key:
        raise RealTestFailure("not-configured")

    # Model failures are represented by the fixed status field below. Suppress
    # library/application logging so request headers and clinical text cannot be
    # accidentally included in real-test output.
    logging.disable(logging.CRITICAL)
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"Using `httpx` with `starlette\.testclient` is deprecated.*",
            )
            from fastapi.testclient import TestClient as FastApiTestClient

        with tempfile.TemporaryDirectory(prefix="simclin-real-") as temp_dir:
            database_path = str(Path(temp_dir) / "simclin-real.sqlite3")
            application = create_app(
                settings=load_settings(
                    {
                        "environment": "test",
                        "database_path": database_path,
                        "jwt_secret": settings.jwt_secret,
                        "deepseek_api_key": settings.deepseek_api_key,
                        "deepseek_base_url": settings.deepseek_base_url,
                        "deepseek_model": settings.deepseek_model,
                        "ai_provider": "deepseek",
                        "web_origin": settings.web_origin,
                        "log_level": "warn",
                    }
                )
            )
            with FastApiTestClient(application, raise_server_exceptions=False) as client:
                yield client
    finally:
        logging.disable(logging.NOTSET)


def login_student(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/demo", json={"role": "student"})
    body = _json_object(response)
    token = body.get("token")
    if response.status_code != 200 or not isinstance(token, str) or not token:
        raise RealTestFailure("login")
    return {"Authorization": f"Bearer {token}"}


def published_cases(client: TestClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    response = client.get("/api/cases", headers=headers)
    body = _json_object(response)
    values = body.get("items", body.get("cases"))
    if response.status_code != 200 or not isinstance(values, list):
        raise RealTestFailure("case-catalog")
    cases = [
        value
        for value in values
        if isinstance(value, dict) and isinstance(value.get("id"), int) and isinstance(value.get("slug"), str)
    ]
    if not cases:
        raise RealTestFailure("case-catalog")
    return cases


def exercise_case(
    client: TestClient,
    headers: dict[str, str],
    clinical_case: dict[str, Any],
    question: str,
) -> dict[str, Any]:
    slug = str(clinical_case["slug"])
    start = client.post(
        "/api/sessions",
        headers=headers,
        json={"caseId": clinical_case["id"]},
    )
    start_body = _json_object(start)
    session = start_body.get("session")
    session_id = session.get("id") if isinstance(session, dict) else None
    if start.status_code != 201 or not isinstance(session_id, int):
        raise RealTestFailure("session-start", slug)

    _stream_patient_reply(client, headers, session_id, question, slug)

    complete = client.post(f"/api/sessions/{session_id}/complete", headers=headers)
    if complete.status_code != 202:
        raise RealTestFailure("evaluation-queue", slug)
    return wait_for_evaluation(client, headers, session_id, slug)


def wait_for_evaluation(
    client: TestClient,
    headers: dict[str, str],
    session_id: int,
    case_slug: str,
) -> dict[str, Any]:
    deadline = time.monotonic() + _evaluation_timeout_seconds()
    while time.monotonic() < deadline:
        response = client.get(f"/api/sessions/{session_id}", headers=headers)
        body = _json_object(response)
        if response.status_code != 200:
            raise RealTestFailure("evaluation-poll", case_slug)
        result = body.get("result")
        if isinstance(result, dict):
            return result
        if body.get("evaluationStatus") == "failed":
            raise RealTestFailure("evaluation-failed", case_slug)
        time.sleep(1)
    raise RealTestFailure("evaluation-timeout", case_slug)


def validate_structured_result(result: dict[str, Any], case_slug: str) -> tuple[int | float, list[dict[str, Any]]]:
    score = result.get("score")
    criteria = result.get("criteria")
    if (
        isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(float(score))
        or not 0 <= float(score) <= 100
        or not isinstance(criteria, list)
        or len(criteria) != 7
        or any(not isinstance(item, dict) for item in criteria)
    ):
        raise RealTestFailure("evaluation-shape", case_slug)
    return score, criteria


def _stream_patient_reply(
    client: TestClient,
    headers: dict[str, str],
    session_id: int,
    question: str,
    case_slug: str,
) -> None:
    patient_chunks: list[str] = []
    completed = False
    failed = False
    event_name = ""
    with client.stream(
        "POST",
        f"/api/sessions/{session_id}/messages",
        headers={**headers, "Accept": "text/event-stream"},
        json={"message": question},
    ) as response:
        if response.status_code != 200:
            raise RealTestFailure("patient-response", case_slug)
        for raw_line in response.iter_lines():
            line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
            if line.startswith("event:"):
                event_name = line[6:].strip()
                continue
            if not line.startswith("data:"):
                continue
            raw_data = line[5:].strip()
            if not raw_data or raw_data == "[DONE]":
                continue
            try:
                event = json.loads(raw_data)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            event_type = event.get("type")
            if event_name == "error" or event_type == "error":
                failed = True
            if event_type == "delta":
                delta = event.get("delta", event.get("text"))
                if isinstance(delta, str):
                    patient_chunks.append(delta)
            if event_name == "complete" or event_type == "done":
                completed = True
                if not patient_chunks and isinstance(event.get("text"), str):
                    patient_chunks.append(event["text"])

    patient_text = "".join(patient_chunks).strip()
    if failed or not completed or len(patient_text) < 5:
        raise RealTestFailure("patient-response", case_slug)
    if INTERNAL_METADATA_PATTERN.search(patient_text):
        raise RealTestFailure("patient-policy", case_slug)


def _evaluation_timeout_seconds() -> float:
    raw_value = os.getenv("SIMCLIN_REAL_EVALUATION_TIMEOUT_SECONDS", "180")
    try:
        return max(30, float(raw_value))
    except ValueError as exc:
        raise RealTestFailure("configuration") from exc


def _json_object(response: Any) -> dict[str, Any]:
    try:
        value = response.json()
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}
