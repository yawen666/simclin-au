from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from ..result_service import serialize_result
from ..webdeps import current_user

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
def history(
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, Any]:
    db = request.app.state.db
    with db.connection() as connection:
        rows = connection.execute(
            """
            SELECT s.id,s.case_id AS caseId,
              COALESCE(s.case_title_snapshot,c.title) AS title,
              COALESCE(s.case_specialty_snapshot,c.specialty) AS specialty,
              CASE
                WHEN s.evaluation_status IN ('queued','running') THEN 'evaluating'
                WHEN s.evaluation_status='failed' THEN 'evaluation_failed'
                ELSE s.status
              END AS status,
              s.evaluation_status AS evaluationStatus,s.evaluation_error AS evaluationError,
              s.started_at AS startedAt,s.completed_at AS completedAt,s.duration_seconds AS durationSeconds,
              (SELECT COUNT(*) FROM turns t
                WHERE t.session_id=s.id AND t.speaker='student' AND t.status='completed') AS questionCount
            FROM sessions s JOIN cases c ON c.id=s.case_id
            WHERE s.user_id=? ORDER BY s.started_at DESC LIMIT ?
            """,
            (user["sub"], limit),
        ).fetchall()
    return {
        "history": [
            {
                **dict(row),
                "result": serialize_result(db, int(row["id"])),
            }
            for row in rows
        ]
    }
