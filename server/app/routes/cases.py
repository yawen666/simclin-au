from __future__ import annotations

import re
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request, status
from pydantic import BaseModel, Field, field_validator

from ..ai import collect_permitted_facts, validate_patient_reply
from ..database import Database
from ..errors import AppError, require_found
from ..utils import compact_json, now_iso, parse_json
from ..webdeps import current_user, enforce_ai_rate_limit, require_faculty

router = APIRouter(prefix="/api/cases", tags=["cases"])
STRUCTURED_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
MAX_PUBLISHED_CONTENT_BYTES = 160 * 1024


class CaseInput(BaseModel):
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    title: str = Field(min_length=2, max_length=160)
    specialty: str = Field(min_length=2, max_length=100)
    setting: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=1000)
    difficulty: str = Field(default="Intermediate", max_length=60)
    estimatedMinutes: int = Field(default=12, ge=3, le=60)
    content: dict[str, Any]
    rubricId: int | None = Field(default=None, gt=0)


class CasePatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    specialty: str | None = Field(default=None, min_length=2, max_length=100)
    setting: str | None = Field(default=None, max_length=120)
    summary: str | None = Field(default=None, max_length=1000)
    difficulty: str | None = Field(default=None, max_length=60)
    estimatedMinutes: int | None = Field(default=None, ge=3, le=60)
    content: dict[str, Any] | None = None
    rubricId: int | None = Field(default=None, gt=0)


class PreviewMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def trim_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("String should have at least 1 character")
        return value


def _database(request: Request) -> Database:
    return request.app.state.db


def _role(user: Any) -> str | None:
    if isinstance(user, dict):
        return user.get("role")
    return getattr(user, "role", None)


def _case_map(
    row: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    *,
    published_projection: bool = False,
) -> dict[str, Any]:
    source = {**row, **(metadata or {})}
    estimated_minutes = source.get("estimated_minutes")
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "title": source.get("title"),
        "specialty": source.get("specialty"),
        "setting": source.get("setting"),
        "summary": source.get("summary"),
        "difficulty": source.get("difficulty"),
        "estimatedMinutes": estimated_minutes,
        "durationMinutes": estimated_minutes,
        "subtitle": source.get("summary"),
        "status": row.get("status"),
        "version": row.get("published_version") if published_projection else row.get("current_version"),
        "publishedVersion": row.get("published_version"),
        "attempts": int(row.get("attempts") or 0),
        "updatedAt": row.get("published_updated_at") if published_projection else row.get("updated_at"),
    }


def _metadata(
    row: dict[str, Any],
    *,
    title: str | None = None,
    specialty: str | None = None,
    setting: str | None = None,
    summary: str | None = None,
    difficulty: str | None = None,
    estimated_minutes: int | None = None,
) -> dict[str, Any]:
    return {
        "title": title if title is not None else row["title"],
        "specialty": specialty if specialty is not None else row["specialty"],
        "setting": setting if setting is not None else row["setting"],
        "summary": summary if summary is not None else row["summary"],
        "difficulty": difficulty if difficulty is not None else row["difficulty"],
        "estimated_minutes": estimated_minutes if estimated_minutes is not None else row["estimated_minutes"],
    }


def _available_red_flag_ids(content: dict[str, Any]) -> set[str]:
    case_data = content.get("caseData")
    if not isinstance(case_data, dict):
        return set()
    ids: set[str] = set()
    for collection_name in ("atomicFacts", "redFlags"):
        collection = case_data.get(collection_name)
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            value = item.get("id")
            if isinstance(value, str) and value.strip():
                ids.add(value)
    return ids


def _unknown_rubric_red_flag_ids(criteria: list[dict[str, Any]], content: dict[str, Any]) -> list[str]:
    available = _available_red_flag_ids(content)
    unknown: list[str] = []
    for criterion in criteria:
        red_flag_ids = criterion.get("redFlagIds")
        if not isinstance(red_flag_ids, list):
            continue
        for value in red_flag_ids:
            if isinstance(value, str) and value not in available and value not in unknown:
                unknown.append(value)
    return unknown


def _validate_publishable_case(connection: Any, case_id: int, version_number: int) -> int:
    case_row = require_found(
        connection.execute(
            "SELECT title,summary,setting,estimated_minutes FROM cases WHERE id=?",
            (case_id,),
        ).fetchone(),
        "Case",
    )
    linked = connection.execute(
        """
        SELECT r.id,r.published_version AS publishedVersion
        FROM case_rubrics cr
        JOIN rubrics r ON r.id=cr.rubric_id
        WHERE cr.case_id=? AND r.status='published' AND r.published_version IS NOT NULL
        """,
        (case_id,),
    ).fetchone()
    if linked is None:
        raise AppError(
            409,
            "PUBLISHED_RUBRIC_REQUIRED",
            "Link a published rubric before publishing this case",
        )

    version = require_found(
        connection.execute(
            "SELECT content_json FROM case_versions WHERE case_id=? AND version=?",
            (case_id, version_number),
        ).fetchone(),
        "Case version",
    )
    content = parse_json(version["content_json"], {})
    if not isinstance(content, dict):
        content = {}
    if len(compact_json(content).encode("utf-8")) > MAX_PUBLISHED_CONTENT_BYTES:
        raise AppError(409, "CASE_CONTENT_TOO_LARGE", "Published case content must be 160 KB or smaller")

    opening_statement = content.get("openingStatement", content.get("opening_statement"))
    patient = content.get("patient")
    patient_name = patient.get("name") if isinstance(patient, dict) else None
    patient_age = patient.get("age") if isinstance(patient, dict) else None
    has_patient_identity = (
        isinstance(patient_name, str)
        and 1 <= len(patient_name.strip()) <= 120
        and isinstance(patient_age, int)
        and not isinstance(patient_age, bool)
        and 1 <= patient_age <= 110
    )
    case_data = content.get("caseData")
    candidate_instructions = case_data.get("candidateInstructions") if isinstance(case_data, dict) else None
    presenting_complaint = case_data.get("presentingComplaint") if isinstance(case_data, dict) else None
    student_brief_valid = (
        isinstance(case_row["summary"], str)
        and 1 <= len(case_row["summary"].strip()) <= 1000
        and isinstance(case_row["setting"], str)
        and 1 <= len(case_row["setting"].strip()) <= 120
        and isinstance(case_row["estimated_minutes"], int)
        and 3 <= case_row["estimated_minutes"] <= 60
        and isinstance(candidate_instructions, str)
        and 1 <= len(candidate_instructions.strip()) <= 4000
        and isinstance(presenting_complaint, str)
        and 1 <= len(presenting_complaint.strip()) <= 4000
    )
    facts = case_data.get("atomicFacts") if isinstance(case_data, dict) else None
    fact_ids: list[str] = []
    facts_valid = isinstance(facts, list) and 1 <= len(facts) <= 80
    if isinstance(facts, list):
        for fact in facts:
            if not isinstance(fact, dict):
                facts_valid = False
                continue
            fact_id = fact.get("id")
            label = fact.get("label")
            value = fact.get("value")
            category = fact.get("category", "")
            disclosure_level = fact.get("disclosureLevel")
            triggers = fact.get("triggers", [])
            fact_valid = (
                isinstance(fact_id, str)
                and STRUCTURED_ID_PATTERN.fullmatch(fact_id) is not None
                and isinstance(label, str)
                and 1 <= len(label.strip()) <= 200
                and isinstance(value, str)
                and 1 <= len(value.strip()) <= 2000
                and isinstance(category, str)
                and 1 <= len(category.strip()) <= 80
                and disclosure_level in {"opening", "broad_question", "direct_question", "specific_question"}
                and isinstance(triggers, list)
                and len(triggers) <= 25
                and all(isinstance(trigger, str) and 1 <= len(trigger.strip()) <= 200 for trigger in triggers)
            )
            facts_valid = facts_valid and fact_valid
            if isinstance(fact_id, str):
                fact_ids.append(fact_id)
    facts_valid = facts_valid and len(fact_ids) == len(set(fact_ids))

    red_flags = case_data.get("redFlags", []) if isinstance(case_data, dict) else []
    red_flag_ids: list[str] = []
    red_flags_valid = isinstance(red_flags, list) and len(red_flags) <= 40
    if isinstance(red_flags, list):
        for flag in red_flags:
            if not isinstance(flag, dict):
                red_flags_valid = False
                continue
            flag_id = flag.get("id")
            label = flag.get("label")
            linked_ids = flag.get("linkedFactIds", [])
            required_questions = flag.get("requiredQuestions", [])
            flag_valid = (
                isinstance(flag_id, str)
                and STRUCTURED_ID_PATTERN.fullmatch(flag_id) is not None
                and isinstance(label, str)
                and 1 <= len(label.strip()) <= 200
                and isinstance(linked_ids, list)
                and 1 <= len(linked_ids) <= 20
                and all(isinstance(value, str) and value in fact_ids for value in linked_ids)
                and isinstance(required_questions, list)
                and len(required_questions) <= 25
                and all(isinstance(value, str) and 1 <= len(value.strip()) <= 200 for value in required_questions)
            )
            red_flags_valid = red_flags_valid and flag_valid
            if isinstance(flag_id, str):
                red_flag_ids.append(flag_id)
    red_flags_valid = red_flags_valid and len(red_flag_ids) == len(set(red_flag_ids))

    learning_objectives = case_data.get("learningObjectives", []) if isinstance(case_data, dict) else []
    actor_rules = case_data.get("patientActorRules", []) if isinstance(case_data, dict) else []
    supporting_lists_valid = (
        isinstance(learning_objectives, list)
        and len(learning_objectives) <= 20
        and all(isinstance(value, str) and 1 <= len(value.strip()) <= 500 for value in learning_objectives)
        and isinstance(actor_rules, list)
        and len(actor_rules) <= 20
        and all(isinstance(value, str) and 1 <= len(value.strip()) <= 500 for value in actor_rules)
    )
    if (
        not isinstance(opening_statement, str)
        or not 1 <= len(opening_statement.strip()) <= 2000
        or not has_patient_identity
        or not student_brief_valid
        or not facts_valid
        or not red_flags_valid
        or not supporting_lists_valid
    ):
        raise AppError(
            409,
            "CASE_CONTENT_INCOMPLETE",
            (
                "Complete the student brief, clinical setting, patient identity, presenting complaint, "
                "opening statement and at least one structured patient fact before publishing this case; "
                "fact and red-flag IDs must be unique and structurally valid"
            ),
        )

    rubric_version = require_found(
        connection.execute(
            "SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?",
            (linked["id"], linked["publishedVersion"]),
        ).fetchone(),
        "Published rubric version",
    )
    criteria = parse_json(rubric_version["criteria_json"], [])
    if not isinstance(criteria, list):
        criteria = []
    unknown_ids = _unknown_rubric_red_flag_ids(criteria, content)
    if unknown_ids:
        raise AppError(
            409,
            "RUBRIC_RED_FLAG_MISMATCH",
            f"The linked rubric references red-flag IDs that are not in this case: {', '.join(unknown_ids)}",
        )
    return int(linked["id"])


def _base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    encoded = ""
    while value:
        value, remainder = divmod(value, 36)
        encoded = alphabet[remainder] + encoded
    return encoded


def _case_detail(connection: Any, case_id: int, *, faculty: bool) -> dict[str, Any]:
    """Return the canonical case representation from an existing transaction."""
    row = require_found(
        connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
        "Case",
    )
    row_dict = dict(row)
    if not faculty and row_dict["status"] != "published":
        raise AppError(404, "NOT_FOUND", "Case not found")
    selected_version = row_dict["current_version"] if faculty else row_dict["published_version"]
    version = require_found(
        connection.execute(
            "SELECT * FROM case_versions WHERE case_id=? AND version=?",
            (case_id, selected_version),
        ).fetchone(),
        "Case version",
    )
    rubric_id = version["rubric_id"]
    if rubric_id is None or faculty:
        current_link = connection.execute(
            "SELECT rubric_id FROM case_rubrics WHERE case_id=?",
            (case_id,),
        ).fetchone()
        rubric_id = current_link["rubric_id"] if current_link is not None else rubric_id
    rubric_row = (
        connection.execute(
            "SELECT id,slug,name FROM rubrics WHERE id=?",
            (rubric_id,),
        ).fetchone()
        if rubric_id is not None
        else None
    )

    content = parse_json(version["content_json"], {})
    if not isinstance(content, dict):
        content = {}
    case_data = content.get("caseData")
    patient = content.get("patient")
    version_metadata = parse_json(version["metadata_json"], {}) if not faculty else None
    detail = {
        **_case_map(
            {**row_dict, "published_updated_at": version["created_at"]},
            version_metadata,
            published_projection=not faculty,
        ),
        "task": case_data.get("candidateInstructions", "") if isinstance(case_data, dict) else "",
        "learningObjectives": case_data.get("learningObjectives", []) if isinstance(case_data, dict) else [],
    }
    if faculty:
        detail.update(
            {
                "content": content,
                "caseData": case_data if case_data is not None else content,
                "patientName": patient.get("name") if isinstance(patient, dict) else None,
                "patientAge": patient.get("age") if isinstance(patient, dict) else None,
                "rubric": dict(rubric_row) if rubric_row is not None else None,
            }
        )
    return {**detail, "case": detail}


@router.get("")
def list_cases(
    request: Request,
    user: Annotated[Any, Depends(current_user)],
) -> dict[str, Any]:
    db = _database(request)
    faculty = _role(user) == "faculty"
    where = "" if faculty else "WHERE c.status='published'"
    version_join = "" if faculty else "JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version"
    with db.connection() as connection:
        rows = connection.execute(
            f"""
            SELECT c.*{",cv.metadata_json,cv.created_at AS published_updated_at" if not faculty else ""},
              (SELECT COUNT(*) FROM sessions s WHERE s.case_id=c.id) AS attempts
            FROM cases c {version_join} {where} ORDER BY c.id
            """
        ).fetchall()
    cases = [
        _case_map(
            dict(row),
            parse_json(row["metadata_json"], {}) if not faculty else None,
            published_projection=not faculty,
        )
        for row in rows
    ]
    return {"cases": cases, "items": cases}


@router.get("/{case_id}")
def get_case(
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    user: Annotated[Any, Depends(current_user)],
) -> dict[str, Any]:
    db = _database(request)
    faculty = _role(user) == "faculty"
    with db.connection() as connection:
        return _case_detail(connection, case_id, faculty=faculty)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseInput,
    request: Request,
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    now = now_iso()
    with db.connection(write=True) as connection:
        result = connection.execute(
            """
            INSERT INTO cases
              (slug,title,specialty,setting,summary,difficulty,estimated_minutes,
               status,current_version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,'draft',1,?,?)
            """,
            (
                payload.slug,
                payload.title,
                payload.specialty,
                payload.setting,
                payload.summary,
                payload.difficulty,
                payload.estimatedMinutes,
                now,
                now,
            ),
        )
        case_id = int(result.lastrowid)
        content = {**payload.content, "slug": payload.slug, "title": payload.title}
        connection.execute(
            """INSERT INTO case_versions
            (case_id,version,content_json,rubric_id,metadata_json,created_at) VALUES (?,1,?,?,?,?)""",
            (
                case_id,
                compact_json(content),
                payload.rubricId,
                compact_json(
                    {
                        "title": payload.title,
                        "specialty": payload.specialty,
                        "setting": payload.setting,
                        "summary": payload.summary,
                        "difficulty": payload.difficulty,
                        "estimated_minutes": payload.estimatedMinutes,
                    }
                ),
                now,
            ),
        )
        if payload.rubricId is not None:
            connection.execute(
                "INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)",
                (case_id, payload.rubricId),
            )
        detail = _case_detail(connection, case_id, faculty=True)
    return detail


@router.patch("/{case_id}")
def update_case(
    payload: CasePatch,
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection(write=True) as connection:
        row = require_found(
            connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
            "Case",
        )
        row_dict = dict(row)
        now = now_iso()
        prior_version = require_found(
            connection.execute(
                "SELECT content_json FROM case_versions WHERE case_id=? AND version=?",
                (case_id, row_dict["current_version"]),
            ).fetchone(),
            "Case version",
        )
        prior_content = parse_json(prior_version["content_json"], {})
        if not isinstance(prior_content, dict):
            prior_content = {}
        content_source = payload.content if payload.content is not None else prior_content
        content = {
            **content_source,
            "slug": row_dict["slug"],
            "title": payload.title if payload.title is not None else row_dict["title"],
        }
        current_link = connection.execute(
            "SELECT rubric_id FROM case_rubrics WHERE case_id=?",
            (case_id,),
        ).fetchone()
        current_rubric_id = current_link["rubric_id"] if current_link is not None else None
        rubric_id = payload.rubricId if payload.rubricId is not None else current_rubric_id
        metadata = _metadata(
            row_dict,
            title=payload.title,
            specialty=payload.specialty,
            setting=payload.setting,
            summary=payload.summary,
            difficulty=payload.difficulty,
            estimated_minutes=payload.estimatedMinutes,
        )
        metadata_changed = any(
            metadata[key] != row_dict[column]
            for key, column in (
                ("title", "title"),
                ("specialty", "specialty"),
                ("setting", "setting"),
                ("summary", "summary"),
                ("difficulty", "difficulty"),
                ("estimated_minutes", "estimated_minutes"),
            )
        )
        content_changed = (payload.content is not None or payload.title is not None) and content != prior_content
        rubric_changed = payload.rubricId is not None and payload.rubricId != current_rubric_id
        creates_version = metadata_changed or content_changed or rubric_changed
        next_version = int(row_dict["current_version"]) + (1 if creates_version else 0)
        if creates_version:
            connection.execute(
                """
                UPDATE cases
                SET title=?,specialty=?,setting=?,summary=?,difficulty=?,estimated_minutes=?,current_version=?,updated_at=?
                WHERE id=?
                """,
                (
                    metadata["title"],
                    metadata["specialty"],
                    metadata["setting"],
                    metadata["summary"],
                    metadata["difficulty"],
                    metadata["estimated_minutes"],
                    next_version,
                    now,
                    case_id,
                ),
            )
            connection.execute(
                """INSERT INTO case_versions
                (case_id,version,content_json,rubric_id,metadata_json,created_at) VALUES (?,?,?,?,?,?)""",
                (
                    case_id,
                    next_version,
                    compact_json(content),
                    rubric_id,
                    compact_json(metadata),
                    now,
                ),
            )
        if payload.rubricId is not None:
            connection.execute(
                """
                INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)
                ON CONFLICT(case_id) DO UPDATE SET rubric_id=excluded.rubric_id
                """,
                (case_id, payload.rubricId),
            )
        detail = _case_detail(connection, case_id, faculty=True)
    return detail


@router.post("/{case_id}/publish")
def publish_case(
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection(write=True) as connection:
        row = require_found(
            connection.execute("SELECT current_version FROM cases WHERE id=?", (case_id,)).fetchone(),
            "Case",
        )
        rubric_id = _validate_publishable_case(connection, case_id, row["current_version"])
        current = dict(
            require_found(
                connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
                "Case",
            )
        )
        now = now_iso()
        connection.execute(
            """
            UPDATE cases
            SET status='published',published_version=current_version,archived_at=NULL,updated_at=?
            WHERE id=?
            """,
            (now, case_id),
        )
        connection.execute(
            """
            UPDATE case_versions
            SET published_at=COALESCE(published_at,?),rubric_id=?,metadata_json=?
            WHERE case_id=? AND version=?
            """,
            (now, rubric_id, compact_json(_metadata(current)), case_id, row["current_version"]),
        )
        detail = _case_detail(connection, case_id, faculty=True)
    return detail


@router.post("/{case_id}/archive")
def archive_case(
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    now = now_iso()
    with db.connection(write=True) as connection:
        result = connection.execute(
            "UPDATE cases SET status='archived',archived_at=?,updated_at=? WHERE id=?",
            (now, now, case_id),
        )
        if result.rowcount == 0:
            raise AppError(404, "NOT_FOUND", "Case not found")
    return {"id": case_id, "status": "archived"}


@router.post("/{case_id}/preview")
def preview_case(
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection() as connection:
        row = require_found(
            connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
            "Case",
        )
    return {**_case_map(dict(row)), "preview": True}


@router.post("/{case_id}/preview/respond")
async def preview_case_response(
    payload: PreviewMessage,
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    enforce_ai_rate_limit(request, faculty)
    provider = getattr(request.app.state, "ai", None)
    if provider is None:
        raise AppError(503, "AI_NOT_CONFIGURED", "AI preview is not available")
    db = _database(request)
    with db.connection() as connection:
        row = require_found(
            connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
            "Case",
        )
        version = require_found(
            connection.execute(
                "SELECT content_json FROM case_versions WHERE case_id=? AND version=?",
                (case_id, row["current_version"]),
            ).fetchone(),
            "Case version",
        )

    content = parse_json(version["content_json"], {})
    if not isinstance(content, dict):
        content = {}
    opening = content.get("openingStatement")
    if not isinstance(opening, str):
        opening = "Hello. I was told you would like to ask me some questions."
    transcript = [{"id": 0, "sequence": 1, "speaker": "patient", "content": opening, "status": "completed"}]
    planner = await provider.plan_disclosure(
        session_id=0,
        case_content=content,
        transcript=transcript,
        student_message=payload.message,
    )
    permitted_facts = collect_permitted_facts(content, planner["disclosedFactIds"])
    permitted_fact_ids: list[str] = []
    for fact in permitted_facts:
        fact_id = fact.get("id")
        if isinstance(fact_id, str):
            permitted_fact_ids.append(fact_id)

    chunks: list[str] = []
    async for chunk in provider.stream_patient_reply(
        session_id=0,
        case_content=content,
        transcript=transcript,
        student_message=payload.message,
        disclosed_fact_ids=permitted_fact_ids,
        permitted_facts=permitted_facts,
        question_style=planner["questionStyle"],
    ):
        chunks.append(chunk)
    text = "".join(chunks).strip()
    if not text:
        raise AppError(502, "AI_EMPTY_RESPONSE", "Patient actor returned an empty response")
    validate_patient_reply(text, content, permitted_fact_ids)
    return {
        "text": text,
        "disclosedFactIds": permitted_fact_ids,
        "permittedFacts": permitted_facts,
        "model": planner["meta"]["model"],
    }


@router.post("/{case_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_case(
    request: Request,
    case_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    now = now_iso()
    suffix = _base36(int(time.time() * 1000))
    with db.connection(write=True) as connection:
        row = require_found(
            connection.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone(),
            "Case",
        )
        version = require_found(
            connection.execute(
                "SELECT content_json FROM case_versions WHERE case_id=? AND version=?",
                (case_id, row["current_version"]),
            ).fetchone(),
            "Case version",
        )
        link = connection.execute("SELECT rubric_id FROM case_rubrics WHERE case_id=?", (case_id,)).fetchone()
        result = connection.execute(
            """
            INSERT INTO cases
              (slug,title,specialty,setting,summary,difficulty,estimated_minutes,
               status,current_version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,'draft',1,?,?)
            """,
            (
                f"{row['slug']}-copy-{suffix}",
                f"{row['title']} (copy)",
                row["specialty"],
                row["setting"],
                row["summary"],
                row["difficulty"],
                row["estimated_minutes"],
                now,
                now,
            ),
        )
        duplicate_id = int(result.lastrowid)
        connection.execute(
            """INSERT INTO case_versions
            (case_id,version,content_json,rubric_id,metadata_json,created_at) VALUES (?,1,?,?,?,?)""",
            (
                duplicate_id,
                version["content_json"],
                link["rubric_id"] if link is not None else None,
                compact_json(_metadata({**dict(row), "title": f"{row['title']} (copy)"})),
                now,
            ),
        )
        if link is not None:
            connection.execute(
                "INSERT INTO case_rubrics (case_id,rubric_id) VALUES (?,?)",
                (duplicate_id, link["rubric_id"]),
            )
        duplicate = connection.execute("SELECT * FROM cases WHERE id=?", (duplicate_id,)).fetchone()
    return _case_map(dict(duplicate))
