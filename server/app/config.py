from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

SERVER_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(SERVER_ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = 4100
    database_path: str = str(SERVER_ROOT / "data" / "simclin-au.db")
    jwt_secret: str = "local-development-secret-change-me"
    faculty_demo_access_code: str = ""
    faculty_demo_open_access: bool = False
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"
    ai_provider: str = "deepseek"
    web_origin: str = "http://localhost:5173"
    log_level: str = "info"
    ai_requests_per_hour: int = 60
    ai_requests_per_ip_per_hour: int = 180
    ai_global_requests_per_hour: int = 360
    auth_requests_per_ip_per_hour: int = 120
    auth_global_requests_per_hour: int = 1200
    anonymous_profiles_per_ip_per_hour: int = 20
    anonymous_profiles_global_per_hour: int = 200
    max_anonymous_student_profiles: int = 5000
    session_requests_per_user_per_hour: int = 60
    session_requests_per_ip_per_hour: int = 240
    session_global_requests_per_hour: int = 1000
    session_starts_per_user_per_hour: int = 30
    session_starts_per_ip_per_hour: int = 120
    session_starts_global_per_hour: int = 500
    max_sessions_per_student: int = 100
    max_total_sessions: int = 50000
    build_id: str = "development"

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip() for value in self.web_origin.split(",") if value.strip()]


def _resolved_database_path(value: str) -> str:
    if value == ":memory:":
        return value
    path = Path(value)
    return str(path if path.is_absolute() else (SERVER_ROOT / path).resolve())


def _environment_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalised = value.strip().lower()
    if normalised in {"1", "true", "yes", "on"}:
        return True
    if normalised in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be true or false")


def load_settings(overrides: Mapping[str, Any] | None = None) -> Settings:
    values: dict[str, Any] = {
        # ENVIRONMENT is canonical after the Python migration. NODE_ENV is a
        # legacy fallback so old local files do not stop working.
        "environment": os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")),
        "host": os.getenv("HOST", "127.0.0.1"),
        "port": int(os.getenv("PORT", "4100")),
        "database_path": _resolved_database_path(os.getenv("DATABASE_PATH", "./data/simclin-au.db")),
        "jwt_secret": os.getenv("JWT_SECRET", "local-development-secret-change-me"),
        "faculty_demo_access_code": os.getenv("FACULTY_DEMO_ACCESS_CODE", ""),
        "deepseek_api_key": os.getenv("DEEPSEEK_API_KEY", ""),
        "deepseek_base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
        "deepseek_model": os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro"),
        "ai_provider": os.getenv("AI_PROVIDER", "deepseek"),
        "web_origin": os.getenv("WEB_ORIGIN", "http://localhost:5173"),
        "log_level": os.getenv("LOG_LEVEL", "info"),
        "ai_requests_per_hour": int(os.getenv("AI_REQUESTS_PER_HOUR", "60")),
        "ai_requests_per_ip_per_hour": int(os.getenv("AI_REQUESTS_PER_IP_PER_HOUR", "180")),
        "ai_global_requests_per_hour": int(os.getenv("AI_GLOBAL_REQUESTS_PER_HOUR", "360")),
        "auth_requests_per_ip_per_hour": int(os.getenv("AUTH_REQUESTS_PER_IP_PER_HOUR", "120")),
        "auth_global_requests_per_hour": int(os.getenv("AUTH_GLOBAL_REQUESTS_PER_HOUR", "1200")),
        "anonymous_profiles_per_ip_per_hour": int(os.getenv("ANONYMOUS_PROFILES_PER_IP_PER_HOUR", "20")),
        "anonymous_profiles_global_per_hour": int(os.getenv("ANONYMOUS_PROFILES_GLOBAL_PER_HOUR", "200")),
        "max_anonymous_student_profiles": int(os.getenv("MAX_ANONYMOUS_STUDENT_PROFILES", "5000")),
        "session_requests_per_user_per_hour": int(os.getenv("SESSION_REQUESTS_PER_USER_PER_HOUR", "60")),
        "session_requests_per_ip_per_hour": int(os.getenv("SESSION_REQUESTS_PER_IP_PER_HOUR", "240")),
        "session_global_requests_per_hour": int(os.getenv("SESSION_GLOBAL_REQUESTS_PER_HOUR", "1000")),
        "session_starts_per_user_per_hour": int(os.getenv("SESSION_STARTS_PER_USER_PER_HOUR", "30")),
        "session_starts_per_ip_per_hour": int(os.getenv("SESSION_STARTS_PER_IP_PER_HOUR", "120")),
        "session_starts_global_per_hour": int(os.getenv("SESSION_STARTS_GLOBAL_PER_HOUR", "500")),
        "max_sessions_per_student": int(os.getenv("MAX_SESSIONS_PER_STUDENT", "100")),
        "max_total_sessions": int(os.getenv("MAX_TOTAL_SESSIONS", "50000")),
        "build_id": os.getenv("RENDER_GIT_COMMIT", os.getenv("GIT_COMMIT_SHA", "development")),
    }
    if overrides:
        values.update(overrides)
    if not overrides or "faculty_demo_open_access" not in overrides:
        values["faculty_demo_open_access"] = _environment_bool(
            "FACULTY_DEMO_OPEN_ACCESS", default=values["environment"] != "test"
        )
    settings = replace(Settings(), **values)
    if settings.environment not in {"development", "test", "production"}:
        raise RuntimeError("ENVIRONMENT (or legacy NODE_ENV) must be development, test or production")
    if settings.ai_provider not in {"deepseek", "mock"}:
        raise RuntimeError("AI_PROVIDER must be deepseek or mock")
    if (
        min(
            settings.ai_requests_per_hour,
            settings.ai_requests_per_ip_per_hour,
            settings.ai_global_requests_per_hour,
        )
        < 1
    ):
        raise RuntimeError("AI request budgets must be positive integers")
    if settings.ai_requests_per_ip_per_hour < settings.ai_requests_per_hour:
        raise RuntimeError("AI_REQUESTS_PER_IP_PER_HOUR must be at least AI_REQUESTS_PER_HOUR")
    if min(settings.auth_requests_per_ip_per_hour, settings.auth_global_requests_per_hour) < 1:
        raise RuntimeError("Auth request budgets must be positive integers")
    if settings.auth_global_requests_per_hour < settings.auth_requests_per_ip_per_hour:
        raise RuntimeError("AUTH_GLOBAL_REQUESTS_PER_HOUR must be at least AUTH_REQUESTS_PER_IP_PER_HOUR")
    if (
        min(
            settings.anonymous_profiles_per_ip_per_hour,
            settings.anonymous_profiles_global_per_hour,
            settings.max_anonymous_student_profiles,
        )
        < 1
    ):
        raise RuntimeError("Anonymous profile budgets and capacity must be positive integers")
    if settings.anonymous_profiles_global_per_hour < settings.anonymous_profiles_per_ip_per_hour:
        raise RuntimeError("ANONYMOUS_PROFILES_GLOBAL_PER_HOUR must be at least ANONYMOUS_PROFILES_PER_IP_PER_HOUR")
    if (
        settings.auth_requests_per_ip_per_hour < settings.anonymous_profiles_per_ip_per_hour
        or settings.auth_global_requests_per_hour < settings.anonymous_profiles_global_per_hour
    ):
        raise RuntimeError("Auth request budgets must be at least the corresponding anonymous profile budgets")
    if (
        min(
            settings.session_requests_per_user_per_hour,
            settings.session_requests_per_ip_per_hour,
            settings.session_global_requests_per_hour,
        )
        < 1
    ):
        raise RuntimeError("Session request budgets must be positive integers")
    if not (
        settings.session_global_requests_per_hour
        >= settings.session_requests_per_ip_per_hour
        >= settings.session_requests_per_user_per_hour
    ):
        raise RuntimeError(
            "Session request budgets must satisfy SESSION_GLOBAL_REQUESTS_PER_HOUR >= "
            "SESSION_REQUESTS_PER_IP_PER_HOUR >= SESSION_REQUESTS_PER_USER_PER_HOUR"
        )
    if (
        min(
            settings.session_starts_per_user_per_hour,
            settings.session_starts_per_ip_per_hour,
            settings.session_starts_global_per_hour,
            settings.max_sessions_per_student,
            settings.max_total_sessions,
        )
        < 1
    ):
        raise RuntimeError("Session start budgets and capacity must be positive integers")
    if not (
        settings.session_starts_global_per_hour
        >= settings.session_starts_per_ip_per_hour
        >= settings.session_starts_per_user_per_hour
    ):
        raise RuntimeError(
            "Session start budgets must satisfy SESSION_STARTS_GLOBAL_PER_HOUR >= "
            "SESSION_STARTS_PER_IP_PER_HOUR >= SESSION_STARTS_PER_USER_PER_HOUR"
        )
    if (
        settings.session_requests_per_user_per_hour < settings.session_starts_per_user_per_hour
        or settings.session_requests_per_ip_per_hour < settings.session_starts_per_ip_per_hour
        or settings.session_global_requests_per_hour < settings.session_starts_global_per_hour
    ):
        raise RuntimeError("Session request budgets must be at least the corresponding session start budgets")
    if settings.max_total_sessions < settings.max_sessions_per_student:
        raise RuntimeError("MAX_TOTAL_SESSIONS must be at least MAX_SESSIONS_PER_STUDENT")
    if settings.environment == "production" and (
        len(settings.jwt_secret) < 32
        or settings.jwt_secret in {"local-development-secret-change-me", "secret", "changeme"}
    ):
        raise RuntimeError("JWT_SECRET must be a unique value containing at least 32 characters in production")
    if settings.environment == "production" and any("localhost" in origin for origin in settings.allowed_origins):
        raise RuntimeError("WEB_ORIGIN must be set to the deployed frontend origin in production")
    if (
        settings.environment == "production"
        and not settings.faculty_demo_open_access
        and len(settings.faculty_demo_access_code) < 12
    ):
        raise RuntimeError("FACULTY_DEMO_ACCESS_CODE must contain at least 12 characters in production")
    if settings.environment == "production" and settings.ai_provider == "deepseek" and not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY must be configured when AI_PROVIDER=deepseek in production")
    if settings.environment == "production" and settings.ai_provider != "deepseek":
        raise RuntimeError("AI_PROVIDER must be deepseek in production")
    if settings.environment == "production":
        provider_url = urlparse(settings.deepseek_base_url)
        if provider_url.scheme != "https" or not provider_url.netloc:
            raise RuntimeError("DEEPSEEK_BASE_URL must be an HTTPS URL in production")
    return settings
