from __future__ import annotations

import hmac
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..errors import AppError, require_found
from ..security import create_token
from ..webdeps import current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DemoLoginBody(BaseModel):
    role: Literal["student", "faculty"]
    accessCode: str | None = Field(default=None, max_length=256)


@router.post("/demo")
def demo_login(body: DemoLoginBody, request: Request) -> dict[str, Any]:
    expected_code = request.app.state.settings.faculty_demo_access_code
    supplied_code = body.accessCode or ""
    if body.role == "faculty" and expected_code and not hmac.compare_digest(supplied_code, expected_code):
        raise AppError(403, "FACULTY_ACCESS_REQUIRED", "Enter the faculty access code for this hosted preview")
    with request.app.state.db.connection() as connection:
        row = connection.execute(
            """
            SELECT id,username,display_name AS displayName,role
            FROM users WHERE role=?
            """,
            (body.role,),
        ).fetchone()
    user = dict(require_found(row, "Demo user"))
    token = create_token(
        {
            "sub": user["id"],
            "username": user["username"],
            "displayName": user["displayName"],
            "role": user["role"],
        },
        request.app.state.settings.jwt_secret,
    )
    return {"token": token, "user": {**user, "name": user["displayName"]}}


@router.get("/me")
def me(
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    return {
        "user": {
            "id": user["sub"],
            "username": user["username"],
            "displayName": user["displayName"],
            "role": user["role"],
        }
    }
