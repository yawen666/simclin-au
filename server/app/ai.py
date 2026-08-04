from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from typing import Any, Protocol

import httpx

from .config import Settings
from .errors import AppError
from .prompts import ACTOR_PROMPT, EVALUATOR_PROMPT, PLANNER_PROMPT, PROMPT_VERSIONS


class AiProvider(Protocol):
    async def plan_disclosure(
        self, *, session_id: int, case_content: dict[str, Any], transcript: list[dict[str, Any]], student_message: str
    ) -> dict[str, Any]: ...
    def stream_patient_reply(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        student_message: str,
        disclosed_fact_ids: list[str],
        permitted_facts: list[dict[str, Any]],
        question_style: str,
    ) -> AsyncIterator[str]: ...
    async def evaluate(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]: ...


def extract_json(value: str) -> Any:
    text = value.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.I)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = min((index for index in (text.find("{"), text.find("[")) if index >= 0), default=-1)
        end = max(text.rfind("}"), text.rfind("]"))
        if start < 0 or end <= start:
            raise AppError(502, "AI_OUTPUT_VALIDATION", "The model response was not valid JSON") from None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise AppError(502, "AI_OUTPUT_VALIDATION", "The model response was not valid JSON") from exc


class DeepSeekProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=f"{settings.deepseek_base_url}/",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_output: bool = False,
        prompt_version: str,
        timeout_seconds: float = 45,
    ) -> dict[str, Any]:
        if not self.settings.deepseek_api_key:
            raise AppError(503, "AI_NOT_CONFIGURED", "DeepSeek API key is not configured")
        started = time.monotonic()
        payload: dict[str, Any] = {
            "model": self.settings.deepseek_model,
            "messages": messages,
            "stream": False,
            "temperature": 0.1,
            "thinking": {"type": "disabled"},
        }
        if json_output:
            payload["response_format"] = {"type": "json_object"}
        try:
            response = await self._client.post(
                "chat/completions",
                json=payload,
                timeout=httpx.Timeout(timeout_seconds),
            )
        except httpx.TimeoutException as exc:
            raise AppError(504, "AI_TIMEOUT", "The DeepSeek service did not respond in time") from exc
        except httpx.HTTPError as exc:
            raise AppError(502, "AI_NETWORK_ERROR", "Could not reach the DeepSeek service") from exc
        if not response.is_success:
            raise AppError(502, "AI_PROVIDER_ERROR", f"DeepSeek request failed ({response.status_code})")
        try:
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        except (ValueError, IndexError, AttributeError) as exc:
            raise AppError(502, "AI_OUTPUT_VALIDATION", "DeepSeek returned an invalid response") from exc
        if not content:
            raise AppError(502, "AI_EMPTY_RESPONSE", "DeepSeek returned an empty response")
        usage = data.get("usage") or {}
        return {
            "content": content,
            "meta": {
                "provider": "deepseek",
                "model": data.get("model") or self.settings.deepseek_model,
                "promptVersion": prompt_version,
                "latencyMs": round((time.monotonic() - started) * 1000),
                "inputTokens": usage.get("prompt_tokens"),
                "outputTokens": usage.get("completion_tokens"),
            },
        }

    async def plan_disclosure(
        self, *, session_id: int, case_content: dict[str, Any], transcript: list[dict[str, Any]], student_message: str
    ) -> dict[str, Any]:
        result = await self._complete(
            [
                {"role": "system", "content": PLANNER_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "case": safe_planner_case(case_content),
                            "transcript": transcript,
                            "latest_student_message": student_message,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            json_output=True,
            prompt_version=PROMPT_VERSIONS["planner"],
        )
        parsed = extract_json(result["content"])
        if not isinstance(parsed, dict) or not isinstance(parsed.get("disclosed_fact_ids"), list):
            raise AppError(502, "AI_OUTPUT_VALIDATION", "Disclosure planner returned an invalid response")
        style = parsed.get("question_style", "focused")
        if style not in {"broad", "focused", "shotgun"}:
            style = "focused"
        limit = 2 if style == "focused" else 1
        ids: list[str] = []
        for value in parsed["disclosed_fact_ids"][:30]:
            if isinstance(value, str) and value not in ids:
                ids.append(value)
        return {
            "disclosedFactIds": ids[:limit],
            "questionStyle": style,
            "rationale": parsed.get("rationale"),
            "meta": result["meta"],
        }

    async def stream_patient_reply(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        student_message: str,
        disclosed_fact_ids: list[str],
        permitted_facts: list[dict[str, Any]],
        question_style: str,
    ) -> AsyncIterator[str]:
        if not self.settings.deepseek_api_key:
            raise AppError(503, "AI_NOT_CONFIGURED", "DeepSeek API key is not configured")
        payload = {
            "model": self.settings.deepseek_model,
            "stream": True,
            "temperature": 0.4,
            "max_tokens": 120,
            "thinking": {"type": "disabled"},
            "messages": [
                {"role": "system", "content": ACTOR_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "patient_profile": safe_patient_profile(case_content),
                            "permitted_fact_ids": disclosed_fact_ids,
                            "permitted_facts": permitted_facts,
                            "question_style": question_style,
                            "transcript": transcript,
                            "latest_student_message": student_message,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }
        timeout = httpx.Timeout(connect=15, read=60, write=30, pool=30)
        try:
            async with self._client.stream(
                "POST",
                "chat/completions",
                json=payload,
                timeout=timeout,
            ) as response:
                if not response.is_success:
                    raise AppError(
                        502, "AI_PROVIDER_ERROR", f"DeepSeek streaming request failed ({response.status_code})"
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        parsed = json.loads(data)
                        chunk = parsed.get("choices", [{}])[0].get("delta", {}).get("content")
                    except (ValueError, IndexError, AttributeError):
                        continue
                    if chunk:
                        yield chunk
        except AppError:
            raise
        except httpx.TimeoutException as exc:
            raise AppError(504, "AI_TIMEOUT", "The DeepSeek service did not respond in time") from exc
        except httpx.HTTPError as exc:
            raise AppError(502, "AI_NETWORK_ERROR", "Could not reach the DeepSeek service") from exc

    async def evaluate(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]:
        allowed_ids: list[str] = []
        for criterion in criteria:
            for value in criterion.get("redFlagIds", []):
                if value not in allowed_ids:
                    allowed_ids.append(value)
        result = await self._complete(
            [
                {"role": "system", "content": EVALUATOR_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "case": safe_evaluator_case(case_content),
                            "rubric": criteria,
                            "allowed_red_flag_ids": allowed_ids,
                            "transcript": transcript,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            json_output=True,
            prompt_version=PROMPT_VERSIONS["evaluator"],
            timeout_seconds=90,
        )
        return {"value": extract_json(result["content"]), "meta": result["meta"]}


class MockAiProvider:
    async def plan_disclosure(
        self, *, session_id: int, case_content: dict[str, Any], transcript: list[dict[str, Any]], student_message: str
    ) -> dict[str, Any]:
        return {
            "disclosedFactIds": collect_all_fact_ids(case_content)[:2],
            "questionStyle": "focused",
            "rationale": "Deterministic test disclosure",
            "meta": {
                "provider": "mock",
                "model": "simclin-mock-v1",
                "promptVersion": PROMPT_VERSIONS["planner"],
                "latencyMs": 1,
                "inputTokens": 1,
                "outputTokens": 1,
            },
        }

    async def stream_patient_reply(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        student_message: str,
        disclosed_fact_ids: list[str],
        permitted_facts: list[dict[str, Any]],
        question_style: str,
    ) -> AsyncIterator[str]:
        fact = permitted_facts[0] if permitted_facts else None
        response = (
            f"Thanks for asking. {fact['value']}"
            if fact and isinstance(fact.get("value"), str)
            else "Thanks for asking. Could you please ask me that in a little more detail?"
        )
        for index in range(0, len(response), 24):
            yield response[index : index + 24]

    async def evaluate(
        self,
        *,
        session_id: int,
        case_content: dict[str, Any],
        transcript: list[dict[str, Any]],
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]:
        student_ids = [turn["id"] for turn in transcript if turn.get("speaker") == "student"]
        return {
            "value": {
                "criteria": [
                    {
                        "criterion_id": criterion["id"],
                        "score": 2 if student_ids else 0,
                        "evidence_turn_ids": student_ids[:2],
                        "feedback": f"The student demonstrated this behaviour (turn {student_ids[0]}); add more precision and structure."
                        if student_ids
                        else "No transcript evidence.",
                    }
                    for criterion in criteria
                ],
                "missed_red_flags": [],
                "strengths": ["Used patient-centred questions."],
                "improvements": ["Use a more systematic structure and explicitly screen relevant red flags."],
                "overall_feedback": "A developing history with a clear opportunity to improve structure and safety screening.",
            },
            "meta": {
                "provider": "mock",
                "model": "simclin-mock-v1",
                "promptVersion": PROMPT_VERSIONS["evaluator"],
                "latencyMs": 1,
                "inputTokens": 1,
                "outputTokens": 1,
            },
        }


def collect_permitted_facts(source: Any, ids: list[str]) -> list[dict[str, Any]]:
    wanted = set(ids)
    result: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            fact_id = value.get("id") if isinstance(value.get("id"), str) else value.get("factId")
            if fact_id in wanted and isinstance(value.get("value"), str):
                result.append({"id": fact_id, "label": value.get("label"), "value": value["value"]})
            for item in value.values():
                visit(item)

    visit(source)
    return result


def collect_all_fact_ids(source: Any) -> list[str]:
    result: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            if isinstance(value.get("id"), str) and isinstance(value.get("value"), str):
                result.append(value["id"])
            for item in value.values():
                visit(item)

    visit(source)
    return result


def validate_patient_reply(reply: str, source: Any, permitted_fact_ids: list[str]) -> None:
    if re.search(r"system prompt|scoring key|rubric content|fact[_ -]?id|teaching notes?", reply, flags=re.I):
        raise AppError(502, "AI_POLICY_VIOLATION", "The simulated patient response contained hidden simulation content")
    hidden_values: list[str] = []
    permitted = set(permitted_fact_ids)

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            fact_id = value.get("id") if isinstance(value.get("id"), str) else value.get("factId")
            fact_value = value.get("value", "").strip() if isinstance(value.get("value"), str) else ""
            if fact_id and fact_id not in permitted and len(fact_value) >= 18:
                hidden_values.append(fact_value.lower())
            for item in value.values():
                visit(item)

    visit(source)
    lower_reply = reply.lower()
    if any(value in lower_reply for value in hidden_values):
        raise AppError(502, "AI_POLICY_VIOLATION", "The simulated patient response contained an undisclosed case fact")


def safe_patient_profile(content: dict[str, Any]) -> dict[str, Any]:
    patient = content.get("patient") or content.get("persona") or {}
    allowed = {
        "name",
        "preferredName",
        "age",
        "gender",
        "genderIdentity",
        "pronouns",
        "occupation",
        "demeanour",
        "communicationStyle",
        "language",
        "preferredLanguage",
        "culturalBackground",
        "culturalOrCommunicationNeeds",
        "emotionalState",
        "healthLiteracy",
        "actorNotes",
    }
    profile = {key: value for key, value in patient.items() if key in allowed}
    case_data = content.get("caseData") or {}
    return {
        **profile,
        "openingStatement": content.get("openingStatement"),
        "unknownPolicy": case_data.get("unknownPolicy"),
        "patientActorRules": case_data.get("patientActorRules"),
    }


def safe_planner_case(content: dict[str, Any]) -> dict[str, Any]:
    case_data = content.get("caseData") or {}
    facts = []
    for fact in case_data.get("atomicFacts", []):
        if isinstance(fact, dict) and isinstance(fact.get("id"), str) and isinstance(fact.get("value"), str):
            facts.append(
                {
                    key: fact.get(key)
                    for key in ("id", "label", "value", "category", "disclosureLevel", "triggers", "importance")
                }
            )
    red_flags = []
    for flag in case_data.get("redFlags", []):
        if isinstance(flag, dict) and isinstance(flag.get("id"), str):
            red_flags.append({key: flag.get(key) for key in ("id", "label", "linkedFactIds", "critical")})
    return {
        "opening_statement": content.get("openingStatement") or content.get("opening_statement"),
        "facts": facts,
        "red_flags": red_flags,
    }


def safe_evaluator_case(content: dict[str, Any]) -> dict[str, Any]:
    return safe_planner_case(content)
