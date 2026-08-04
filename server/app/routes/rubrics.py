from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..database import Database
from ..errors import AppError, require_found
from ..utils import compact_json, now_iso, parse_json
from ..webdeps import current_user, require_faculty
from .cases import _unknown_rubric_red_flag_ids

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


def _role(user: Any) -> str | None:
    if isinstance(user, dict):
        return user.get("role")
    return getattr(user, "role", None)


def _validate_weights(criteria: list[dict[str, Any]]) -> None:
    total = sum(float(item["weight"]) for item in criteria)
    if abs(total - 100) > 0.001:
        raise AppError(
            400,
            "INVALID_RUBRIC_WEIGHT",
            "Rubric criterion weights must total 100",
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
    user: Annotated[Any, Depends(current_user)],
) -> dict[str, Any]:
    db = _database(request)
    where = "" if _role(user) == "faculty" else "WHERE status='published'"
    rubrics: list[dict[str, Any]] = []
    with db.connection() as connection:
        rows = connection.execute(f"SELECT * FROM rubrics {where} ORDER BY id").fetchall()
        for row in rows:
            selected_version = row["current_version"] if _role(user) == "faculty" else row["published_version"]
            version = connection.execute(
                "SELECT criteria_json FROM rubric_versions WHERE rubric_id=? AND version=?",
                (row["id"], selected_version),
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
    user: Annotated[Any, Depends(current_user)],
) -> dict[str, Any]:
    db = _database(request)
    with db.connection() as connection:
        row = require_found(
            connection.execute("SELECT * FROM rubrics WHERE id=?", (rubric_id,)).fetchone(),
            "Rubric",
        )
        if _role(user) != "faculty" and row["status"] != "published":
            raise AppError(404, "NOT_FOUND", "Rubric not found")
        selected_version = row["current_version"] if _role(user) == "faculty" else row["published_version"]
        version = require_found(
            connection.execute(
                "SELECT * FROM rubric_versions WHERE rubric_id=? AND version=?",
                (rubric_id, selected_version),
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
        linked_cases = connection.execute(
            """
            SELECT c.title,cv.content_json AS contentJson
            FROM case_rubrics cr
            JOIN cases c ON c.id=cr.case_id
            JOIN case_versions cv ON cv.case_id=c.id AND cv.version=c.published_version
            WHERE cr.rubric_id=? AND c.status='published'
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
