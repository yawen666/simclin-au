from __future__ import annotations

import json

import httpx
import pytest

from app.ai import DeepSeekProvider
from app.config import load_settings
from app.errors import AppError
from app.prompts import PLANNER_PROMPT, PROMPT_VERSIONS


def _settings():  # type: ignore[no-untyped-def]
    return load_settings(
        {
            "environment": "test",
            "database_path": ":memory:",
            "jwt_secret": "provider-test-secret-at-least-32-characters",
            "deepseek_api_key": "test-only-key",
            "deepseek_base_url": "https://provider.test",
            "deepseek_model": "deepseek-test",
        }
    )


def _client(handler):  # type: ignore[no-untyped-def]
    return httpx.AsyncClient(
        base_url="https://provider.test/",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_planner_uses_safe_projection_and_hard_disclosure_limit() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "model": "deepseek-test",
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "question_style": "focused",
                                    "disclosed_fact_ids": ["fact.1", "fact.2", "fact.2", "fact.3"],
                                }
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4},
            },
        )

    client = _client(handler)
    provider = DeepSeekProvider(_settings(), client=client)
    try:
        result = await provider.plan_disclosure(
            session_id=1,
            case_content={
                "openingStatement": "I feel unwell.",
                "clinicalTruth": {"likelyDiagnosis": "Hidden diagnosis"},
                "caseData": {
                    "atomicFacts": [
                        {"id": "fact.1", "label": "One", "value": "First fact."},
                        {"id": "fact.2", "label": "Two", "value": "Second fact."},
                    ]
                },
            },
            transcript=[],
            student_message="What happened?",
        )
    finally:
        await client.aclose()
    assert result["disclosedFactIds"] == ["fact.1", "fact.2"]
    assert result["meta"]["promptVersion"] == PROMPT_VERSIONS["planner"]
    assert captured["messages"][0]["content"] == PLANNER_PROMPT
    assert "Hidden diagnosis" not in captured["messages"][1]["content"]
    assert "fact.1" in captured["messages"][1]["content"]


@pytest.mark.asyncio
async def test_shotgun_planner_allows_only_one_fact() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": ('{"question_style":"shotgun","disclosed_fact_ids":["one","two","three"]}')
                        }
                    }
                ],
            },
        )

    client = _client(handler)
    provider = DeepSeekProvider(_settings(), client=client)
    try:
        result = await provider.plan_disclosure(
            session_id=1,
            case_content={},
            transcript=[],
            student_message="Pain, nausea, fainting, medicines and allergies?",
        )
    finally:
        await client.aclose()
    assert result["questionStyle"] == "shotgun"
    assert result["disclosedFactIds"] == ["one"]


@pytest.mark.asyncio
async def test_provider_maps_timeout_and_status_failures_to_safe_errors() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("synthetic", request=request)

    timeout_client = _client(timeout)
    provider = DeepSeekProvider(_settings(), client=timeout_client)
    try:
        with pytest.raises(AppError) as timed_out:
            await provider.plan_disclosure(
                session_id=1,
                case_content={},
                transcript=[],
                student_message="Hello",
            )
    finally:
        await timeout_client.aclose()
    assert timed_out.value.status_code == 504
    assert timed_out.value.code == "AI_TIMEOUT"

    failed_client = _client(lambda _request: httpx.Response(429, text="provider-secret-body"))
    provider = DeepSeekProvider(_settings(), client=failed_client)
    try:
        with pytest.raises(AppError) as failed:
            await provider.plan_disclosure(
                session_id=1,
                case_content={},
                transcript=[],
                student_message="Hello",
            )
    finally:
        await failed_client.aclose()
    assert failed.value.code == "AI_PROVIDER_ERROR"
    assert "provider-secret-body" not in failed.value.message


@pytest.mark.asyncio
async def test_stream_parser_ignores_malformed_frames() -> None:
    stream = "\n\n".join(
        [
            "data: not-json",
            'data: {"choices":[{"delta":{"content":"Hello "}}]}',
            ": keep-alive",
            'data: {"choices":[{"delta":{"content":"there"}}]}',
            "data: [DONE]",
            "",
        ]
    )
    client = _client(lambda _request: httpx.Response(200, text=stream))
    provider = DeepSeekProvider(_settings(), client=client)
    try:
        chunks = [
            chunk
            async for chunk in provider.stream_patient_reply(
                session_id=1,
                case_content={},
                transcript=[],
                student_message="Hello",
                disclosed_fact_ids=[],
                permitted_facts=[],
                question_style="focused",
            )
        ]
    finally:
        await client.aclose()
    assert chunks == ["Hello ", "there"]
