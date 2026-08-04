from __future__ import annotations

import json

import pytest

from app.online_e2e import (
    CaseOutcome,
    OnlineE2EFailure,
    RunOutcome,
    _api_base,
    _emit_failure,
    _emit_success,
    _iter_sse_events,
    _validate_health,
    _validate_result,
    _validate_sse,
)


def _criterion(index: int) -> dict[str, object]:
    return {
        "criterionId": f"criterion-{index}",
        "name": f"Criterion {index}",
        "score": 2,
        "maxScore": 3,
        "weight": 100 / 7,
        "weightedScore": 9.5,
        "evidenceTurnIds": [],
        "evidenceStatus": "not_asked",
        "evidence": [],
        "feedback": "Synthetic feedback.",
    }


def _result(turn_count: int = 1) -> dict[str, object]:
    transcript = []
    for index in range(1 + (turn_count * 2)):
        transcript.append(
            {
                "id": str(index + 1),
                "role": "patient" if index % 2 == 0 else "student",
                "content": "Synthetic test content.",
                "status": "completed",
                "createdAt": "2026-08-04T00:00:00Z",
            }
        )
    return {
        "id": 42,
        "score": 68,
        "criteria": [_criterion(index) for index in range(7)],
        "transcript": transcript,
    }


def test_health_validation_requires_deployed_ai_contract() -> None:
    build_id = _validate_health(
        {
            "status": "ok",
            "service": "simclin-au-api",
            "runtime": "python",
            "schemaVersion": 5,
            "buildId": "a1b2c3d4e5f6",
            "database": "ok",
            "aiConfigured": True,
            "aiProvider": "deepseek",
            "facultyAccessProtected": False,
            "facultyAccessMode": "open-demo",
        }
    )
    assert build_id == "a1b2c3d4e5f6"

    with pytest.raises(OnlineE2EFailure, match="health-contract"):
        _validate_health(
            {
                "status": "ok",
                "service": "simclin-au-api",
                "runtime": "python",
                "schemaVersion": 5,
                "buildId": "development",
                "database": "ok",
                "aiConfigured": False,
                "aiProvider": "mock",
                "facultyAccessProtected": False,
                "facultyAccessMode": "open-demo",
            }
        )


def test_sse_parser_and_validator_require_meta_delta_complete() -> None:
    lines = [
        "event: meta",
        'data: {"type":"meta","studentTurnId":12}',
        "",
        ": keep-alive",
        "",
        "event: delta",
        'data: {"type":"delta","delta":"Synthetic patient reply."}',
        "",
        "event: complete",
        'data: {"type":"done","patientTurnId":13,"turnId":"13","text":"Synthetic patient reply."}',
        "",
    ]
    assert [event for event, _data in _iter_sse_events(lines)] == ["meta", "delta", "complete"]
    _validate_sse(lines, "synthetic-case")

    with pytest.raises(OnlineE2EFailure, match="sse-meta"):
        _validate_sse(lines[5:], "synthetic-case")


def test_sse_replay_requires_replay_markers() -> None:
    replay = [
        "event: meta",
        'data: {"type":"meta","studentTurnId":12,"replayed":true}',
        "",
        "event: delta",
        'data: {"type":"delta","text":"Synthetic patient reply."}',
        "",
        "event: complete",
        'data: {"type":"done","patientTurnId":13,"text":"Synthetic patient reply.","replayed":true}',
        "",
    ]
    _validate_sse(replay, "synthetic-case", expect_replay=True)


def test_result_validation_checks_complete_seven_criterion_shape() -> None:
    evaluation_id, score, criteria_count = _validate_result(_result(turn_count=3), "synthetic-case", 3)
    assert (evaluation_id, score, criteria_count) == (42, 68, 7)

    invalid = _result()
    invalid["criteria"] = invalid["criteria"][:-1]  # type: ignore[index]
    with pytest.raises(OnlineE2EFailure, match="evaluation-shape"):
        _validate_result(invalid, "synthetic-case", 1)


def test_api_base_rejects_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIMCLIN_ONLINE_API_BASE", "https://token@example.test/api")
    with pytest.raises(OnlineE2EFailure, match="configuration-api-base"):
        _api_base()


def test_status_output_contains_only_safe_contract_fields(capsys: pytest.CaptureFixture[str]) -> None:
    outcome = RunOutcome(
        "a1b2c3d4e5f6",
        (CaseOutcome("synthetic-case", 3, 68, 7),),
        True,
    )
    _emit_success(outcome)
    success = json.loads(capsys.readouterr().out)
    assert set(success) == {
        "status",
        "buildId",
        "caseSlug",
        "turnCount",
        "score",
        "criteriaCount",
        "isolation",
    }
    assert "Synthetic patient reply" not in json.dumps(success)

    _emit_failure(OnlineE2EFailure("patient-stream", "synthetic-case", 2))
    failure = json.loads(capsys.readouterr().out)
    assert failure["status"] == "failed@patient-stream"
    assert failure["caseSlug"] == "synthetic-case"
