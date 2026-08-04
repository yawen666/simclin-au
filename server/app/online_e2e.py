from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

DEFAULT_API_BASE = "https://simclin-au-api.onrender.com/api"
DEFAULT_WEB_ORIGIN = "https://simclin-au-web.onrender.com"
CASE_COUNT = 5
EXPECTED_CRITERIA_COUNT = 7
BUILD_ID_PATTERN = re.compile(r"^[0-9a-f]{7,12}$", re.IGNORECASE)
SAFE_SLUG_PATTERN = re.compile(r"^[a-z0-9-]{2,100}$")
INTERNAL_METADATA_PATTERN = re.compile(
    r"\b(?:fact[_ -]?id|rubric|system prompt|evaluatorOnlyNote)\b",
    re.IGNORECASE,
)
QUESTIONS = (
    "Hello, I am a medical student. Could you tell me more about what brought you in today?",
    "When did these symptoms begin, and how have they changed since then?",
    "Are you experiencing any severe symptoms right now, such as fainting or difficulty breathing?",
)


@dataclass(frozen=True)
class CaseOutcome:
    case_slug: str
    turn_count: int
    score: float
    criteria_count: int


@dataclass(frozen=True)
class RunOutcome:
    build_id: str
    cases: tuple[CaseOutcome, ...]
    isolation: bool


@dataclass(frozen=True)
class QueuedCase:
    case_slug: str
    turn_count: int
    session_id: int


class OnlineE2EFailure(RuntimeError):
    """A failure carrying only fields that are safe to print in CI logs."""

    def __init__(self, stage: str, case_slug: str = "setup", turn_count: int = 0) -> None:
        super().__init__(stage)
        self.stage = _safe_stage(stage)
        self.case_slug = _safe_slug(case_slug)
        self.turn_count = max(0, int(turn_count))


def _safe_stage(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    return cleaned[:80] or "unknown"


def _safe_slug(value: str) -> str:
    return value if SAFE_SLUG_PATTERN.fullmatch(value) else "setup"


def _api_base() -> str:
    value = os.getenv("SIMCLIN_ONLINE_API_BASE", DEFAULT_API_BASE).strip().rstrip("/")
    parsed = urlparse(value)
    local_host = parsed.hostname in {"127.0.0.1", "localhost"}
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or (parsed.scheme != "https" and not local_host)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise OnlineE2EFailure("configuration-api-base")
    return value


def _web_origin() -> str:
    value = os.getenv("SIMCLIN_ONLINE_WEB_ORIGIN", DEFAULT_WEB_ORIGIN).strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
        raise OnlineE2EFailure("configuration-web-origin")
    return value


def _timeout_seconds(variable: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(variable, str(default)))
    except ValueError as exc:
        raise OnlineE2EFailure("configuration-timeout") from exc
    if not math.isfinite(value):
        raise OnlineE2EFailure("configuration-timeout")
    return min(maximum, max(minimum, value))


def _json_object(response: httpx.Response, stage: str, case_slug: str = "setup") -> dict[str, Any]:
    try:
        value = response.json()
    except (TypeError, ValueError) as exc:
        raise OnlineE2EFailure(stage, case_slug) from exc
    if not isinstance(value, dict):
        raise OnlineE2EFailure(stage, case_slug)
    return value


def _request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    stage: str,
    expected_status: int | tuple[int, ...] = 200,
    case_slug: str = "setup",
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    statuses = (expected_status,) if isinstance(expected_status, int) else expected_status
    try:
        response = client.request(method, path, headers=headers, json=json_body)
    except httpx.HTTPError as exc:
        raise OnlineE2EFailure(stage, case_slug) from exc
    if response.status_code not in statuses:
        raise OnlineE2EFailure(stage, case_slug)
    return _json_object(response, stage, case_slug)


def _expect_error(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    stage: str,
    status: int | tuple[int, ...],
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    code: str | None = None,
) -> None:
    statuses = (status,) if isinstance(status, int) else status
    try:
        response = client.request(method, path, headers=headers, json=json_body)
    except httpx.HTTPError as exc:
        raise OnlineE2EFailure(stage) from exc
    if response.status_code not in statuses:
        raise OnlineE2EFailure(stage)
    if code is not None and _json_object(response, stage).get("code") != code:
        raise OnlineE2EFailure(stage)


def _auth_headers(token: Any, stage: str) -> dict[str, str]:
    if not isinstance(token, str) or len(token) < 20:
        raise OnlineE2EFailure(stage)
    return {"Authorization": f"Bearer {token}"}


def _login_student(client: httpx.Client, visitor_id: str) -> tuple[dict[str, str], int]:
    body = _request_json(
        client,
        "POST",
        "/auth/demo",
        stage="student-login",
        json_body={"role": "student", "visitorId": visitor_id},
    )
    user = body.get("user")
    user_id = user.get("id") if isinstance(user, dict) else None
    if isinstance(user_id, bool) or not isinstance(user_id, int) or user_id <= 0:
        raise OnlineE2EFailure("student-login")
    return _auth_headers(body.get("token"), "student-login"), user_id


def _validate_health(body: dict[str, Any]) -> str:
    valid = (
        body.get("status") == "ok"
        and body.get("service") == "simclin-au-api"
        and body.get("runtime") == "python"
        and body.get("schemaVersion") == 5
        and body.get("database") == "ok"
        and body.get("aiProvider") == "deepseek"
        and body.get("aiModel") == "deepseek-v4-flash"
        and body.get("aiConfigured") is True
        and body.get("facultyAccessProtected") is False
        and body.get("facultyAccessMode") == "open-demo"
    )
    build_id = body.get("buildId")
    if not valid or not isinstance(build_id, str) or BUILD_ID_PATTERN.fullmatch(build_id) is None:
        raise OnlineE2EFailure("health-contract")
    return build_id.lower()


def _validate_cors(client: httpx.Client, origin: str) -> None:
    try:
        response = client.options(
            "/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    except httpx.HTTPError as exc:
        raise OnlineE2EFailure("cors-preflight") from exc
    allowed_headers = response.headers.get("access-control-allow-headers", "").lower()
    allowed_methods = response.headers.get("access-control-allow-methods", "").upper()
    if (
        response.status_code not in {200, 204}
        or response.headers.get("access-control-allow-origin") != origin
        or "authorization" not in allowed_headers
        or "content-type" not in allowed_headers
        or "GET" not in allowed_methods
    ):
        raise OnlineE2EFailure("cors-preflight")


def _published_cases(client: httpx.Client, headers: dict[str, str]) -> list[dict[str, Any]]:
    body = _request_json(client, "GET", "/cases", stage="case-catalog", headers=headers)
    values = body.get("items", body.get("cases"))
    if not isinstance(values, list):
        raise OnlineE2EFailure("case-catalog")
    cases: list[dict[str, Any]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        case_id, slug = value.get("id"), value.get("slug")
        if (
            isinstance(case_id, int)
            and not isinstance(case_id, bool)
            and case_id > 0
            and isinstance(slug, str)
            and SAFE_SLUG_PATTERN.fullmatch(slug)
            and value.get("status") == "published"
        ):
            cases.append({"id": case_id, "slug": slug})
    if len(cases) < CASE_COUNT:
        raise OnlineE2EFailure("case-catalog-count")
    return cases[:CASE_COUNT]


def _iter_sse_events(lines: Iterable[str]) -> Iterator[tuple[str, str]]:
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in lines:
        line = raw_line.rstrip("\r")
        if not line:
            if data_lines:
                yield event_name, "\n".join(data_lines)
            event_name = "message"
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "event":
            event_name = value
        elif field == "data":
            data_lines.append(value)
    if data_lines:
        yield event_name, "\n".join(data_lines)


def _validate_sse(lines: Iterable[str], case_slug: str, *, expect_replay: bool = False) -> None:
    state = "start"
    delta_characters = 0
    delta_chunks: list[str] = []
    for event_name, raw_data in _iter_sse_events(lines):
        try:
            payload = json.loads(raw_data)
        except json.JSONDecodeError as exc:
            raise OnlineE2EFailure("sse-json", case_slug) from exc
        if not isinstance(payload, dict):
            raise OnlineE2EFailure("sse-json", case_slug)
        event_type = payload.get("type")
        if event_name == "error" or event_type == "error":
            raise OnlineE2EFailure("sse-model-error", case_slug)
        if event_name == "meta":
            if state != "start" or event_type != "meta" or not isinstance(payload.get("studentTurnId"), int):
                raise OnlineE2EFailure("sse-meta", case_slug)
            if expect_replay and payload.get("replayed") is not True:
                raise OnlineE2EFailure("sse-replay", case_slug)
            state = "meta"
        elif event_name == "delta":
            chunk = payload.get("delta", payload.get("text"))
            if state == "start":
                raise OnlineE2EFailure("sse-meta", case_slug)
            if state not in {"meta", "delta"} or event_type != "delta" or not isinstance(chunk, str) or not chunk:
                raise OnlineE2EFailure("sse-delta", case_slug)
            delta_characters += len(chunk)
            delta_chunks.append(chunk)
            state = "delta"
        elif event_name == "complete":
            completed_text = payload.get("text")
            if (
                state != "delta"
                or event_type != "done"
                or delta_characters < 5
                or not isinstance(completed_text, str)
                or len(completed_text.strip()) < 5
                or not (isinstance(payload.get("patientTurnId"), int) or isinstance(payload.get("turnId"), str))
            ):
                raise OnlineE2EFailure("sse-complete", case_slug)
            streamed_text = "".join(delta_chunks).strip()
            if streamed_text != completed_text.strip() or INTERNAL_METADATA_PATTERN.search(completed_text):
                raise OnlineE2EFailure("sse-content-policy", case_slug)
            if expect_replay and payload.get("replayed") is not True:
                raise OnlineE2EFailure("sse-replay", case_slug)
            state = "complete"
        else:
            raise OnlineE2EFailure("sse-event", case_slug)
    if state != "complete":
        raise OnlineE2EFailure("sse-incomplete", case_slug)


def _stream_message(
    client: httpx.Client,
    headers: dict[str, str],
    session_id: int,
    case_slug: str,
    message: str,
    client_message_id: str,
    *,
    expect_replay: bool = False,
) -> None:
    try:
        with client.stream(
            "POST",
            f"/sessions/{session_id}/messages",
            headers={**headers, "Accept": "text/event-stream"},
            json={"content": message, "clientMessageId": client_message_id},
        ) as response:
            if response.status_code != 200 or not response.headers.get("content-type", "").startswith(
                "text/event-stream"
            ):
                raise OnlineE2EFailure("patient-stream", case_slug)
            _validate_sse(response.iter_lines(), case_slug, expect_replay=expect_replay)
    except OnlineE2EFailure:
        raise
    except httpx.HTTPError as exc:
        raise OnlineE2EFailure("patient-stream", case_slug) from exc


def _start_session(client: httpx.Client, headers: dict[str, str], clinical_case: dict[str, Any]) -> int:
    slug = str(clinical_case["slug"])
    body = _request_json(
        client,
        "POST",
        "/sessions",
        stage="session-start",
        expected_status=201,
        case_slug=slug,
        headers=headers,
        json_body={"caseId": clinical_case["id"]},
    )
    session = body.get("session")
    session_id = session.get("id") if isinstance(session, dict) else body.get("id")
    if isinstance(session_id, bool) or not isinstance(session_id, int) or session_id <= 0:
        raise OnlineE2EFailure("session-start", slug)
    return session_id


def _number(value: Any, *, minimum: float, maximum: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) and minimum <= numeric <= maximum else None


def _validate_result(result: Any, case_slug: str, expected_turn_count: int) -> tuple[int, float, int]:
    if not isinstance(result, dict):
        raise OnlineE2EFailure("evaluation-shape", case_slug, expected_turn_count)
    evaluation_id = result.get("id")
    score = _number(result.get("score"), minimum=0, maximum=100)
    criteria = result.get("criteria")
    transcript = result.get("transcript")
    if (
        isinstance(evaluation_id, bool)
        or not isinstance(evaluation_id, int)
        or evaluation_id <= 0
        or score is None
        or not isinstance(criteria, list)
        or len(criteria) != EXPECTED_CRITERIA_COUNT
        or not isinstance(transcript, list)
        or len(transcript) != 1 + (expected_turn_count * 2)
    ):
        raise OnlineE2EFailure("evaluation-shape", case_slug, expected_turn_count)

    criterion_ids: set[str] = set()
    total_weight = 0.0
    for criterion in criteria:
        if not isinstance(criterion, dict):
            raise OnlineE2EFailure("evaluation-criterion", case_slug, expected_turn_count)
        criterion_id = criterion.get("criterionId")
        criterion_score = _number(criterion.get("score"), minimum=0, maximum=3)
        weight = _number(criterion.get("weight"), minimum=0.001, maximum=100)
        weighted_score = _number(criterion.get("weightedScore"), minimum=0, maximum=100)
        required_shape = (
            isinstance(criterion_id, str)
            and bool(criterion_id.strip())
            and criterion_id not in criterion_ids
            and criterion_score is not None
            and criterion.get("maxScore") == 3
            and weight is not None
            and weighted_score is not None
            and isinstance(criterion.get("name"), str)
            and isinstance(criterion.get("feedback"), str)
            and isinstance(criterion.get("evidenceTurnIds"), list)
            and isinstance(criterion.get("evidenceStatus"), str)
            and isinstance(criterion.get("evidence"), list)
        )
        if not required_shape:
            raise OnlineE2EFailure("evaluation-criterion", case_slug, expected_turn_count)
        criterion_ids.add(criterion_id)
        total_weight += weight
    if not math.isclose(total_weight, 100, abs_tol=0.01):
        raise OnlineE2EFailure("evaluation-weight", case_slug, expected_turn_count)

    for index, turn in enumerate(transcript):
        expected_role = "patient" if index % 2 == 0 else "student"
        if (
            not isinstance(turn, dict)
            or turn.get("role") != expected_role
            or not isinstance(turn.get("content"), str)
            or not turn["content"].strip()
            or not isinstance(turn.get("id"), str)
            or turn.get("status") != "completed"
            or not isinstance(turn.get("createdAt"), str)
        ):
            raise OnlineE2EFailure("evaluation-transcript", case_slug, expected_turn_count)
    return evaluation_id, score, len(criteria)


def _wait_for_result(
    client: httpx.Client,
    headers: dict[str, str],
    session_id: int,
    case_slug: str,
    turn_count: int,
    deadline: float,
) -> tuple[dict[str, Any], int, float, int]:
    while time.monotonic() < deadline:
        body = _request_json(
            client,
            "GET",
            f"/sessions/{session_id}",
            stage="evaluation-poll",
            case_slug=case_slug,
            headers=headers,
        )
        result = body.get("result")
        if isinstance(result, dict):
            evaluation_id, score, criteria_count = _validate_result(result, case_slug, turn_count)
            return result, evaluation_id, score, criteria_count
        if body.get("evaluationStatus") == "failed" or body.get("status") == "evaluation_failed":
            raise OnlineE2EFailure("evaluation-failed", case_slug, turn_count)
        time.sleep(2)
    raise OnlineE2EFailure("evaluation-timeout", case_slug, turn_count)


def _verify_result_surfaces(
    client: httpx.Client,
    headers: dict[str, str],
    session_id: int,
    evaluation_id: int,
    case_slug: str,
    turn_count: int,
) -> None:
    direct = _request_json(
        client,
        "GET",
        f"/sessions/{session_id}/result",
        stage="session-result",
        case_slug=case_slug,
        headers=headers,
    ).get("result")
    _validate_result(direct, case_slug, turn_count)

    result_detail = _request_json(
        client,
        "GET",
        f"/results/{evaluation_id}",
        stage="result-detail",
        case_slug=case_slug,
        headers=headers,
    )
    nested = result_detail.get("result")
    nested_id, _, _ = _validate_result(nested, case_slug, turn_count)
    if nested_id != evaluation_id or result_detail.get("id") != evaluation_id:
        raise OnlineE2EFailure("result-detail", case_slug, turn_count)


def _verify_history(
    client: httpx.Client,
    headers: dict[str, str],
    session_ids: set[int],
    evaluation_ids: set[int],
) -> None:
    history = _request_json(client, "GET", "/history?limit=100", stage="history", headers=headers).get("history")
    if not isinstance(history, list):
        raise OnlineE2EFailure("history")
    history_ids = {item.get("id") for item in history if isinstance(item, dict)}
    if not session_ids.issubset(history_ids):
        raise OnlineE2EFailure("history")

    results_body = _request_json(
        client,
        "GET",
        "/results?limit=100",
        stage="result-list",
        headers=headers,
    )
    results = results_body.get("items", results_body.get("results"))
    if not isinstance(results, list):
        raise OnlineE2EFailure("result-list")
    result_ids = {item.get("id") for item in results if isinstance(item, dict)}
    if not evaluation_ids.issubset(result_ids):
        raise OnlineE2EFailure("result-list")


def _verify_isolation(
    client: httpx.Client,
    second_headers: dict[str, str],
    session_ids: set[int],
    evaluation_ids: set[int],
) -> None:
    for session_id in session_ids:
        _expect_error(
            client,
            "GET",
            f"/sessions/{session_id}",
            stage="session-isolation",
            status=(403, 404),
            headers=second_headers,
        )
        _expect_error(
            client,
            "GET",
            f"/sessions/{session_id}/result",
            stage="session-result-isolation",
            status=(403, 404),
            headers=second_headers,
        )
    for evaluation_id in evaluation_ids:
        _expect_error(
            client,
            "GET",
            f"/results/{evaluation_id}",
            stage="result-isolation",
            status=(403, 404),
            headers=second_headers,
        )

    history = _request_json(
        client,
        "GET",
        "/history?limit=100",
        stage="history-isolation",
        headers=second_headers,
    ).get("history")
    if not isinstance(history, list) or any(
        isinstance(item, dict) and item.get("id") in session_ids for item in history
    ):
        raise OnlineE2EFailure("history-isolation")
    results_body = _request_json(
        client,
        "GET",
        "/results?limit=100",
        stage="result-list-isolation",
        headers=second_headers,
    )
    results = results_body.get("items", results_body.get("results"))
    if not isinstance(results, list) or any(
        isinstance(item, dict) and item.get("id") in evaluation_ids for item in results
    ):
        raise OnlineE2EFailure("result-list-isolation")


def _queue_case(
    client: httpx.Client,
    headers: dict[str, str],
    clinical_case: dict[str, Any],
    question_count: int,
) -> QueuedCase:
    case_slug = str(clinical_case["slug"])
    session_id = _start_session(client, headers, clinical_case)
    message_ids: list[str] = []
    for index in range(question_count):
        message_id = f"online-e2e-{uuid.uuid4().hex}"
        message_ids.append(message_id)
        _stream_message(
            client,
            headers,
            session_id,
            case_slug,
            QUESTIONS[index],
            message_id,
        )

    # A committed retry must replay the prior exchange and must not call the model.
    _stream_message(
        client,
        headers,
        session_id,
        case_slug,
        QUESTIONS[0],
        message_ids[0],
        expect_replay=True,
    )
    _request_json(
        client,
        "POST",
        f"/sessions/{session_id}/complete",
        stage="evaluation-queue",
        expected_status=202,
        case_slug=case_slug,
        headers=headers,
        json_body={},
    )
    return QueuedCase(case_slug, question_count, session_id)


def run_online_e2e() -> RunOutcome:
    base_url = _api_base()
    request_timeout = _timeout_seconds("SIMCLIN_ONLINE_REQUEST_TIMEOUT_SECONDS", 180, 30, 300)
    timeout = httpx.Timeout(request_timeout, connect=min(30, request_timeout))
    with httpx.Client(
        base_url=base_url,
        timeout=timeout,
        follow_redirects=False,
        headers={"User-Agent": "simclin-au-online-e2e/1.0"},
    ) as client:
        health = _request_json(client, "GET", "/health", stage="health")
        build_id = _validate_health(health)
        _validate_cors(client, _web_origin())

        visitor_seed = uuid.uuid4().hex
        first_visitor = f"online-e2e-a-{visitor_seed}"
        second_visitor = f"online-e2e-b-{visitor_seed}"
        first_headers, first_user_id = _login_student(client, first_visitor)
        same_headers, same_user_id = _login_student(client, first_visitor)
        if same_user_id != first_user_id:
            raise OnlineE2EFailure("visitor-stability")
        _request_json(client, "GET", "/auth/me", stage="auth-me", headers=same_headers)

        _expect_error(
            client,
            "GET",
            "/rubrics",
            stage="student-rubric-protection",
            status=403,
            headers=first_headers,
            code="FORBIDDEN",
        )
        _expect_error(
            client,
            "POST",
            "/auth/demo",
            stage="faculty-access-protection",
            status=403,
            json_body={"role": "faculty"},
            code="FACULTY_ACCESS_REQUIRED",
        )

        cases = _published_cases(client, first_headers)
        queued_cases: list[QueuedCase] = []
        session_ids: set[int] = set()
        evaluation_ids: set[int] = set()
        for index, clinical_case in enumerate(cases):
            queued = _queue_case(
                client,
                first_headers,
                clinical_case,
                3 if index == 0 else 1,
            )
            queued_cases.append(queued)
            session_ids.add(queued.session_id)

        evaluation_deadline = time.monotonic() + _timeout_seconds(
            "SIMCLIN_ONLINE_EVALUATION_TIMEOUT_SECONDS",
            300,
            30,
            300,
        )
        outcomes: list[CaseOutcome] = []
        for queued in queued_cases:
            _result, evaluation_id, score, criteria_count = _wait_for_result(
                client,
                first_headers,
                queued.session_id,
                queued.case_slug,
                queued.turn_count,
                evaluation_deadline,
            )
            _verify_result_surfaces(
                client,
                first_headers,
                queued.session_id,
                evaluation_id,
                queued.case_slug,
                queued.turn_count,
            )
            outcomes.append(CaseOutcome(queued.case_slug, queued.turn_count, score, criteria_count))
            evaluation_ids.add(evaluation_id)

        _verify_history(client, first_headers, session_ids, evaluation_ids)
        second_headers, second_user_id = _login_student(client, second_visitor)
        if second_user_id == first_user_id:
            raise OnlineE2EFailure("visitor-isolation")
        _verify_isolation(client, second_headers, session_ids, evaluation_ids)
        return RunOutcome(build_id, tuple(outcomes), True)


def _emit_success(outcome: RunOutcome) -> None:
    for clinical_case in outcome.cases:
        print(
            json.dumps(
                {
                    "status": "passed",
                    "buildId": outcome.build_id,
                    "caseSlug": clinical_case.case_slug,
                    "turnCount": clinical_case.turn_count,
                    "score": clinical_case.score,
                    "criteriaCount": clinical_case.criteria_count,
                    "isolation": outcome.isolation,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )


def _emit_failure(error: OnlineE2EFailure) -> None:
    print(
        json.dumps(
            {
                "status": f"failed@{error.stage}",
                "buildId": None,
                "caseSlug": error.case_slug,
                "turnCount": error.turn_count,
                "score": None,
                "criteriaCount": 0,
                "isolation": False,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )


def main() -> int:
    try:
        outcome = run_online_e2e()
    except OnlineE2EFailure as error:
        _emit_failure(error)
        return 1
    except Exception:
        _emit_failure(OnlineE2EFailure("internal"))
        return 1
    _emit_success(outcome)
    return 0


if __name__ == "__main__":
    sys.exit(main())
