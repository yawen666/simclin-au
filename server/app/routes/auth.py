from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..errors import AppError, require_found
from ..identities import synthetic_student_name
from ..rate_limit import SlidingWindowRateLimiter
from ..security import create_token
from ..webdeps import client_host, current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DemoLoginBody(BaseModel):
    role: Literal["student", "faculty"]
    accessCode: str | None = Field(default=None, max_length=256)
    visitorId: str | None = Field(default=None, min_length=12, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


def _limiter(request: Request) -> SlidingWindowRateLimiter:
    limiter = getattr(request.app.state, "rate_limiter", None)
    if not isinstance(limiter, SlidingWindowRateLimiter):
        raise RuntimeError("Application rate limiter is not initialised")
    return limiter


def _enforce_auth_request_limit(request: Request) -> None:
    settings = request.app.state.settings
    retry_after = _limiter(request).consume_many(
        (
            (f"auth-request-ip:{client_host(request)}", settings.auth_requests_per_ip_per_hour),
            ("auth-request-global", settings.auth_global_requests_per_hour),
        )
    )
    if retry_after:
        raise AppError(
            429,
            "AUTH_REQUEST_RATE_LIMITED",
            "This preview has reached its hourly sign-in request limit. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )


def _enforce_profile_creation_limit(request: Request) -> None:
    settings = request.app.state.settings
    retry_after = _limiter(request).consume_many(
        (
            (
                f"anonymous-profile-ip:{client_host(request)}",
                settings.anonymous_profiles_per_ip_per_hour,
            ),
            ("anonymous-profile-global", settings.anonymous_profiles_global_per_hour),
        )
    )
    if retry_after:
        raise AppError(
            429,
            "ANONYMOUS_PROFILE_RATE_LIMITED",
            "Too many new student profiles have been created. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )


@router.post("/demo")
def demo_login(body: DemoLoginBody, request: Request) -> dict[str, Any]:
    # This gate deliberately runs before any SQLite write transaction. It
    # protects the single-process preview from request floods even when every
    # visitor ID is unique.
    _enforce_auth_request_limit(request)
    expected_code = request.app.state.settings.faculty_demo_access_code
    supplied_code = body.accessCode or ""
    if body.role == "faculty" and expected_code and not hmac.compare_digest(supplied_code, expected_code):
        limiter = request.app.state.faculty_auth_limiter
        retry_after = limiter.consume(f"faculty-auth:{client_host(request)}", 10)
        if retry_after:
            raise AppError(
                429,
                "FACULTY_AUTH_RATE_LIMITED",
                "Too many faculty access attempts. Please try again later.",
                {"retryAfterSeconds": retry_after},
            )
        raise AppError(403, "FACULTY_ACCESS_REQUIRED", "Enter the faculty access code for this hosted preview")
    if body.role == "student":
        visitor_id = body.visitorId or secrets.token_urlsafe(24)
        visitor_digest = hashlib.sha256(visitor_id.encode("utf-8")).hexdigest()[:40]
        username = f"demo_student_{visitor_digest}"
        display_name = synthetic_student_name(visitor_digest)
        settings = request.app.state.settings
        with request.app.state.db.connection() as connection:
            row = connection.execute(
                """SELECT id,username,display_name AS displayName,role
                FROM users WHERE username=?""",
                (username,),
            ).fetchone()
            if row is None:
                anonymous_profile_count = int(
                    connection.execute(
                        "SELECT COUNT(*) AS count FROM users WHERE username GLOB 'demo_student_*'"
                    ).fetchone()["count"]
                )
        if row is None:
            if anonymous_profile_count >= settings.max_anonymous_student_profiles:
                raise AppError(
                    503,
                    "ANONYMOUS_PROFILE_CAPACITY_REACHED",
                    "Student preview access is temporarily unavailable. Please try again later.",
                )
            # Creation quotas are also checked before reserving SQLite's writer
            # lock. The transaction rechecks existence and capacity only to
            # close the small concurrent-request race.
            _enforce_profile_creation_limit(request)
            with request.app.state.db.connection(write=True) as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """SELECT id,username,display_name AS displayName,role
                    FROM users WHERE username=?""",
                    (username,),
                ).fetchone()
                if row is None:
                    anonymous_profile_count = int(
                        connection.execute(
                            "SELECT COUNT(*) AS count FROM users WHERE username GLOB 'demo_student_*'"
                        ).fetchone()["count"]
                    )
                    if anonymous_profile_count >= settings.max_anonymous_student_profiles:
                        raise AppError(
                            503,
                            "ANONYMOUS_PROFILE_CAPACITY_REACHED",
                            "Student preview access is temporarily unavailable. Please try again later.",
                        )
                    connection.execute(
                        """INSERT INTO users (username,display_name,role,created_at)
                        VALUES (?,?,'student',datetime('now'))""",
                        (username, display_name),
                    )
                    row = connection.execute(
                        """SELECT id,username,display_name AS displayName,role
                        FROM users WHERE username=?""",
                        (username,),
                    ).fetchone()
    else:
        with request.app.state.db.connection() as connection:
            row = connection.execute(
                """SELECT id,username,display_name AS displayName,role
                FROM users WHERE role='faculty' ORDER BY id LIMIT 1"""
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
