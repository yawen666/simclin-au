from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .ai import AiProvider
from .config import Settings
from .database import Database
from .errors import AppError
from .rate_limit import SlidingWindowRateLimiter
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def client_host(request: Request) -> str:
    """Return the ASGI client address established by the trusted server layer."""

    # Uvicorn may replace scope['client'] from forwarding headers, but only
    # when the immediate peer matches --forwarded-allow-ips. Keeping this here
    # ensures application code never parses an untrusted header itself.
    return request.client.host if request.client is not None else "unknown"


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_provider(request: Request) -> AiProvider:
    return request.app.state.ai


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "UNAUTHENTICATED", "A valid demo access token is required")
    claims = decode_token(credentials.credentials, request.app.state.settings.jwt_secret)
    try:
        claims["sub"] = int(claims["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AppError(401, "UNAUTHENTICATED", "A valid demo access token is required") from exc
    if claims.get("role") not in {"student", "faculty"}:
        raise AppError(401, "UNAUTHENTICATED", "A valid demo access token is required")
    with request.app.state.db.connection() as connection:
        user = connection.execute(
            "SELECT id,username,display_name,role FROM users WHERE id=?",
            (claims["sub"],),
        ).fetchone()
    if user is None or user["role"] != claims.get("role") or user["username"] != claims.get("username"):
        raise AppError(401, "UNAUTHENTICATED", "A valid demo access token is required")
    claims["displayName"] = user["display_name"]
    return claims


def require_student(user: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    if user.get("role") != "student":
        raise AppError(403, "FORBIDDEN", "Student access is required")
    return user


def require_faculty(user: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    if user.get("role") != "faculty":
        raise AppError(403, "FORBIDDEN", "Faculty access is required")
    return user


def enforce_ai_rate_limit(request: Request, user: dict[str, Any]) -> None:
    limiter = getattr(request.app.state, "rate_limiter", None)
    if not isinstance(limiter, SlidingWindowRateLimiter):
        raise RuntimeError("AI rate limiter is not initialised")
    settings = request.app.state.settings
    retry_after = limiter.consume_many(
        (
            (f"ai-user:{user.get('sub')}", settings.ai_requests_per_hour),
            (f"ai-ip:{client_host(request)}", settings.ai_requests_per_ip_per_hour),
            ("ai-global", settings.ai_global_requests_per_hour),
        )
    )
    if retry_after:
        raise AppError(
            429,
            "AI_RATE_LIMITED",
            "This preview has reached its hourly AI request limit. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )
