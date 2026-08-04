from __future__ import annotations

import math
from typing import Any

from .real_test_support import (
    RealTestFailure,
    emit_status,
    exercise_case,
    login_student,
    published_cases,
    real_provider_client,
    validate_structured_result,
)

SMOKE_QUESTION = "Hello, my name is Alex, a medical student. Could you tell me what brought you in today?"


def _validate_smoke_scoring(result: dict[str, Any], case_slug: str) -> tuple[int | float, int]:
    score, criteria = validate_structured_result(result, case_slug)
    total_weight = result.get("totalWeight")
    uncapped_score = result.get("uncappedScore")
    if (
        isinstance(total_weight, bool)
        or not isinstance(total_weight, (int, float))
        or not math.isclose(float(total_weight), 100, abs_tol=1e-9)
    ):
        raise RealTestFailure("scoring-weight", case_slug)

    criterion_weight = 0.0
    weighted_total = 0.0
    for item in criteria:
        criterion_score = item.get("score")
        weight = item.get("weight")
        weighted_score = item.get("weightedScore")
        if (
            isinstance(criterion_score, bool)
            or not isinstance(criterion_score, (int, float))
            or not math.isfinite(float(criterion_score))
            or not float(criterion_score).is_integer()
            or not 0 <= float(criterion_score) <= 3
            or isinstance(weight, bool)
            or not isinstance(weight, (int, float))
            or isinstance(weighted_score, bool)
            or not isinstance(weighted_score, (int, float))
        ):
            raise RealTestFailure("scoring-domain", case_slug)
        criterion_weight += float(weight)
        weighted_total += float(weighted_score)
    if not math.isclose(criterion_weight, 100, abs_tol=1e-9):
        raise RealTestFailure("scoring-weight", case_slug)
    if (
        isinstance(uncapped_score, bool)
        or not isinstance(uncapped_score, (int, float))
        or not math.isclose(round(weighted_total + 1e-12, 2), float(uncapped_score), abs_tol=1e-9)
    ):
        raise RealTestFailure("scoring-total", case_slug)
    return score, len(criteria)


def main() -> int:
    case_slug = "setup"
    try:
        with real_provider_client() as client:
            headers = login_student(client)
            clinical_case = published_cases(client, headers)[0]
            case_slug = str(clinical_case["slug"])
            result = exercise_case(client, headers, clinical_case, SMOKE_QUESTION)
            score, criteria_count = _validate_smoke_scoring(result, case_slug)
            emit_status("passed", case_slug, score, criteria_count)
        return 0
    except RealTestFailure as error:
        emit_status(f"failed:{error.stage}", error.case_slug, None, 0)
        return 1
    except Exception:
        emit_status("failed:unexpected", case_slug, None, 0)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
