from __future__ import annotations

import math
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from ..result_service import red_flag_label_map, serialize_result
from ..utils import parse_json
from ..webdeps import require_faculty

router = APIRouter(prefix="/api/insights", tags=["insights"])


def _js_round(value: float) -> int:
    return math.floor(value + 0.5)


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


@router.get("")
def insights(
    request: Request,
    _user: Annotated[dict[str, Any], Depends(require_faculty)],
) -> dict[str, Any]:
    db = request.app.state.db
    with db.connection() as connection:
        summary = dict(
            connection.execute(
                """
                SELECT COUNT(*) AS completedSessions,
                  ROUND(AVG(COALESCE((SELECT override_score FROM teacher_overrides o
                    WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score)),1) AS averageScore,
                  ROUND(AVG(s.duration_seconds),0) AS averageDurationSeconds
                FROM evaluations e JOIN sessions s ON s.id=e.session_id
                """
            ).fetchone()
        )
        by_case = [
            dict(row)
            for row in connection.execute(
                """
                SELECT c.id AS caseId,c.title,c.specialty,COUNT(*) AS attempts,
                  ROUND(AVG(COALESCE((SELECT override_score FROM teacher_overrides o
                    WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score)),1) AS averageScore
                FROM evaluations e JOIN sessions s ON s.id=e.session_id JOIN cases c ON c.id=s.case_id
                GROUP BY c.id ORDER BY c.id
                """
            ).fetchall()
        ]
        domain_rows = connection.execute(
            """
            SELECT cs.criterion_id AS criterionId,cs.score,rv.criteria_json AS criteriaJson
            FROM criterion_scores cs JOIN evaluations e ON e.id=cs.evaluation_id
            JOIN sessions s ON s.id=e.session_id JOIN rubric_versions rv ON rv.id=s.rubric_version_id
            """
        ).fetchall()
        level_distribution = [
            dict(row)
            for row in connection.execute(
                "SELECT level,COUNT(*) AS count FROM evaluations GROUP BY level ORDER BY count DESC"
            ).fetchall()
        ]
        attempt_summary = dict(
            connection.execute(
                """
                SELECT COUNT(*) AS totalAttempts,
                  SUM(CASE WHEN evaluation_status='completed' THEN 1 ELSE 0 END) AS completed
                FROM sessions
                """
            ).fetchone()
        )
        published = dict(connection.execute("SELECT COUNT(*) AS count FROM cases WHERE status='published'").fetchone())
        score_rows = connection.execute(
            """
            SELECT COALESCE((SELECT override_score FROM teacher_overrides o
              WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1),e.score) AS score
            FROM evaluations e ORDER BY score
            """
        ).fetchall()
        feedback_rows = connection.execute(
            """
            SELECT e.feedback_json,cv.content_json FROM evaluations e
            JOIN sessions s ON s.id=e.session_id JOIN case_versions cv ON cv.id=s.case_version_id
            """
        ).fetchall()
        recent_sessions = connection.execute(
            "SELECT id FROM sessions WHERE status='completed' ORDER BY completed_at DESC LIMIT 5"
        ).fetchall()
        model_summary = dict(
            connection.execute(
                """
                SELECT COUNT(*) AS totalRuns,
                  SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successfulRuns,
                  SUM(CASE WHEN status!='success' THEN 1 ELSE 0 END) AS failedRuns,
                  ROUND(AVG(latency_ms),0) AS averageLatencyMs,
                  COALESCE(SUM(input_tokens),0) AS inputTokens,
                  COALESCE(SUM(output_tokens),0) AS outputTokens
                FROM model_runs
                """
            ).fetchone()
        )
        model_by_purpose = [
            dict(row)
            for row in connection.execute(
                """
                SELECT purpose,COUNT(*) AS total,
                  SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successful,
                  ROUND(AVG(latency_ms),0) AS averageLatencyMs
                FROM model_runs GROUP BY purpose ORDER BY purpose
                """
            ).fetchall()
        ]
        recent_model_runs = [
            dict(row)
            for row in connection.execute(
                """
                SELECT provider,model,purpose,prompt_version AS promptVersion,
                  latency_ms AS latencyMs,status,error_code AS errorCode,created_at AS createdAt
                FROM model_runs ORDER BY created_at DESC LIMIT 12
                """
            ).fetchall()
        ]

    domain_accumulator: dict[str, dict[str, Any]] = {}
    for row in domain_rows:
        criterion_id = row["criterionId"]
        rubric = parse_json(row["criteriaJson"], [])
        rubric = rubric if isinstance(rubric, list) else []
        definition = next(
            (criterion for criterion in rubric if isinstance(criterion, dict) and criterion.get("id") == criterion_id),
            None,
        )
        current = domain_accumulator.setdefault(
            criterion_id,
            {
                "criterionId": criterion_id,
                "label": (
                    definition.get("label") or definition.get("name") or criterion_id if definition else criterion_id
                ),
                "total": 0.0,
                "count": 0,
            },
        )
        current["total"] += _number(row["score"])
        current["count"] += 1
    domains = sorted(
        [
            {
                "criterionId": item["criterionId"],
                "label": item["label"],
                "averageScore": _js_round((item["total"] / item["count"]) * 100) / 100,
                "assessments": item["count"],
            }
            for item in domain_accumulator.values()
        ],
        key=lambda item: item["averageScore"],
    )

    sorted_scores = [_number(item["score"]) for item in score_rows]
    middle = len(sorted_scores) // 2
    if not sorted_scores:
        median_score: float | int = 0
    elif len(sorted_scores) % 2:
        median_score = sorted_scores[middle]
    else:
        median_score = _js_round((sorted_scores[middle - 1] + sorted_scores[middle]) / 2)
    score_distribution = [
        {"label": "0–49", "value": len([score for score in sorted_scores if score < 50])},
        {
            "label": "50–69",
            "value": len([score for score in sorted_scores if 50 <= score < 70]),
        },
        {
            "label": "70–84",
            "value": len([score for score in sorted_scores if 70 <= score < 85]),
        },
        {"label": "85–100", "value": len([score for score in sorted_scores if score >= 85])},
    ]
    domain_scores = [
        {
            "id": item["criterionId"],
            "name": item["label"],
            "value": _js_round((_number(item["averageScore"]) / 3) * 100),
        }
        for item in domains
    ]

    missed_counts: dict[str, dict[str, Any]] = {}
    for row in feedback_rows:
        try:
            feedback = parse_json(row["feedback_json"], {})
            missed = feedback.get("missed_red_flags", [])
            content = parse_json(row["content_json"], {})
            labels = red_flag_label_map(content if isinstance(content, dict) else {})
            for red_flag_id in missed if isinstance(missed, list) else []:
                if not isinstance(red_flag_id, str):
                    continue
                current = missed_counts.setdefault(
                    red_flag_id,
                    {"label": labels.get(red_flag_id, red_flag_id), "count": 0},
                )
                current["count"] += 1
        except (AttributeError, TypeError, ValueError):
            # Corrupt historical feedback is ignored in aggregate analytics.
            continue
    common_misses = sorted(
        [{"id": red_flag_id, **value} for red_flag_id, value in missed_counts.items()],
        key=lambda item: item["count"],
        reverse=True,
    )
    recent_results = [result for row in recent_sessions if (result := serialize_result(db, int(row["id"]))) is not None]

    total_attempts = int(attempt_summary.get("totalAttempts") or 0)
    completed = int(attempt_summary.get("completed") or 0)
    total_runs = int(model_summary.get("totalRuns") or 0)
    successful_runs = int(model_summary.get("successfulRuns") or 0)
    return {
        "summary": summary,
        "byCase": by_case,
        "domains": domains,
        "levelDistribution": level_distribution,
        "stats": {
            "publishedCases": published["count"],
            "totalAttempts": total_attempts,
            "completionRate": _js_round((completed / total_attempts) * 100) if total_attempts else 0,
            "medianScore": median_score,
        },
        "scoreDistribution": score_distribution,
        "domainScores": domain_scores,
        "commonMisses": common_misses,
        "recentResults": recent_results,
        "aiQuality": {
            "totalRuns": total_runs,
            "successfulRuns": successful_runs,
            "failedRuns": int(model_summary.get("failedRuns") or 0),
            "successRate": _js_round((successful_runs / total_runs) * 100) if total_runs else 0,
            "averageLatencyMs": _number(model_summary.get("averageLatencyMs")),
            "inputTokens": _number(model_summary.get("inputTokens")),
            "outputTokens": _number(model_summary.get("outputTokens")),
            "byPurpose": model_by_purpose,
            "recentRuns": recent_model_runs,
        },
    }
