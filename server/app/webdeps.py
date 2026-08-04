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
    client_host = request.client.host if request.client is not None else "unknown"
    key = f"ai:{client_host}:{user.get('sub')}"
    retry_after = limiter.consume(key, request.app.state.settings.ai_requests_per_hour)
    if retry_after:
        raise AppError(
            429,
            "AI_RATE_LIMITED",
            "This preview has reached its hourly AI request limit. Please try again later.",
            {"retryAfterSeconds": retry_after},
        )
