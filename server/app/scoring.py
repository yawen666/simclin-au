from __future__ import annotations

import math
from typing import Any

from .errors import AppError

SCORING_VERSION = "history-weighted-v1"


def js_round(value: float) -> int:
    return math.floor(value + 0.5)


def _validation_error(message: str = "The evaluator response did not match the assessment contract") -> AppError:
    return AppError(502, "AI_OUTPUT_VALIDATION", message)


def _coerce_integer(value: Any, *, positive: bool = False) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise _validation_error() from exc
    if not math.isfinite(number) or not number.is_integer() or (positive and number <= 0):
        raise _validation_error()
    return int(number)


def _parse_evaluation(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or not isinstance(raw.get("criteria"), list):
        raise _validation_error()
    criteria: list[dict[str, Any]] = []
    for value in raw["criteria"]:
        if not isinstance(value, dict) or not isinstance(value.get("criterion_id"), str):
            raise _validation_error()
        score = _coerce_integer(value.get("score"))
        if score < 0 or score > 3:
            raise _validation_error()
        evidence_source = value.get("evidence_turn_ids", [])
        if not isinstance(evidence_source, list):
            raise _validation_error()
        evidence_ids = [_coerce_integer(item, positive=True) for item in evidence_source]
        feedback = value.get("feedback", "")
        if not isinstance(feedback, str):
            raise _validation_error()
        criteria.append(
            {
                "criterion_id": value["criterion_id"],
                "score": score,
                "evidence_turn_ids": evidence_ids,
                "feedback": feedback,
            }
        )

    criterion_ids = [item["criterion_id"] for item in criteria]
    if len(criterion_ids) != len(set(criterion_ids)):
        raise _validation_error("Criterion IDs must be unique")

    arrays: dict[str, list[str]] = {}
    for field in ("missed_red_flags", "strengths", "improvements"):
        value = raw.get(field, [])
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise _validation_error()
        arrays[field] = value
    reasons = raw.get("missed_red_flag_reasons", {})
    if not isinstance(reasons, dict) or any(
        not isinstance(key, str) or not isinstance(value, str) for key, value in reasons.items()
    ):
        raise _validation_error()
    overall_feedback = raw.get("overall_feedback", "")
    if not isinstance(overall_feedback, str):
        raise _validation_error()
    return {
        "criteria": criteria,
        "missed_red_flags": arrays["missed_red_flags"],
        "missed_red_flag_reasons": reasons,
        "strengths": arrays["strengths"],
        "improvements": arrays["improvements"],
        "overall_feedback": overall_feedback,
    }


def _assert_rubric(criteria: list[dict[str, Any]]) -> None:
    if not criteria:
        raise AppError(500, "INVALID_RUBRIC_CONFIGURATION", "The assessment rubric has no criteria")
    ids = [item.get("id") for item in criteria]
    weights: list[float] = []
    invalid = False
    for item in criteria:
        try:
            weight = float(item.get("weight", 0))
        except (TypeError, ValueError):
            invalid = True
            weight = 0
        weights.append(weight)
        invalid = invalid or (
            not item.get("id") or not math.isfinite(weight) or weight <= 0 or item.get("maxScore", 3) != 3
        )
    total = sum(weights)
    if invalid or len(set(ids)) != len(ids) or abs(total - 100) > 0.001:
        raise AppError(
            500,
            "INVALID_RUBRIC_CONFIGURATION",
            "The assessment rubric must contain unique domains scored 0–3 with positive weights totalling exactly 100",
        )


def _student_screened_red_flag(
    case_content: dict[str, Any], transcript: list[dict[str, Any]], red_flag_id: str
) -> bool:
    case_data = case_content.get("caseData") or {}
    definition = next(
        (flag for flag in case_data.get("redFlags", []) if isinstance(flag, dict) and flag.get("id") == red_flag_id),
        None,
    )
    linked_ids = {
        value
        for value in (definition.get("linkedFactIds", []) if definition else [red_flag_id])
        if isinstance(value, str)
    }
    return any(
        turn.get("speaker") == "patient"
        and turn.get("status") not in {"failed", "pending"}
        and bool(linked_ids.intersection(value for value in turn.get("disclosedFactIds", []) if isinstance(value, str)))
        for turn in transcript
    )


def calculate_score(
    raw: Any,
    rubric: list[dict[str, Any]],
    valid_student_turn_ids: set[int],
    *,
    case_content: dict[str, Any] | None = None,
    transcript: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    evaluation = _parse_evaluation(raw)
    _assert_rubric(rubric)
    expected_ids = {str(item["id"]) for item in rubric}
    actual_ids = {item["criterion_id"] for item in evaluation["criteria"]}
    if actual_ids != expected_ids:
        raise _validation_error("Evaluator output must contain every rubric criterion exactly once")
    by_id = {item["criterion_id"]: item for item in evaluation["criteria"]}
    scored = []
    for criterion in rubric:
        item = by_id.get(criterion["id"], {})
        evidence_ids = []
        for turn_id in item.get("evidence_turn_ids", []):
            if turn_id in valid_student_turn_ids:
                evidence_ids.append(turn_id)
        raw_score = item.get("score", 0)
        score = min(3, max(0, raw_score)) if evidence_ids else 0
        weighted = js_round(((score / 3) * float(criterion["weight"])) * 10_000) / 10_000
        scored.append(
            {
                "criterionId": criterion["id"],
                "score": score,
                "weightedScore": weighted,
                "evidenceTurnIds": evidence_ids,
                "feedback": str(item.get("feedback", "")),
            }
        )
    uncapped = js_round(sum(item["weightedScore"] for item in scored) * 100) / 100
    allowed = {value for criterion in rubric for value in criterion.get("redFlagIds", [])}
    validated_missed: list[str] = []
    for value in evaluation["missed_red_flags"]:
        if not isinstance(value, str) or value not in allowed or value in validated_missed:
            continue
        if case_content and transcript and _student_screened_red_flag(case_content, transcript, value):
            continue
        validated_missed.append(value)
    reasons = {
        key: value.strip()
        for key, value in evaluation["missed_red_flag_reasons"].items()
        if key in validated_missed and isinstance(value, str) and value.strip()
    }
    critical_missed = any(
        criterion.get("critical") and any(value in validated_missed for value in criterion.get("redFlagIds", []))
        for criterion in rubric
    )
    cap = 59 if critical_missed else 69 if validated_missed else None
    rounded = js_round(uncapped)
    score = min(rounded, cap) if cap is not None else rounded
    level = (
        "Excellent"
        if score >= 85
        else "Competent"
        if score >= 70
        else "Developing"
        if score >= 50
        else "Needs improvement"
    )
    feedback = {
        "criteria": evaluation["criteria"],
        "missed_red_flags": validated_missed,
        "missed_red_flag_reasons": reasons,
        "strengths": evaluation["strengths"],
        "improvements": evaluation["improvements"],
        "overall_feedback": evaluation["overall_feedback"],
        "scoring": {
            "version": SCORING_VERSION,
            "formula": "sum((domain score / 3) × domain weight)",
            "roundingRule": "Final total rounded to the nearest whole point before any safety cap",
            "totalWeight": 100,
            "uncappedScore": uncapped,
            "capApplied": cap,
        },
    }
    if cap is not None:
        feedback["score_cap_reason"] = (
            "A critical red flag was not elicited."
            if critical_missed
            else "One or more safety red flags were not elicited."
        )
    return {
        "score": score,
        "uncappedScore": uncapped,
        "level": level,
        "capApplied": cap,
        "criteria": scored,
        "feedback": feedback,
    }
