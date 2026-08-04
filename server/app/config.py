from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

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
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"
    ai_provider: str = "deepseek"
    web_origin: str = "http://localhost:5173"
    log_level: str = "info"
    ai_requests_per_hour: int = 60

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip() for value in self.web_origin.split(",") if value.strip()]


def _resolved_database_path(value: str) -> str:
    if value == ":memory:":
        return value
    path = Path(value)
    return str(path if path.is_absolute() else (SERVER_ROOT / path).resolve())


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
    }
    if overrides:
        values.update(overrides)
    settings = replace(Settings(), **values)
    if settings.environment not in {"development", "test", "production"}:
        raise RuntimeError("ENVIRONMENT (or legacy NODE_ENV) must be development, test or production")
    if settings.ai_provider not in {"deepseek", "mock"}:
        raise RuntimeError("AI_PROVIDER must be deepseek or mock")
    if settings.ai_requests_per_hour < 1:
        raise RuntimeError("AI_REQUESTS_PER_HOUR must be a positive integer")
    if settings.environment == "production" and settings.jwt_secret == "local-development-secret-change-me":
        raise RuntimeError("JWT_SECRET must be set to a unique secret in production")
    if settings.environment == "production" and any("localhost" in origin for origin in settings.allowed_origins):
        raise RuntimeError("WEB_ORIGIN must be set to the deployed frontend origin in production")
    if settings.environment == "production" and len(settings.faculty_demo_access_code) < 12:
        raise RuntimeError("FACULTY_DEMO_ACCESS_CODE must contain at least 12 characters in production")
    if settings.environment == "production" and settings.ai_provider == "deepseek" and not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY must be configured when AI_PROVIDER=deepseek in production")
    return settings
