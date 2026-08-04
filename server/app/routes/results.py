from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..errors import AppError, require_found
from ..result_service import serialize_result, serialize_result_summary
from ..utils import now_iso
from ..webdeps import current_user

router = APIRouter(prefix="/api/results", tags=["results"])


class OverrideBody(BaseModel):
    score: float = Field(ge=0, le=100)
    reason: str | None = None
    comment: str | None = None


def _evaluation_for(db: Any, evaluation_id: int) -> dict[str, Any] | None:
    with db.connection() as connection:
        row = connection.execute(
            "SELECT id,session_id,score FROM evaluations WHERE id=?",
            (evaluation_id,),
        ).fetchone()
    return dict(row) if row is not None else None


@router.get("")
def list_results(
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
    case_id: int | None = Query(default=None, alias="caseId", gt=0),
    query: str | None = Query(default=None, max_length=100),
    review: Literal["all", "adjusted", "unadjusted"] = Query(default="all"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    conditions = ["s.status='completed'"]
    arguments: list[Any] = []
    if user["role"] == "student":
        conditions.append("s.user_id=?")
        arguments.append(user["sub"])
    if case_id is not None:
        conditions.append("s.case_id=?")
        arguments.append(case_id)
    search = (query or "").strip()
    if search:
        conditions.append(
            "(instr(lower(COALESCE(s.case_title_snapshot,c.title)),lower(?))>0 "
            "OR instr(lower(u.display_name),lower(?))>0)"
        )
        arguments.extend((search, search))
    if review == "adjusted":
        conditions.append("EXISTS (SELECT 1 FROM teacher_overrides o WHERE o.evaluation_id=e.id)")
    elif review == "unadjusted":
        conditions.append("NOT EXISTS (SELECT 1 FROM teacher_overrides o WHERE o.evaluation_id=e.id)")
    page_arguments = [*arguments, limit, offset]
    with request.app.state.db.connection() as connection:
        rows = connection.execute(
            f"""
            SELECT e.id,e.session_id,s.case_id,
              COALESCE(s.case_title_snapshot,c.title) AS title,
              COALESCE(s.case_specialty_snapshot,c.specialty) AS specialty,
              u.display_name AS student_name,e.score AS ai_score,e.created_at,
              s.completed_at,s.duration_seconds,
              (SELECT override_score FROM teacher_overrides o
                WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1) AS override_score
            FROM sessions s JOIN evaluations e ON e.session_id=s.id
            JOIN cases c ON c.id=s.case_id JOIN users u ON u.id=s.user_id
            WHERE {" AND ".join(conditions)}
            ORDER BY s.completed_at DESC LIMIT ? OFFSET ?
            """,
            page_arguments,
        ).fetchall()
        total = connection.execute(
            f"""SELECT COUNT(*) AS count FROM sessions s
            JOIN evaluations e ON e.session_id=s.id
            JOIN cases c ON c.id=s.case_id JOIN users u ON u.id=s.user_id
            WHERE {" AND ".join(conditions)}""",
            arguments,
        ).fetchone()["count"]
    results = [serialize_result_summary(row) for row in rows]
    return {"results": results, "items": results, "total": total, "limit": limit, "offset": offset}


@router.get("/{evaluation_id}")
def get_result(
    evaluation_id: int,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    if evaluation_id <= 0:
        raise AppError(400, "VALIDATION_ERROR", "Request validation failed")
    db = request.app.state.db
    evaluation = require_found(_evaluation_for(db, evaluation_id), "Result")
    with db.connection() as connection:
        session = connection.execute("SELECT user_id FROM sessions WHERE id=?", (evaluation["session_id"],)).fetchone()
        if user["role"] != "faculty" and session["user_id"] != user["sub"]:
            raise AppError(403, "FORBIDDEN", "This result is not available")
        turn_rows = connection.execute(
            """
            SELECT id,sequence,speaker,content,created_at AS createdAt
            FROM turns WHERE session_id=? AND status='completed' ORDER BY sequence
            """,
            (evaluation["session_id"],),
        ).fetchall()
    turns = [dict(row) for row in turn_rows]
    result = require_found(serialize_result(db, evaluation["session_id"]), "Result")
    return {**result, "result": result, "turns": turns}


def _override_result(
    evaluation_id: int,
    body: OverrideBody,
    request: Request,
    user: dict[str, Any],
) -> dict[str, Any]:
    if user["role"] != "faculty":
        raise AppError(403, "FORBIDDEN", "Faculty access is required")
    if evaluation_id <= 0:
        raise AppError(400, "VALIDATION_ERROR", "Request validation failed")
    reason = (body.reason if body.reason is not None else body.comment or "").strip()
    if len(reason) < 5 or len(reason) > 1000:
        raise AppError(
            400,
            "VALIDATION_ERROR",
            "Request validation failed",
            [
                {
                    "code": "custom",
                    "message": "A review reason of 5 to 1000 characters is required",
                }
            ],
        )

    db = request.app.state.db
    evaluation = require_found(_evaluation_for(db, evaluation_id), "Result")
    with db.connection(write=True) as connection:
        prior = connection.execute(
            """
            SELECT override_score FROM teacher_overrides
            WHERE evaluation_id=? ORDER BY id DESC LIMIT 1
            """,
            (evaluation_id,),
        ).fetchone()
        previous_score = prior["override_score"] if prior is not None else evaluation["score"]
        connection.execute(
            """
            INSERT INTO teacher_overrides
              (evaluation_id,faculty_user_id,previous_score,override_score,reason,created_at)
            VALUES (?,?,?,?,?,?)
            """,
            (
                evaluation_id,
                user["sub"],
                previous_score,
                body.score,
                reason,
                now_iso(),
            ),
        )
    result = require_found(serialize_result(db, evaluation["session_id"]), "Result")
    return {**result, "result": result}


@router.post("/{evaluation_id}/override")
def create_override(
    evaluation_id: int,
    body: OverrideBody,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    return _override_result(evaluation_id, body, request, user)


@router.patch("/{evaluation_id}/override")
def update_override(
    evaluation_id: int,
    body: OverrideBody,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    return _override_result(evaluation_id, body, request, user)
