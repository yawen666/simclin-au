from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..errors import AppError, require_found
from ..result_service import serialize_result
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
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    conditions = ["s.status='completed'"]
    arguments: list[Any] = []
    if user["role"] == "student":
        conditions.append("s.user_id=?")
        arguments.append(user["sub"])
    if case_id is not None:
        conditions.append("s.case_id=?")
        arguments.append(case_id)
    arguments.append(limit)
    with request.app.state.db.connection() as connection:
        rows = connection.execute(
            f"""
            SELECT s.id FROM sessions s
            WHERE {" AND ".join(conditions)}
            ORDER BY s.completed_at DESC LIMIT ?
            """,
            arguments,
        ).fetchall()
    results = [result for row in rows if (result := serialize_result(request.app.state.db, int(row["id"]))) is not None]
    return {"results": results, "items": results}


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
