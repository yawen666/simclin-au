from __future__ import annotations

import os

from .real_test_support import (
    RealTestFailure,
    emit_status,
    exercise_case,
    login_student,
    published_cases,
    real_provider_client,
    validate_structured_result,
)

QUESTIONS = {
    "pressure-in-my-chest": "When did the chest pressure start, what were you doing, and does it travel anywhere?",
    "cant-catch-my-breath": "When did the breathlessness worsen, and have your cough or sputum changed?",
    "burning-pain-after-meals": "Please describe the pain, and have you noticed black stools or vomiting blood?",
    "worst-headache": "Exactly how did the headache start, and did it reach maximum intensity immediately?",
    "always-thirsty": "How long have you been thirsty and urinating more, and have you lost weight?",
}
FALLBACK_QUESTION = "Could you tell me more about what brought you in today?"


def _selected_cases(all_cases: list[dict[str, object]]) -> list[dict[str, object]]:
    selected_slugs = [value.strip() for value in os.getenv("SIMCLIN_REAL_CASE_SLUG", "").split(",") if value.strip()]
    if not selected_slugs:
        if len(all_cases) != 5:
            raise RealTestFailure("case-count")
        return all_cases
    cases = [item for item in all_cases if item.get("slug") in selected_slugs]
    if len(cases) != len(selected_slugs):
        raise RealTestFailure("case-selection")
    return cases


def main() -> int:
    case_slug = "setup"
    try:
        with real_provider_client() as client:
            headers = login_student(client)
            cases = _selected_cases(published_cases(client, headers))
            for clinical_case in cases:
                case_slug = str(clinical_case["slug"])
                result = exercise_case(
                    client,
                    headers,
                    clinical_case,
                    QUESTIONS.get(case_slug, FALLBACK_QUESTION),
                )
                score, criteria = validate_structured_result(result, case_slug)
                emit_status("passed", case_slug, score, len(criteria))
        return 0
    except RealTestFailure as error:
        emit_status(f"failed:{error.stage}", error.case_slug, None, 0)
        return 1
    except Exception:
        emit_status("failed:unexpected", case_slug, None, 0)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
