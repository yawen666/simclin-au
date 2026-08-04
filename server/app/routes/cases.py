from __future__ import annotations

import math
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


def _case_map(row: dict[str, Any], metadata: dict[str, Any] | None = None) -> dict[str, Any]:
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
        "version": row.get("current_version"),
        "publishedVersion": row.get("published_version"),
        "attempts": int(row.get("attempts") or 0),
        "updatedAt": row.get("updated_at"),
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

    opening_statement = content.get("openingStatement", content.get("opening_statement"))
    patient = content.get("patient")
    patient_name = patient.get("name") if isinstance(patient, dict) else None
    patient_age = patient.get("age") if isinstance(patient, dict) else None
    has_patient_identity = (
        isinstance(patient_name, str)
        and bool(patient_name.strip())
        and isinstance(patient_age, (int, float))
        and not isinstance(patient_age, bool)
        and math.isfinite(patient_age)
        and patient_age > 0
    )
    case_data = content.get("caseData")
    facts = case_data.get("atomicFacts") if isinstance(case_data, dict) else None
    has_usable_fact = isinstance(facts, list) and any(
        isinstance(fact, dict)
        and isinstance(fact.get("id"), str)
        and bool(fact["id"].strip())
        and isinstance(fact.get("label"), str)
        and bool(fact["label"].strip())
        and isinstance(fact.get("value"), str)
        and bool(fact["value"].strip())
        for fact in facts
    )
    if (
        not isinstance(opening_statement, str)
        or not opening_statement.strip()
        or not has_patient_identity
        or not has_usable_fact
    ):
        raise AppError(
            409,
            "CASE_CONTENT_INCOMPLETE",
            (
                "Add the patient identity, an opening statement and at least one structured "
                "patient fact before publishing this case"
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
            SELECT c.*{",cv.metadata_json" if not faculty else ""},
              (SELECT COUNT(*) FROM sessions s WHERE s.case_id=c.id) AS attempts
            FROM cases c {version_join} {where} ORDER BY c.id
            """
        ).fetchall()
    cases = [
        _case_map(
            dict(row),
            parse_json(row["metadata_json"], {}) if not faculty else None,
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
        **_case_map(row_dict, version_metadata),
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
    return {"id": case_id, "version": 1, "status": "draft"}


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
        creates_version = any(
            value is not None
            for value in (
                payload.title,
                payload.specialty,
                payload.setting,
                payload.summary,
                payload.difficulty,
                payload.estimatedMinutes,
                payload.content,
                payload.rubricId,
            )
        )
        next_version = int(row_dict["current_version"]) + (1 if creates_version else 0)
        connection.execute(
            """
            UPDATE cases
            SET title=?,specialty=?,setting=?,summary=?,difficulty=?,estimated_minutes=?,current_version=?,updated_at=?
            WHERE id=?
            """,
            (
                payload.title if payload.title is not None else row_dict["title"],
                payload.specialty if payload.specialty is not None else row_dict["specialty"],
                payload.setting if payload.setting is not None else row_dict["setting"],
                payload.summary if payload.summary is not None else row_dict["summary"],
                payload.difficulty if payload.difficulty is not None else row_dict["difficulty"],
                payload.estimatedMinutes if payload.estimatedMinutes is not None else row_dict["estimated_minutes"],
                next_version,
                now,
                case_id,
            ),
        )
        if creates_version:
            if payload.content is None:
                prior_version = require_found(
                    connection.execute(
                        "SELECT content_json FROM case_versions WHERE case_id=? AND version=?",
                        (case_id, row_dict["current_version"]),
                    ).fetchone(),
                    "Case version",
                )
                content_source = parse_json(prior_version["content_json"], {})
            else:
                content_source = payload.content
            if not isinstance(content_source, dict):
                content_source = {}
            content = {
                **content_source,
                "slug": row_dict["slug"],
                "title": payload.title if payload.title is not None else row_dict["title"],
            }
            current_link = connection.execute(
                "SELECT rubric_id FROM case_rubrics WHERE case_id=?",
                (case_id,),
            ).fetchone()
            rubric_id = (
                payload.rubricId
                if payload.rubricId is not None
                else (current_link["rubric_id"] if current_link is not None else None)
            )
            connection.execute(
                """INSERT INTO case_versions
                (case_id,version,content_json,rubric_id,metadata_json,created_at) VALUES (?,?,?,?,?,?)""",
                (
                    case_id,
                    next_version,
                    compact_json(content),
                    rubric_id,
                    compact_json(
                        _metadata(
                            row_dict,
                            title=payload.title,
                            specialty=payload.specialty,
                            setting=payload.setting,
                            summary=payload.summary,
                            difficulty=payload.difficulty,
                            estimated_minutes=payload.estimatedMinutes,
                        )
                    ),
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
    return {"id": case_id, "version": next_version}


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
    return {"id": case_id, "status": "published"}


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
