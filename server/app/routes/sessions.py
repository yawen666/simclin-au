from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse

from ..database import Database
from ..errors import AppError, require_found
from ..rate_limit import SlidingWindowRateLimiter
from ..result_service import serialize_result
from ..sessions import (
    MAX_QUESTIONS_PER_SESSION,
    EvaluationCoordinator,
    complete_session_record,
    completed_message_exchange,
    completed_question_count,
    create_pending_student_turn,
    get_completed_turns,
    get_session,
    get_turns,
    opening_statement,
    requeue_evaluation,
)
from ..utils import now_iso, parse_json
from ..webdeps import client_host, current_user, enforce_ai_rate_limit, get_db, require_student

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _positive_id(value: Any, label: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise AppError(400, "VALIDATION_ERROR", f"{label} must be a positive integer") from exc
    if result <= 0:
        raise AppError(400, "VALIDATION_ERROR", f"{label} must be a positive integer")
    return result


def _message(body: dict[str, Any]) -> str:
    value = body.get("message") if body.get("message") is not None else body.get("content")
    message = value.strip() if isinstance(value, str) else ""
    if not message or len(message) > 2000:
        raise AppError(400, "VALIDATION_ERROR", "Message must contain 1 to 2000 characters")
    return message


def _client_message_id(body: dict[str, Any]) -> str | None:
    value = body.get("clientMessageId")
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not 12 <= len(value) <= 128
        or any(
            character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in value
        )
    ):
        raise AppError(400, "VALIDATION_ERROR", "clientMessageId must contain 12 to 128 URL-safe characters")
    return value


def _coordinator(request: Request) -> EvaluationCoordinator:
    coordinator = getattr(request.app.state, "evaluations", None)
    if not isinstance(coordinator, EvaluationCoordinator):
        raise RuntimeError("Evaluation coordinator is not initialised")
    return coordinator


def _rate_limiter(request: Request) -> SlidingWindowRateLimiter:
    limiter = getattr(request.app.state, "rate_limiter", None)
    if not isinstance(limiter, SlidingWindowRateLimiter):
        raise RuntimeError("Session rate limiter is not initialised")
    return limiter


def _enforce_session_request_limit(request: Request, user: dict[str, Any]) -> None:
    settings = request.app.state.settings
    retry_after = _rate_limiter(request).consume_many(
        (
            (f"session-request-user:{user.get('sub')}", settings.session_requests_per_user_per_hour),
            (f"session-request-ip:{client_host(request)}", settings.session_requests_per_ip_per_hour),
            ("session-request-global", settings.session_global_requests_per_hour),
        )
    )
    if retry_after:
        raise AppError(
            429,
            "SESSION_REQUEST_RATE_LIMITED",
            "This preview has reached its hourly session request limit. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )


def _enforce_session_start_rate_limit(request: Request, user: dict[str, Any]) -> None:
    settings = request.app.state.settings
    retry_after = _rate_limiter(request).consume_many(
        (
            (f"session-start-user:{user.get('sub')}", settings.session_starts_per_user_per_hour),
            (f"session-start-ip:{client_host(request)}", settings.session_starts_per_ip_per_hour),
            ("session-start-global", settings.session_starts_global_per_hour),
        )
    )
    if retry_after:
        raise AppError(
            429,
            "SESSION_START_RATE_LIMITED",
            "This preview has reached its hourly session-start limit. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )


def _enforce_session_capacity(counts: Any, request: Request) -> None:
    settings = request.app.state.settings
    if int(counts["user_total"] or 0) >= settings.max_sessions_per_student:
        raise AppError(
            409,
            "STUDENT_SESSION_CAPACITY_REACHED",
            "This student profile has reached its saved-session capacity.",
        )
    if int(counts["total"] or 0) >= settings.max_total_sessions:
        raise AppError(
            503,
            "SESSION_STORAGE_CAPACITY_REACHED",
            "This preview has reached its saved-session capacity.",
        )


@router.post("", status_code=status.HTTP_201_CREATED)
@router.post("/", status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def start_session(
    request: Request,
    body: dict[str, Any] = Body(...),
    user: dict[str, Any] = Depends(require_student),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    case_id = _positive_id(body.get("caseId"), "caseId")
    # Reject request floods before published-case reads and, critically, before
    # acquiring SQLite's process-wide writer reservation.
    _enforce_session_request_limit(request, user)
    with db.connection() as connection:
        row = connection.execute(
            """SELECT c.id,c.title,c.specialty,c.published_version,cv.id AS case_version_id,
            cv.content_json,cv.metadata_json,
            rv.id AS rubric_version_id FROM cases c
            JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
            JOIN case_rubrics cr ON cr.case_id=c.id
            JOIN rubrics r ON r.id=COALESCE(cv.rubric_id,cr.rubric_id) AND r.status='published'
            JOIN rubric_versions rv ON rv.rubric_id=r.id AND rv.version=r.published_version
            WHERE c.id=? AND c.status='published'""",
            (case_id,),
        ).fetchone()
        counts = connection.execute(
            """SELECT COUNT(*) AS total,
            SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS user_total
            FROM sessions""",
            (int(user["sub"]),),
        ).fetchone()
    published_case = dict(require_found(row, "Published case"))
    _enforce_session_capacity(counts, request)
    # The successful-start quota is distinct from the broader request gate,
    # but it too runs before the write transaction so rejected traffic cannot
    # contend for SQLite's single writer lock.
    _enforce_session_start_rate_limit(request, user)
    created_at = now_iso()
    content = parse_json(published_case["content_json"], {})
    metadata = parse_json(published_case["metadata_json"], {})
    opening = opening_statement(content)
    with db.connection(write=True) as connection:
        # Take the SQLite write reservation before checking capacity so two
        # concurrent requests cannot both observe the last available slot.
        connection.execute("BEGIN IMMEDIATE")
        counts = connection.execute(
            """SELECT COUNT(*) AS total,
            SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS user_total
            FROM sessions""",
            (int(user["sub"]),),
        ).fetchone()
        _enforce_session_capacity(counts, request)
        result = connection.execute(
            """INSERT INTO sessions
            (user_id,case_id,case_version_id,rubric_version_id,case_title_snapshot,
             case_specialty_snapshot,status,started_at)
            VALUES (?,?,?,?,?,?, 'active',?)""",
            (
                int(user["sub"]),
                case_id,
                published_case["case_version_id"],
                published_case["rubric_version_id"],
                metadata.get("title", published_case["title"]),
                metadata.get("specialty", published_case["specialty"]),
                created_at,
            ),
        )
        session_id = int(result.lastrowid)
        turn_result = connection.execute(
            """INSERT INTO turns
            (session_id,sequence,speaker,content,disclosed_facts_json,created_at)
            VALUES (?,1,'patient',?,'[]',?)""",
            (session_id, opening, created_at),
        )
        first_turn_id = int(turn_result.lastrowid)
    first_turn = {
        "id": first_turn_id,
        "sequence": 1,
        "speaker": "patient",
        "role": "patient",
        "content": opening,
        "createdAt": created_at,
    }
    session = {
        "id": session_id,
        "caseId": case_id,
        "status": "active",
        "evaluationStatus": "not_started",
        "startedAt": created_at,
        "turns": [first_turn],
        "openingStatement": opening,
    }
    return {**session, "session": session, "openingStatement": opening}


@router.get("")
@router.get("/", include_in_schema=False)
async def list_sessions(
    request: Request,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=1_000_000),
    user: dict[str, Any] = Depends(current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    with db.connection() as connection:
        total_row = connection.execute(
            "SELECT COUNT(*) AS total FROM sessions WHERE user_id=?",
            (int(user["sub"]),),
        ).fetchone()
        rows = connection.execute(
            """SELECT s.id,s.case_id AS caseId,
            COALESCE(s.case_title_snapshot,c.title) AS caseTitle,
            CASE
              WHEN s.evaluation_status IN ('queued','running') THEN 'evaluating'
              WHEN s.evaluation_status='failed' THEN 'evaluation_failed'
              ELSE s.status
            END AS status,
            s.evaluation_status AS evaluationStatus,s.evaluation_error AS evaluationError,
            s.started_at AS startedAt,s.completed_at AS completedAt,
            s.duration_seconds AS durationSeconds,e.id AS resultId,
            COALESCE((SELECT override_score FROM teacher_overrides o
              WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score) AS score
            FROM sessions s JOIN cases c ON c.id=s.case_id
            LEFT JOIN evaluations e ON e.session_id=s.id
            WHERE s.user_id=? ORDER BY s.started_at DESC,s.id DESC LIMIT ? OFFSET ?""",
            (int(user["sub"]), limit, offset),
        ).fetchall()
    items = [dict(row) for row in rows]
    coordinator = _coordinator(request)
    for item in items:
        if item["resultId"] is None and item["evaluationStatus"] in {"queued", "running"}:
            coordinator.queue_evaluation(int(item["id"]))
    return {
        "sessions": items,
        "items": items,
        "total": int(total_row["total"]),
        "limit": limit,
        "offset": offset,
    }


@router.get("/{session_id}")
async def session_detail(
    session_id: int,
    request: Request,
    user: dict[str, Any] = Depends(current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    session = get_session(db, session_id, int(user["sub"]), str(user["role"]))
    turns = [{**turn, "role": turn["speaker"]} for turn in get_completed_turns(db, session_id)]
    result = serialize_result(db, session_id)
    if result is None and session["evaluation_status"] in {"queued", "running"}:
        _coordinator(request).queue_evaluation(session_id)
    if session["evaluation_status"] == "failed":
        session_status = "evaluation_failed"
    elif session["evaluation_status"] in {"queued", "running"}:
        session_status = "evaluating"
    else:
        session_status = session["status"]
    detail = {
        "id": session_id,
        "caseId": session["case_id"],
        "caseTitle": session["title"],
        "specialty": session["specialty"],
        "status": session_status,
        "evaluationStatus": session["evaluation_status"],
        "evaluationError": session["evaluation_error"],
        "startedAt": session["started_at"],
        "completedAt": session["completed_at"],
        "turns": turns,
        "result": result,
    }
    return {**detail, "session": detail}


@router.post("/{session_id}/messages")
@router.post("/{session_id}/messages/stream", include_in_schema=False)
async def stream_message(
    session_id: int,
    request: Request,
    body: dict[str, Any] = Body(...),
    user: dict[str, Any] = Depends(require_student),
    db: Database = Depends(get_db),
) -> StreamingResponse:
    message = _message(body)
    client_message_id = _client_message_id(body)
    session = get_session(db, session_id, int(user["sub"]), str(user["role"]))
    coordinator = _coordinator(request)
    replay = completed_message_exchange(db, session_id, client_message_id, message)
    if replay is not None:
        return StreamingResponse(
            coordinator.replay_message_events(
                student_turn_id=int(replay["student_turn_id"]),
                patient_turn_id=int(replay["patient_turn_id"]),
                patient_reply=str(replay["patient_content"]),
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )
    if session["status"] != "active":
        raise AppError(409, "SESSION_NOT_ACTIVE", "This session is no longer active")
    if coordinator.message_is_active(session_id):
        raise AppError(409, "SESSION_BUSY", "Please wait for the simulated patient to finish responding")
    if completed_question_count(db, session_id) >= MAX_QUESTIONS_PER_SESSION:
        raise AppError(
            409,
            "SESSION_LIMIT_REACHED",
            f"This practice session is limited to {MAX_QUESTIONS_PER_SESSION} questions",
        )
    enforce_ai_rate_limit(request, user)
    if not coordinator.reserve_message(session_id):
        raise AppError(409, "SESSION_BUSY", "Please wait for the simulated patient to finish responding")
    try:
        student_turn_id, student_sequence = create_pending_student_turn(
            db,
            session_id,
            message,
            client_message_id,
        )
    except Exception:
        coordinator.release_message(session_id)
        raise

    # Retain failed turns for audit, but expose only completed turns plus the
    # current pending question to either model call.
    transcript = [
        turn
        for turn in get_turns(db, session_id)
        if turn["status"] == "completed" or int(turn["id"]) == student_turn_id
    ]
    content = parse_json(session["content_json"], {})
    events = coordinator.stream_message_events(
        session_id=session_id,
        student_turn_id=student_turn_id,
        student_sequence=student_sequence,
        message=message,
        session=session,
        transcript=transcript,
        case_content=content,
    )
    return StreamingResponse(
        events,
        status_code=status.HTTP_200_OK,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{session_id}/complete")
async def complete_session(
    session_id: int,
    request: Request,
    response: Response,
    user: dict[str, Any] = Depends(require_student),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    session = get_session(db, session_id, int(user["sub"]), str(user["role"]))
    prior = serialize_result(db, session_id)
    if prior is not None:
        return {"status": "completed", "resultId": str(prior["id"]), "result": prior}
    if session["status"] == "abandoned":
        raise AppError(409, "SESSION_NOT_ACTIVE", "This session is no longer active")
    coordinator = _coordinator(request)
    if session["evaluation_status"] in {"queued", "running"}:
        coordinator.queue_evaluation(session_id)
        response.status_code = status.HTTP_202_ACCEPTED
        return {
            "status": "evaluating",
            "sessionId": str(session_id),
            "message": "Feedback generation has started. You can review it from practice history when it is ready.",
        }
    if coordinator.message_is_active(session_id):
        raise AppError(409, "SESSION_BUSY", "Please wait for the simulated patient to finish responding")
    transcript = get_completed_turns(db, session_id)
    if not any(turn["speaker"] == "student" for turn in transcript):
        raise AppError(400, "EMPTY_SESSION", "Ask the patient at least one question before ending the consultation")
    if session["status"] == "active":
        enforce_ai_rate_limit(request, user)
        complete_session_record(db, session, session_id)
    elif session["evaluation_status"] in {"failed", "not_started"}:
        enforce_ai_rate_limit(request, user)
        requeue_evaluation(db, session_id)
    else:
        enforce_ai_rate_limit(request, user)
        requeue_evaluation(db, session_id)
    coordinator.queue_evaluation(session_id)
    response.status_code = status.HTTP_202_ACCEPTED
    return {
        "status": "evaluating",
        "sessionId": str(session_id),
        "message": "Feedback generation has started. You can review it from practice history when it is ready.",
    }


@router.get("/{session_id}/result")
async def session_result(
    session_id: int,
    user: dict[str, Any] = Depends(current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    get_session(db, session_id, int(user["sub"]), str(user["role"]))
    return {"result": require_found(serialize_result(db, session_id), "Result")}
