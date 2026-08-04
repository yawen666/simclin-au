from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..database import Database
from ..errors import AppError, require_found
from ..utils import compact_json, now_iso, parse_json
from ..webdeps import require_faculty
from .cases import STRUCTURED_ID_PATTERN, _unknown_rubric_red_flag_ids

router = APIRouter(prefix="/api/rubrics", tags=["rubrics"])


class CriterionInput(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    label: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    weight: float = Field(gt=0, le=100)
    maxScore: int = 3
    critical: bool | None = None
    redFlagIds: list[str] | None = None

    @field_validator("maxScore")
    @classmethod
    def max_score_must_be_three(cls, value: int) -> int:
        if value != 3:
            raise ValueError("Criterion maxScore must be 3")
        return value

    @model_validator(mode="after")
    def require_label(self) -> CriterionInput:
        label = self.label if self.label is not None else self.name
        if label is None:
            raise ValueError("Criterion label is required")
        self.label = label
        return self

    def client_json(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class RubricInput(BaseModel):
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1000)
    criteria: list[CriterionInput] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_criterion_ids(self) -> RubricInput:
        ids = [criterion.id for criterion in self.criteria]
        if len(set(ids)) != len(ids):
            raise ValueError("Criterion IDs must be unique")
        return self


class RubricPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    criteria: list[CriterionInput] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def unique_criterion_ids(self) -> RubricPatch:
        if self.criteria is not None:
            ids = [criterion.id for criterion in self.criteria]
            if len(set(ids)) != len(ids):
                raise ValueError("Criterion IDs must be unique")
        return self


def _database(request: Request) -> Database:
    return request.app.state.db


def _validate_weights(criteria: list[dict[str, Any]]) -> None:
    total = sum(float(item["weight"]) for item in criteria)
    if abs(total - 100) > 0.001:
        raise AppError(
            400,
            "INVALID_RUBRIC_WEIGHT",
            "Rubric criterion weights must total 100",
        )


def _anchors_are_complete(value: Any) -> bool:
    if isinstance(value, dict):
        if {str(key) for key in value} != {"0", "1", "2", "3"}:
            return False
        return all(
            isinstance(description, str) and 1 <= len(description.strip()) <= 1000 for description in value.values()
        )
    if not isinstance(value, list) or len(value) != 4:
        return False
    scores: list[int] = []
    for anchor in value:
        if not isinstance(anchor, dict):
            return False
        score = anchor.get("score")
        label = anchor.get("label")
        description = anchor.get("description")
        if (
            not isinstance(score, int)
            or isinstance(score, bool)
            or score not in {0, 1, 2, 3}
            or not isinstance(label, str)
            or not 1 <= len(label.strip()) <= 120
            or not isinstance(description, str)
            or not 1 <= len(description.strip()) <= 1000
        ):
            return False
        scores.append(score)
    return set(scores) == {0, 1, 2, 3}


def _validate_publishable_criteria(criteria: list[dict[str, Any]]) -> None:
    ids: list[str] = []
    valid = 1 <= len(criteria) <= 20
    for criterion in criteria:
        if not isinstance(criterion, dict):
            valid = False
            continue
        criterion_id = criterion.get("id")
        label = criterion.get("label", criterion.get("name"))
        description = criterion.get("description")
        red_flag_ids = criterion.get("redFlagIds", [])
        red_flag_ids_valid = (
            isinstance(red_flag_ids, list)
            and len(red_flag_ids) <= 40
            and all(
                isinstance(value, str) and STRUCTURED_ID_PATTERN.fullmatch(value) is not None for value in red_flag_ids
            )
        )
        if red_flag_ids_valid:
            red_flag_ids_valid = len(red_flag_ids) == len(set(red_flag_ids))
        item_valid = (
            isinstance(criterion_id, str)
            and STRUCTURED_ID_PATTERN.fullmatch(criterion_id) is not None
            and isinstance(label, str)
            and 1 <= len(label.strip()) <= 160
            and isinstance(description, str)
            and 1 <= len(description.strip()) <= 1000
            and red_flag_ids_valid
            and _anchors_are_complete(criterion.get("anchors"))
        )
        valid = valid and item_valid
        if isinstance(criterion_id, str):
            ids.append(criterion_id)
    valid = valid and len(ids) == len(set(ids))
    try:
        _validate_weights(criteria)
    except (AppError, KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise AppError(
            409,
            "RUBRIC_CONTENT_INCOMPLETE",
            "Complete every domain, weight and behaviour anchor (scores 0 to 3) before publishing this rubric",
        )


def _criterion_payload(criteria: list[CriterionInput]) -> list[dict[str, Any]]:
    return [criterion.client_json() for criterion in criteria]


def _client_criteria(criteria: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for criterion in criteria:
        item = {**criterion, "name": criterion.get("label")}
        anchors = criterion.get("anchors")
        if isinstance(anchors, list):
            item["anchors"] = anchors
        elif isinstance(anchors, dict):
            converted = []
            for score, description in anchors.items():
                numeric_score = float(score)
                if numeric_score.is_integer():
                    numeric_score = int(numeric_score)
                converted.append(
                    {
                        "score": numeric_score,
                        "label": (
                            "Not demonstrated"
                            if numeric_score == 0
                            else "Proficient"
                            if numeric_score == 3
                            else "Developing"
                        ),
                        "description": description,
                    }
                )
            item["anchors"] = converted
        else:
            item["anchors"] = []
        result.append(item)
    return result


@router.get("")
def list_rubrics(
    request: Request,
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    rubrics: list[dict[str, Any]] = []
    with db.connection() as connection:
        rows = connection.execute("SELECT * FROM rubrics ORDER BY id").fetchall()
        for row in rows:
            version = connection.execute(
                "SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?",
                (row["id"], row["current_version"]),
            ).fetchone()
            criteria = parse_json(version["criteria_json"], []) if version is not None else []
            if not isinstance(criteria, list):
                criteria = []
            rubrics.append(
                {
                    "id": row["id"],
                    "slug": row["slug"],
                    "name": row["name"],
                    "description": row["description"],
                    "status": row["status"],
                    "version": row["current_version"],
                    "publishedVersion": row["published_version"],
                    "updatedAt": row["updated_at"],
                    "criteria": _client_criteria(criteria),
                }
            )
    return {"rubrics": rubrics, "items": rubrics}


@router.get("/{rubric_id}")
def get_rubric(
    request: Request,
    rubric_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection() as connection:
        row = require_found(
            connection.execute("SELECT * FROM rubrics WHERE id=?", (rubric_id,)).fetchone(),
            "Rubric",
        )
        version = require_found(
            connection.execute(
                "SELECT * FROM rubric_versions WHERE rubric_id=? AND version=?",
                (rubric_id, row["current_version"]),
            ).fetchone(),
            "Rubric version",
        )
    criteria = parse_json(version["criteria_json"], [])
    if not isinstance(criteria, list):
        criteria = []
    rubric = {
        "id": rubric_id,
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
        "version": row["current_version"],
        "publishedVersion": row["published_version"],
        "criteria": _client_criteria(criteria),
    }
    return {**rubric, "rubric": rubric}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rubric(
    payload: RubricInput,
    request: Request,
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    criteria = _criterion_payload(payload.criteria)
    _validate_weights(criteria)
    db = _database(request)
    now = now_iso()
    with db.connection(write=True) as connection:
        result = connection.execute(
            """
            INSERT INTO rubrics (slug,name,description,status,current_version,created_at,updated_at)
            VALUES (?,?,?,'draft',1,?,?)
            """,
            (payload.slug, payload.name, payload.description, now, now),
        )
        rubric_id = int(result.lastrowid)
        connection.execute(
            "INSERT INTO rubric_versions (rubric_id,version,criteria_json,created_at) VALUES (?,1,?,?)",
            (rubric_id, compact_json(criteria), now),
        )
    return {"id": rubric_id, "version": 1, "status": "draft"}


@router.patch("/{rubric_id}")
def update_rubric(
    payload: RubricPatch,
    request: Request,
    rubric_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    criteria = _criterion_payload(payload.criteria) if payload.criteria is not None else None
    if criteria is not None:
        _validate_weights(criteria)
    db = _database(request)
    with db.connection(write=True) as connection:
        row = require_found(
            connection.execute("SELECT * FROM rubrics WHERE id=?", (rubric_id,)).fetchone(),
            "Rubric",
        )
        now = now_iso()
        version_number = int(row["current_version"]) + (1 if criteria is not None else 0)
        connection.execute(
            "UPDATE rubrics SET name=?,description=?,current_version=?,updated_at=? WHERE id=?",
            (
                payload.name if payload.name is not None else row["name"],
                payload.description if payload.description is not None else row["description"],
                version_number,
                now,
                rubric_id,
            ),
        )
        if criteria is not None:
            connection.execute(
                "INSERT INTO rubric_versions (rubric_id,version,criteria_json,created_at) VALUES (?,?,?,?)",
                (rubric_id, version_number, compact_json(criteria), now),
            )
    return {"id": rubric_id, "version": version_number}


@router.post("/{rubric_id}/publish")
def publish_rubric(
    request: Request,
    rubric_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection(write=True) as connection:
        row = require_found(
            connection.execute("SELECT current_version FROM rubrics WHERE id=?", (rubric_id,)).fetchone(),
            "Rubric",
        )
        rubric_version = require_found(
            connection.execute(
                "SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?",
                (rubric_id, row["current_version"]),
            ).fetchone(),
            "Rubric version",
        )
        criteria = parse_json(rubric_version["criteria_json"], [])
        if not isinstance(criteria, list):
            criteria = []
        _validate_publishable_criteria(criteria)
        linked_cases = connection.execute(
            """
            SELECT c.title,cv.content_json AS contentJson
            FROM cases c
            JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
            WHERE cv.rubric_id=? AND c.status='published'
            """,
            (rubric_id,),
        ).fetchall()
        for linked_case in linked_cases:
            content = parse_json(linked_case["contentJson"], {})
            if not isinstance(content, dict):
                content = {}
            unknown_ids = _unknown_rubric_red_flag_ids(criteria, content)
            if unknown_ids:
                message = (
                    f'This rubric cannot be published for "{linked_case["title"]}" because these '
                    f"red-flag IDs are not in that case: {', '.join(unknown_ids)}"
                )
                raise AppError(
                    409,
                    "RUBRIC_RED_FLAG_MISMATCH",
                    message,
                )
        now = now_iso()
        connection.execute(
            """
            UPDATE rubrics
            SET status='published',published_version=current_version,archived_at=NULL,updated_at=?
            WHERE id=?
            """,
            (now, rubric_id),
        )
        connection.execute(
            """
            UPDATE rubric_versions SET published_at=COALESCE(published_at,?)
            WHERE rubric_id=? AND version=?
            """,
            (now, rubric_id, row["current_version"]),
        )
    return {"id": rubric_id, "status": "published"}


@router.post("/{rubric_id}/archive")
def archive_rubric(
    request: Request,
    rubric_id: Annotated[int, Path(gt=0)],
    _faculty: Annotated[Any, Depends(require_faculty)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection(write=True) as connection:
        linked_case = connection.execute(
            """
            SELECT c.id,c.title
            FROM cases c
            JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
            LEFT JOIN case_rubrics cr ON cr.case_id=c.id
            WHERE COALESCE(cv.rubric_id,cr.rubric_id)=? AND c.status='published' LIMIT 1
            """,
            (rubric_id,),
        ).fetchone()
        if linked_case is not None:
            raise AppError(
                409,
                "RUBRIC_IN_USE",
                f'Archive or relink the published case "{linked_case["title"]}" before archiving this rubric',
            )
        now = now_iso()
        result = connection.execute(
            "UPDATE rubrics SET status='archived',archived_at=?,updated_at=? WHERE id=?",
            (now, now, rubric_id),
        )
        if result.rowcount == 0:
            raise AppError(404, "NOT_FOUND", "Rubric not found")
    return {"id": rubric_id, "status": "archived"}
