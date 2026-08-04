from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import time
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from .ai import AiProvider, collect_permitted_facts, validate_patient_reply
from .config import Settings
from .database import Database
from .errors import AppError, require_found
from .prompts import PROMPT_VERSIONS
from .scoring import calculate_score
from .utils import compact_json, now_iso, parse_json

MAX_QUESTIONS_PER_SESSION = 30
RETRYABLE_EVALUATION_ERRORS = {
    "AI_TIMEOUT",
    "AI_NETWORK_ERROR",
    "AI_PROVIDER_ERROR",
    "AI_EMPTY_RESPONSE",
    "AI_OUTPUT_VALIDATION",
}


def get_session(
    db: Database,
    session_id: int,
    user_id: int,
    role: str,
) -> dict[str, Any]:
    ownership = "" if role == "faculty" else "AND s.user_id=?"
    parameters: tuple[Any, ...] = (session_id,) if role == "faculty" else (session_id, user_id)
    with db.connection() as connection:
        row = connection.execute(
            f"""SELECT s.*,COALESCE(s.case_title_snapshot,c.title) AS title,c.slug,
            COALESCE(s.case_specialty_snapshot,c.specialty) AS specialty,cv.content_json,rv.criteria_json
            FROM sessions s
            JOIN cases c ON c.id=s.case_id
            JOIN case_versions cv ON cv.id=s.case_version_id
            JOIN rubric_versions rv ON rv.id=s.rubric_version_id
            WHERE s.id=? {ownership}""",
            parameters,
        ).fetchone()
    return dict(require_found(row, "Session"))


def get_turns(db: Database, session_id: int) -> list[dict[str, Any]]:
    with db.connection() as connection:
        rows = connection.execute(
            """SELECT id,sequence,speaker,content,status,created_at AS createdAt
            FROM turns WHERE session_id=? ORDER BY sequence""",
            (session_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_completed_turns(db: Database, session_id: int) -> list[dict[str, Any]]:
    return [turn for turn in get_turns(db, session_id) if turn["status"] == "completed"]


def get_scoring_turns(db: Database, session_id: int) -> list[dict[str, Any]]:
    """Return completed turns plus server-only disclosure evidence for scoring."""

    with db.connection() as connection:
        rows = connection.execute(
            """SELECT id,sequence,speaker,content,status,created_at AS createdAt,
            disclosed_facts_json FROM turns
            WHERE session_id=? AND status='completed' ORDER BY sequence""",
            (session_id,),
        ).fetchall()
    return [
        {
            **{key: value for key, value in dict(row).items() if key != "disclosed_facts_json"},
            "disclosedFactIds": parse_json(row["disclosed_facts_json"], []),
        }
        for row in rows
    ]


def opening_statement(content: dict[str, Any]) -> str:
    direct = content.get("openingStatement") or content.get("opening_statement")
    if isinstance(direct, str):
        return direct
    patient = content.get("patient")
    if isinstance(patient, dict):
        nested = patient.get("openingStatement") or patient.get("opening_statement")
        if isinstance(nested, str):
            return nested
    return "Hello. I was told you would like to ask me some questions."


def completed_message_exchange(
    db: Database,
    session_id: int,
    client_message_id: str | None,
    message: str,
) -> dict[str, Any] | None:
    if client_message_id is None:
        return None
    with db.connection() as connection:
        row = connection.execute(
            """SELECT student.id AS student_turn_id,student.content AS student_content,
            student.status AS student_status,patient.id AS patient_turn_id,patient.content AS patient_content
            FROM turns student
            LEFT JOIN turns patient ON patient.session_id=student.session_id
              AND patient.sequence=student.sequence+1 AND patient.speaker='patient'
              AND patient.status='completed'
            WHERE student.session_id=? AND student.client_message_id=? AND student.speaker='student'""",
            (session_id, client_message_id),
        ).fetchone()
    if row is None:
        return None
    if row["student_content"] != message:
        raise AppError(409, "MESSAGE_ID_CONFLICT", "This message identifier was already used for different content")
    if row["student_status"] == "completed" and row["patient_turn_id"] is not None:
        return dict(row)
    return None


def create_pending_student_turn(
    db: Database,
    session_id: int,
    message: str,
    client_message_id: str | None = None,
) -> tuple[int, int]:
    created_at = now_iso()
    with db.connection(write=True) as connection:
        if client_message_id is not None:
            existing = connection.execute(
                """SELECT id,sequence,content,status FROM turns
                WHERE session_id=? AND client_message_id=? AND speaker='student'""",
                (session_id, client_message_id),
            ).fetchone()
            if existing is not None:
                if existing["content"] != message:
                    raise AppError(
                        409,
                        "MESSAGE_ID_CONFLICT",
                        "This message identifier was already used for different content",
                    )
                if existing["status"] == "failed":
                    sequence = int(existing["sequence"])
                    occupied_later = connection.execute(
                        """SELECT 1 FROM turns
                        WHERE session_id=? AND sequence>? LIMIT 1""",
                        (session_id, sequence),
                    ).fetchone()
                    if occupied_later is not None:
                        latest = connection.execute(
                            "SELECT MAX(sequence) AS sequence FROM turns WHERE session_id=?",
                            (session_id,),
                        ).fetchone()
                        sequence = int(latest["sequence"] or 0) + 1
                    connection.execute(
                        """UPDATE turns SET sequence=?,status='pending',created_at=?,processing_expires_at=NULL
                        WHERE id=?""",
                        (sequence, created_at, existing["id"]),
                    )
                    return int(existing["id"]), sequence
                raise AppError(409, "SESSION_BUSY", "This message is already being processed")
        row = connection.execute(
            "SELECT COALESCE(MAX(sequence),0)+1 AS next FROM turns WHERE session_id=?",
            (session_id,),
        ).fetchone()
        sequence = int(row["next"])
        result = connection.execute(
            """INSERT INTO turns
            (session_id,sequence,speaker,content,status,disclosed_facts_json,client_message_id,created_at)
            VALUES (?,?,'student',?,'pending','[]',?,?)""",
            (session_id, sequence, message, client_message_id, created_at),
        )
        turn_id = int(result.lastrowid)
    return turn_id, sequence


def completed_question_count(db: Database, session_id: int) -> int:
    with db.connection() as connection:
        row = connection.execute(
            """SELECT COUNT(*) AS count FROM turns
            WHERE session_id=? AND speaker='student' AND status='completed'""",
            (session_id,),
        ).fetchone()
    return int(row["count"])


def record_model_run(
    db: Database,
    *,
    provider: str,
    model: str,
    purpose: str,
    prompt_version: str,
    latency_ms: int,
    status: str,
    session_id: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error_code: str | None = None,
    metadata: Any = None,
) -> int:
    with db.connection(write=True) as connection:
        result = connection.execute(
            """INSERT INTO model_runs
            (session_id,provider,model,purpose,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,metadata_json,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                session_id,
                provider,
                model,
                purpose,
                prompt_version,
                max(0, int(latency_ms)),
                input_tokens,
                output_tokens,
                status,
                error_code,
                compact_json(metadata if metadata is not None else {}),
                now_iso(),
            ),
        )
        return int(result.lastrowid)


def _error_code(error: BaseException) -> str:
    return error.code if isinstance(error, AppError) else "UNKNOWN"


def _duration_seconds(started_at: str, completed_at: str) -> int:
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        return max(0, math.floor((end - start).total_seconds() + 0.5))
    except (TypeError, ValueError):
        return 0


def complete_session_record(db: Database, session: dict[str, Any], session_id: int) -> None:
    completed_at = now_iso()
    duration_seconds = _duration_seconds(str(session["started_at"]), completed_at)
    with db.connection(write=True) as connection:
        connection.execute(
            """UPDATE sessions SET status='completed',completed_at=?,duration_seconds=?,
            evaluation_status='queued',evaluation_error=NULL WHERE id=?""",
            (completed_at, duration_seconds, session_id),
        )


def requeue_evaluation(db: Database, session_id: int) -> None:
    with db.connection(write=True) as connection:
        connection.execute(
            """UPDATE sessions SET evaluation_status='queued',evaluation_error=NULL
            WHERE id=?""",
            (session_id,),
        )


class EvaluationCoordinator:
    """Owns the single-process message and evaluation concurrency guards.

    SQLite remains the source of truth for evaluation state. The in-memory sets
    only prevent duplicate model calls inside the one supported Uvicorn worker.
    ``start`` reclaims work that was queued or interrupted by a process restart.
    """

    def __init__(
        self,
        db: Database,
        provider: AiProvider,
        settings: Settings,
        *,
        logger: logging.Logger | None = None,
    ) -> None:
        self.db = db
        self.provider = provider
        self.settings = settings
        self.logger = logger or logging.getLogger("simclin.sessions")
        self.active_message_sessions: set[int] = set()
        self.active_evaluations: set[int] = set()
        self._evaluation_tasks: dict[int, asyncio.Task[None]] = {}
        self._evaluation_semaphore = asyncio.Semaphore(2)
        self._message_tasks: set[asyncio.Task[None]] = set()
        self._stopping = False

    @property
    def provider_name(self) -> str:
        return self.settings.ai_provider

    @property
    def model_name(self) -> str:
        return "simclin-mock-v1" if self.provider_name == "mock" else self.settings.deepseek_model

    async def start(self) -> list[int]:
        self._stopping = False
        return await self.recover_pending_evaluations()

    async def stop(self) -> None:
        self._stopping = True
        tasks: list[asyncio.Task[Any]] = [*self._evaluation_tasks.values(), *self._message_tasks]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._evaluation_tasks.clear()
        self._message_tasks.clear()
        self.active_evaluations.clear()
        self.active_message_sessions.clear()

    async def recover_pending_evaluations(self) -> list[int]:
        """Queue persisted incomplete evaluations after application startup."""

        with self.db.connection(write=True) as connection:
            rows = connection.execute(
                """SELECT s.id,e.id AS evaluation_id
                FROM sessions s LEFT JOIN evaluations e ON e.session_id=s.id
                WHERE s.evaluation_status IN ('queued','running')"""
            ).fetchall()
            pending: list[int] = []
            for row in rows:
                session_id = int(row["id"])
                if row["evaluation_id"] is not None:
                    connection.execute(
                        """UPDATE sessions SET evaluation_status='completed',evaluation_error=NULL
                        WHERE id=?""",
                        (session_id,),
                    )
                else:
                    connection.execute(
                        """UPDATE sessions SET evaluation_status='queued',evaluation_error=NULL
                        WHERE id=?""",
                        (session_id,),
                    )
                    pending.append(session_id)
        for session_id in pending:
            self.queue_evaluation(session_id)
        return pending

    def reserve_message(self, session_id: int) -> bool:
        if self._stopping or session_id in self.active_message_sessions:
            return False
        self.active_message_sessions.add(session_id)
        return True

    def release_message(self, session_id: int) -> None:
        self.active_message_sessions.discard(session_id)

    def message_is_active(self, session_id: int) -> bool:
        return session_id in self.active_message_sessions

    def queue_evaluation(self, session_id: int) -> bool:
        if self._stopping or session_id in self.active_evaluations:
            return False
        self.active_evaluations.add(session_id)
        task = asyncio.create_task(self.run_evaluation(session_id), name=f"evaluation-{session_id}")
        self._evaluation_tasks[session_id] = task

        def completed(completed_task: asyncio.Task[None]) -> None:
            self.active_evaluations.discard(session_id)
            self._evaluation_tasks.pop(session_id, None)
            if not completed_task.cancelled() and completed_task.exception() is not None:
                self.logger.error(
                    "Unhandled background evaluation error for session %s",
                    session_id,
                    exc_info=completed_task.exception(),
                )

        task.add_done_callback(completed)
        return True

    async def wait_for_idle(self, timeout_seconds: float = 5) -> None:
        tasks = list(self._evaluation_tasks.values())
        if tasks:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout_seconds)

    def _safe_record_model_run(self, **values: Any) -> int | None:
        try:
            return record_model_run(self.db, **values)
        except Exception:
            self.logger.exception(
                "Could not persist model-run audit for session %s",
                values.get("session_id"),
            )
            return None

    def _mark_turn_failed(self, turn_id: int) -> None:
        with self.db.connection(write=True) as connection:
            connection.execute(
                "UPDATE turns SET status='failed' WHERE id=? AND status='pending'",
                (turn_id,),
            )

    async def stream_message_events(
        self,
        *,
        session_id: int,
        student_turn_id: int,
        student_sequence: int,
        message: str,
        session: dict[str, Any],
        transcript: list[dict[str, Any]],
        case_content: dict[str, Any],
    ) -> AsyncIterator[str]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
        producer = asyncio.create_task(
            self._produce_message_events(
                queue,
                session_id=session_id,
                student_turn_id=student_turn_id,
                student_sequence=student_sequence,
                message=message,
                session=session,
                transcript=transcript,
                case_content=case_content,
            ),
            name=f"patient-message-{session_id}-{student_turn_id}",
        )
        self._message_tasks.add(producer)
        producer.add_done_callback(self._message_tasks.discard)
        try:
            yield self._sse("meta", {"type": "meta", "studentTurnId": student_turn_id})
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=10)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    break
                event, data = item
                yield self._sse(event, data)
        finally:
            if not producer.done():
                producer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await producer
            self.release_message(session_id)

    async def replay_message_events(
        self,
        *,
        student_turn_id: int,
        patient_turn_id: int,
        patient_reply: str,
    ) -> AsyncIterator[str]:
        """Replay a committed exchange without issuing another model call."""

        yield self._sse("meta", {"type": "meta", "studentTurnId": student_turn_id, "replayed": True})
        yield self._sse("delta", {"type": "delta", "text": patient_reply, "delta": patient_reply})
        yield self._sse(
            "complete",
            {
                "type": "done",
                "patientTurnId": patient_turn_id,
                "turnId": str(patient_turn_id),
                "text": patient_reply,
                "replayed": True,
            },
        )

    @staticmethod
    def _sse(event: str, data: dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"

    async def _produce_message_events(
        self,
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None],
        *,
        session_id: int,
        student_turn_id: int,
        student_sequence: int,
        message: str,
        session: dict[str, Any],
        transcript: list[dict[str, Any]],
        case_content: dict[str, Any],
    ) -> None:
        try:
            planner_started = time.monotonic()
            try:
                planner = await self.provider.plan_disclosure(
                    session_id=session_id,
                    case_content=case_content,
                    transcript=transcript,
                    student_message=message,
                )
            except asyncio.CancelledError:
                raise
            except Exception as error:
                error_code = _error_code(error)
                self._safe_record_model_run(
                    provider=self.provider_name,
                    model=self.model_name,
                    purpose="disclosure-planner",
                    prompt_version=PROMPT_VERSIONS["planner"],
                    latency_ms=round((time.monotonic() - planner_started) * 1000),
                    status="error",
                    session_id=session_id,
                    error_code=error_code,
                )
                self._mark_turn_failed(student_turn_id)
                self.logger.warning(
                    "Disclosure planner failed for session %s (%s)",
                    session_id,
                    error_code,
                )
                await queue.put(
                    (
                        "error",
                        {
                            "type": "error",
                            "code": "DISCLOSURE_PLANNER_FAILED",
                            "message": "The simulated patient could not respond. Please retry.",
                        },
                    )
                )
                return

            planner_meta = planner.get("meta") if isinstance(planner.get("meta"), dict) else {}
            disclosed_ids = planner.get("disclosedFactIds")
            if not isinstance(disclosed_ids, list):
                disclosed_ids = []
            self._safe_record_model_run(
                provider=str(planner_meta.get("provider") or self.provider_name),
                model=str(planner_meta.get("model") or self.model_name),
                purpose="disclosure-planner",
                prompt_version=str(planner_meta.get("promptVersion") or PROMPT_VERSIONS["planner"]),
                latency_ms=int(planner_meta.get("latencyMs") or round((time.monotonic() - planner_started) * 1000)),
                input_tokens=planner_meta.get("inputTokens"),
                output_tokens=planner_meta.get("outputTokens"),
                status="success",
                session_id=session_id,
                metadata={"factCount": len(disclosed_ids)},
            )

            permitted_facts = collect_permitted_facts(case_content, disclosed_ids)
            valid_disclosed_ids = [
                str(fact_id)
                for fact in permitted_facts
                if isinstance(fact, dict)
                for fact_id in [fact.get("id") or fact.get("factId")]
                if isinstance(fact_id, str)
            ]
            patient_chunks: list[str] = []
            patient_reply = ""
            actor_started = time.monotonic()
            try:
                async for chunk in self.provider.stream_patient_reply(
                    session_id=session_id,
                    case_content=case_content,
                    transcript=transcript,
                    student_message=message,
                    disclosed_fact_ids=valid_disclosed_ids,
                    permitted_facts=permitted_facts,
                    question_style=str(planner.get("questionStyle") or "focused"),
                ):
                    patient_chunks.append(chunk)
                    patient_reply += chunk
                if not patient_reply.strip():
                    raise AppError(502, "AI_EMPTY_RESPONSE", "Patient actor returned an empty response")
                patient_reply = patient_reply.strip()
                validate_patient_reply(patient_reply, case_content, valid_disclosed_ids)
                with self.db.connection(write=True) as connection:
                    connection.execute(
                        "UPDATE turns SET status='completed' WHERE id=? AND status='pending'",
                        (student_turn_id,),
                    )
                    result = connection.execute(
                        """INSERT INTO turns
                        (session_id,sequence,speaker,content,status,disclosed_facts_json,created_at)
                        VALUES (?,?,'patient',?,'completed',?,?)""",
                        (
                            session_id,
                            student_sequence + 1,
                            patient_reply,
                            compact_json(valid_disclosed_ids),
                            now_iso(),
                        ),
                    )
                    patient_turn_id = int(result.lastrowid)
                self._safe_record_model_run(
                    provider=self.provider_name,
                    model=self.model_name,
                    purpose="patient-actor",
                    prompt_version=PROMPT_VERSIONS["actor"],
                    latency_ms=round((time.monotonic() - actor_started) * 1000),
                    status="success",
                    session_id=session_id,
                    metadata={"characterCount": len(patient_reply)},
                )
                # Do not release any actor bytes until the complete response has
                # passed the hidden-fact and prompt-leak validation boundary.
                for chunk in patient_chunks:
                    await queue.put(("delta", {"type": "delta", "text": chunk, "delta": chunk}))
                await queue.put(
                    (
                        "complete",
                        {
                            "type": "done",
                            "patientTurnId": patient_turn_id,
                            "turnId": str(patient_turn_id),
                            "text": patient_reply,
                        },
                    )
                )
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._mark_turn_failed(student_turn_id)
                error_code = _error_code(error)
                self._safe_record_model_run(
                    provider=self.provider_name,
                    model=self.model_name,
                    purpose="patient-actor",
                    prompt_version=PROMPT_VERSIONS["actor"],
                    latency_ms=round((time.monotonic() - actor_started) * 1000),
                    status="error",
                    session_id=session_id,
                    error_code=error_code,
                )
                self.logger.warning(
                    "Patient actor failed for session %s (%s)",
                    session_id,
                    error_code,
                )
                await queue.put(
                    (
                        "error",
                        {
                            "type": "error",
                            "code": "PATIENT_RESPONSE_FAILED",
                            "message": "The simulated patient could not respond. Please retry.",
                        },
                    )
                )
        except asyncio.CancelledError:
            self._mark_turn_failed(student_turn_id)
            raise
        except Exception:
            self._mark_turn_failed(student_turn_id)
            self.logger.exception("Unexpected patient-message failure for session %s", session_id)
            await queue.put(
                (
                    "error",
                    {
                        "type": "error",
                        "code": "PATIENT_RESPONSE_FAILED",
                        "message": "The simulated patient could not respond. Please retry.",
                    },
                )
            )
        finally:
            queue.put_nowait(None)

    async def run_evaluation(self, session_id: int) -> None:
        async with self._evaluation_semaphore:
            await self._run_evaluation(session_id)

    async def _run_evaluation(self, session_id: int) -> None:
        # Lazy import prevents the result serializer and session helpers from
        # forming an import cycle while keeping one canonical response shape.
        from .result_service import serialize_result

        try:
            if serialize_result(self.db, session_id) is not None:
                with self.db.connection(write=True) as connection:
                    connection.execute(
                        """UPDATE sessions SET evaluation_status='completed',evaluation_error=NULL
                        WHERE id=?""",
                        (session_id,),
                    )
                return

            session = get_session(self.db, session_id, 0, "faculty")
            with self.db.connection(write=True) as connection:
                connection.execute(
                    """UPDATE sessions SET evaluation_status='running',evaluation_error=NULL,
                    evaluation_started_at=? WHERE id=?""",
                    (now_iso(), session_id),
                )
            transcript = get_scoring_turns(self.db, session_id)
            case_content = parse_json(session.get("content_json"), {})
            criteria = parse_json(session.get("criteria_json"), [])
            evaluation_started = time.monotonic()
            evaluated: dict[str, Any] | None = None
            scoring: dict[str, Any] | None = None
            valid_student_turns = {int(turn["id"]) for turn in transcript if turn.get("speaker") == "student"}
            for attempt in range(1, 3):
                attempt_started = time.monotonic()
                try:
                    evaluated = await self.provider.evaluate(
                        session_id=session_id,
                        case_content=case_content,
                        transcript=transcript,
                        criteria=criteria,
                    )
                    scoring = calculate_score(
                        evaluated.get("value"),
                        criteria,
                        valid_student_turns,
                        case_content=case_content,
                        transcript=transcript,
                    )
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    error_code = _error_code(error)
                    self._safe_record_model_run(
                        provider=self.provider_name,
                        model=self.model_name,
                        purpose="evaluator",
                        prompt_version=PROMPT_VERSIONS["evaluator"],
                        latency_ms=round((time.monotonic() - attempt_started) * 1000),
                        status="error",
                        session_id=session_id,
                        error_code=error_code,
                        metadata={"attempt": attempt},
                    )
                    if attempt < 2 and error_code in RETRYABLE_EVALUATION_ERRORS:
                        self.logger.warning(
                            "Background evaluation attempt %s failed for session %s; retrying (%s)",
                            attempt,
                            session_id,
                            error_code,
                        )
                        await asyncio.sleep(0.5 * attempt)
                        continue
                    with self.db.connection(write=True) as connection:
                        connection.execute(
                            """UPDATE sessions SET evaluation_status='failed',evaluation_error=?
                            WHERE id=?""",
                            (
                                "Feedback generation failed. Please retry from practice history.",
                                session_id,
                            ),
                        )
                    self.logger.error(
                        "Background evaluation failed for session %s (%s)",
                        session_id,
                        error_code,
                    )
                    return
            if evaluated is None or scoring is None:
                return

            meta = evaluated.get("meta") if isinstance(evaluated.get("meta"), dict) else {}
            model_run_id = self._safe_record_model_run(
                provider=str(meta.get("provider") or self.provider_name),
                model=str(meta.get("model") or self.model_name),
                purpose="evaluator",
                prompt_version=str(meta.get("promptVersion") or PROMPT_VERSIONS["evaluator"]),
                latency_ms=round((time.monotonic() - evaluation_started) * 1000),
                input_tokens=meta.get("inputTokens"),
                output_tokens=meta.get("outputTokens"),
                status="success",
                session_id=session_id,
            )
            try:
                evaluated_at = now_iso()
                with self.db.connection(write=True) as connection:
                    result = connection.execute(
                        """INSERT INTO evaluations
                        (session_id,model_run_id,score,level,feedback_json,raw_json,created_at)
                        VALUES (?,?,?,?,?,?,?)""",
                        (
                            session_id,
                            model_run_id,
                            scoring["score"],
                            scoring["level"],
                            compact_json(scoring["feedback"]),
                            compact_json(evaluated.get("value")),
                            evaluated_at,
                        ),
                    )
                    evaluation_id = int(result.lastrowid)
                    for item in scoring["criteria"]:
                        connection.execute(
                            """INSERT INTO criterion_scores
                            (evaluation_id,criterion_id,score,weighted_score,evidence_turn_ids_json,feedback)
                            VALUES (?,?,?,?,?,?)""",
                            (
                                evaluation_id,
                                item["criterionId"],
                                item["score"],
                                item["weightedScore"],
                                compact_json(item["evidenceTurnIds"]),
                                item["feedback"],
                            ),
                        )
                    connection.execute(
                        """UPDATE sessions SET evaluation_status='completed',evaluation_error=NULL
                        WHERE id=?""",
                        (session_id,),
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                if model_run_id is not None:
                    with self.db.connection(write=True) as connection:
                        connection.execute(
                            """UPDATE model_runs SET status='error',error_code='AI_OUTPUT_VALIDATION'
                            WHERE id=?""",
                            (model_run_id,),
                        )
                with self.db.connection(write=True) as connection:
                    connection.execute(
                        """UPDATE sessions SET evaluation_status='failed',evaluation_error=?
                        WHERE id=?""",
                        (
                            "The assessment response could not be validated. Please retry from practice history.",
                            session_id,
                        ),
                    )
                self.logger.exception("Background scoring failed for session %s", session_id)
        except asyncio.CancelledError:
            # A process shutdown leaves the durable task claim retryable. The
            # next application start will recover it from SQLite.
            with self.db.connection(write=True) as connection:
                connection.execute(
                    """UPDATE sessions SET evaluation_status='queued',evaluation_error=NULL
                    WHERE id=? AND evaluation_status='running'""",
                    (session_id,),
                )
            raise
        except Exception:
            with self.db.connection(write=True) as connection:
                connection.execute(
                    """UPDATE sessions SET evaluation_status='failed',evaluation_error=?
                    WHERE id=?""",
                    (
                        "Feedback generation failed. Please retry from practice history.",
                        session_id,
                    ),
                )
            self.logger.exception("Unexpected background evaluation failure for session %s", session_id)
