from __future__ import annotations

import re
from typing import Any

from .utils import parse_json, remove_turn_number_references

EvidenceStatus = str


def red_flag_label_map(content: dict[str, Any]) -> dict[str, str]:
    """Return readable labels for both atomic and grouped red-flag IDs."""
    case_data = content.get("caseData")
    if not isinstance(case_data, dict):
        return {}

    labels: dict[str, str] = {}
    facts = case_data.get("atomicFacts")
    if isinstance(facts, list):
        for fact in facts:
            if not isinstance(fact, dict):
                continue
            fact_id, label = fact.get("id"), fact.get("label")
            if isinstance(fact_id, str) and isinstance(label, str):
                labels[fact_id] = label

    red_flags = case_data.get("redFlags")
    if isinstance(red_flags, list):
        for red_flag in red_flags:
            if not isinstance(red_flag, dict):
                continue
            red_flag_id, label = red_flag.get("id"), red_flag.get("label")
            if isinstance(red_flag_id, str) and isinstance(label, str):
                labels[red_flag_id] = label
    return labels


def _evidence_status(
    criterion: dict[str, Any] | None,
    evidence_turn_ids: list[int],
    transcript: list[dict[str, Any]],
    content: dict[str, Any],
) -> EvidenceStatus:
    if evidence_turn_ids:
        return "covered"

    student_messages = [str(turn.get("content", "")).lower() for turn in transcript if turn.get("role") == "student"]
    case_data = content.get("caseData")
    if not isinstance(case_data, dict):
        case_data = {}
    facts = case_data.get("atomicFacts")
    facts = facts if isinstance(facts, list) else []
    fact_by_id = {fact["id"]: fact for fact in facts if isinstance(fact, dict) and isinstance(fact.get("id"), str)}
    red_flags = case_data.get("redFlags")
    red_flags = red_flags if isinstance(red_flags, list) else []

    red_flag_ids = criterion.get("redFlagIds", []) if isinstance(criterion, dict) else []
    red_flag_ids = red_flag_ids if isinstance(red_flag_ids, list) else []
    triggers: list[str] = []
    for red_flag_id in red_flag_ids:
        definition = next(
            (value for value in red_flags if isinstance(value, dict) and value.get("id") == red_flag_id),
            None,
        )
        linked_ids = definition.get("linkedFactIds", []) if definition else [red_flag_id]
        linked_ids = linked_ids if isinstance(linked_ids, list) else []
        for fact_id in linked_ids:
            fact = fact_by_id.get(fact_id)
            fact_triggers = fact.get("triggers", []) if isinstance(fact, dict) else []
            if not isinstance(fact_triggers, list):
                continue
            triggers.extend(
                trigger.lower().strip()
                for trigger in fact_triggers
                if isinstance(trigger, str) and len(trigger.strip()) >= 3
            )
    if any(trigger in message for trigger in triggers for message in student_messages):
        return "asked_no_credit"

    label = criterion.get("label", "") if isinstance(criterion, dict) else ""
    description = criterion.get("description", "") if isinstance(criterion, dict) else ""
    ignored = {"history", "patient", "questions", "relevant", "information"}
    keywords = [
        word
        for word in re.split(r"[^a-z0-9]+", f"{label} {description}".lower())
        if len(word) >= 5 and word not in ignored
    ]
    if any(keyword in message for keyword in keywords for message in student_messages):
        return "asked_no_credit"
    return "not_asked"


def _number(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coalesce(value: Any, fallback: Any) -> Any:
    return fallback if value is None else value


def serialize_result(db: Any, session_id: int) -> dict[str, Any] | None:
    """Serialize an evaluation using the established Vue-facing API contract."""
    with db.connection() as connection:
        row = connection.execute(
            """
            SELECT e.*,s.case_id,COALESCE(s.case_title_snapshot,c.title) AS title,
              COALESCE(s.case_specialty_snapshot,c.specialty) AS specialty,
              s.started_at,s.completed_at,s.duration_seconds,
              u.display_name AS student_name,rv.criteria_json,cv.content_json,
              (SELECT override_score FROM teacher_overrides o
                WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1) AS override_score,
              (SELECT reason FROM teacher_overrides o
                WHERE o.evaluation_id=e.id ORDER BY o.id DESC LIMIT 1) AS override_reason
            FROM evaluations e JOIN sessions s ON s.id=e.session_id JOIN cases c ON c.id=s.case_id
            JOIN users u ON u.id=s.user_id JOIN rubric_versions rv ON rv.id=s.rubric_version_id
            JOIN case_versions cv ON cv.id=s.case_version_id
            WHERE e.session_id=?
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        evaluation = dict(row)
        criterion_rows = connection.execute(
            """
            SELECT criterion_id AS criterionId,score,weighted_score AS weightedScore,
              evidence_turn_ids_json,feedback
            FROM criterion_scores WHERE evaluation_id=? ORDER BY id
            """,
            (evaluation["id"],),
        ).fetchall()
        turn_rows = connection.execute(
            """
            SELECT id,sequence,speaker,content,status,created_at AS createdAt
            FROM turns WHERE session_id=? AND status='completed' ORDER BY sequence
            """,
            (session_id,),
        ).fetchall()

    final_score = _number(
        evaluation["override_score"] if evaluation["override_score"] is not None else evaluation["score"]
    )
    final_level = (
        "Excellent"
        if final_score >= 85
        else "Competent"
        if final_score >= 70
        else "Developing"
        if final_score >= 50
        else "Needs improvement"
    )
    rubric = parse_json(evaluation["criteria_json"], [])
    rubric = rubric if isinstance(rubric, list) else []
    rubric_by_id = {
        str(item.get("id")): item for item in rubric if isinstance(item, dict) and item.get("id") is not None
    }
    feedback = remove_turn_number_references(parse_json(evaluation["feedback_json"], {}))
    feedback = feedback if isinstance(feedback, dict) else {}
    scoring = feedback.get("scoring")
    scoring = scoring if isinstance(scoring, dict) else {}
    content = parse_json(evaluation["content_json"], {})
    content = content if isinstance(content, dict) else {}
    red_flag_labels = red_flag_label_map(content)
    raw_missed_ids = feedback.get("missed_red_flags")
    missed_red_flag_ids = (
        [value for value in raw_missed_ids if isinstance(value, str)] if isinstance(raw_missed_ids, list) else []
    )
    raw_reasons = feedback.get("missed_red_flag_reasons")
    missed_reasons = raw_reasons if isinstance(raw_reasons, dict) else {}

    transcript = [
        {
            "id": str(turn["id"]),
            "role": turn["speaker"],
            "content": turn["content"],
            "status": turn["status"],
            "createdAt": turn["createdAt"],
        }
        for turn in turn_rows
    ]
    transcript_by_id = {int(turn["id"]): turn for turn in transcript}
    criteria: list[dict[str, Any]] = []
    for raw_item in criterion_rows:
        item = dict(raw_item)
        criterion_id = str(item["criterionId"])
        definition = rubric_by_id.get(criterion_id)
        evidence_ids = parse_json(item["evidence_turn_ids_json"], [])
        evidence_ids = (
            [int(value) for value in evidence_ids if isinstance(value, (int, float))]
            if isinstance(evidence_ids, list)
            else []
        )
        numeric_score = _number(item["score"])
        definition_label = definition.get("label") if isinstance(definition, dict) else None
        criteria.append(
            {
                "criterionId": item["criterionId"],
                "name": item["criterionId"] if definition_label is None else definition_label,
                "score": numeric_score,
                "maxScore": 3,
                "weight": _number(definition.get("weight") if definition else 0),
                "level": (
                    "Excellent"
                    if numeric_score >= 2.5
                    else "Competent"
                    if numeric_score >= 2
                    else "Developing"
                    if numeric_score >= 1
                    else "Needs improvement"
                ),
                "weightedScore": _number(item["weightedScore"]),
                "evidenceTurnIds": evidence_ids,
                "evidenceStatus": _evidence_status(definition, evidence_ids, transcript, content),
                "evidence": [
                    {"turnId": str(turn_id), "quote": transcript_by_id[turn_id]["content"]}
                    for turn_id in evidence_ids
                    if turn_id in transcript_by_id
                ],
                "feedback": remove_turn_number_references(item["feedback"]),
            }
        )

    cap_applied = scoring.get("capApplied")
    return {
        "id": evaluation["id"],
        "sessionId": session_id,
        "caseId": evaluation["case_id"],
        "caseTitle": evaluation["title"],
        "specialty": evaluation["specialty"],
        "studentName": evaluation["student_name"],
        "score": final_score,
        "aiScore": evaluation["score"],
        "level": final_level,
        "overridden": evaluation["override_score"] is not None,
        "adjusted": evaluation["override_score"] is not None,
        "teacherScore": evaluation["override_score"],
        "teacherComment": evaluation["override_reason"],
        "overrideReason": evaluation["override_reason"],
        "feedback": feedback,
        "summary": _coalesce(feedback.get("overall_feedback"), ""),
        "strengths": _coalesce(feedback.get("strengths"), []),
        "improvements": _coalesce(feedback.get("improvements"), []),
        "scoringVersion": _coalesce(scoring.get("version"), "history-weighted-v1"),
        "scoringFormula": _coalesce(scoring.get("formula"), "sum((domain score / 3) × domain weight)"),
        "scoringRoundingRule": _coalesce(
            scoring.get("roundingRule"),
            "Final total rounded to the nearest whole point before any safety cap",
        ),
        "totalWeight": _number(scoring.get("totalWeight", 100), 100),
        "uncappedScore": _number(
            scoring.get("uncappedScore", evaluation["score"]),
            _number(evaluation["score"]),
        ),
        "capApplied": None if cap_applied is None else _number(cap_applied),
        "scoreCapReason": feedback.get("score_cap_reason"),
        "missedRedFlagIds": missed_red_flag_ids,
        "missedRedFlags": [red_flag_labels.get(red_flag_id, red_flag_id) for red_flag_id in missed_red_flag_ids],
        "missedRedFlagReasons": missed_reasons,
        "criteria": criteria,
        "transcript": transcript,
        "startedAt": evaluation["started_at"],
        "createdAt": evaluation["created_at"],
        "completedAt": evaluation["completed_at"],
        "durationSeconds": evaluation["duration_seconds"],
    }
