from __future__ import annotations

import inspect
import logging
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .ai import AiProvider, DeepSeekProvider, MockAiProvider
from .config import Settings, load_settings
from .database import SCHEMA_VERSION, Database
from .errors import AppError
from .rate_limit import SlidingWindowRateLimiter
from .routes.auth import router as auth_router
from .routes.cases import router as cases_router
from .routes.history import router as history_router
from .routes.insights import router as insights_router
from .routes.results import router as results_router
from .routes.rubrics import router as rubrics_router
from .routes.sessions import router as sessions_router
from .routes.uploads import router as uploads_router
from .sessions import EvaluationCoordinator
from .utils import now_iso

logger = logging.getLogger("simclin")
DEFAULT_BODY_LIMIT = 1024 * 1024
UPLOAD_BODY_LIMIT = 6 * 1024 * 1024


def _error_payload(code: str, message: str, details: Any = None, *, include_details: bool = True) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if include_details and details is not None:
        error["details"] = details
    return {"code": code, "message": message, "error": error}


def create_app(
    *,
    settings: Settings | None = None,
    database: Database | None = None,
    ai_provider: AiProvider | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()
    owned_database = database is None
    db = database or Database(resolved_settings.database_path)
    provider = ai_provider or (
        MockAiProvider() if resolved_settings.ai_provider == "mock" else DeepSeekProvider(resolved_settings)
    )
    upload_dir = Path(resolved_settings.database_path).parent / "uploads"

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        db.initialise()
        coordinator = getattr(application.state, "evaluations", None)
        if coordinator is not None:
            await coordinator.start()
        try:
            yield
        finally:
            if coordinator is not None:
                await coordinator.stop()
            close_provider = getattr(provider, "aclose", None)
            if close_provider is not None:
                result = close_provider()
                if inspect.isawaitable(result):
                    await result
            if owned_database:
                db.close()

    application = FastAPI(
        title="SimClin AU API",
        version="1.0.0",
        docs_url="/api/docs" if resolved_settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if resolved_settings.environment != "production" else None,
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.db = db
    application.state.ai = provider
    application.state.upload_dir = str(upload_dir)
    application.state.rate_limiter = SlidingWindowRateLimiter()
    application.state.faculty_auth_limiter = SlidingWindowRateLimiter(window_seconds=15 * 60)
    application.state.evaluations = EvaluationCoordinator(db, provider, resolved_settings)

    @application.middleware("http")
    async def enforce_body_limit(request: Request, call_next):
        limit = UPLOAD_BODY_LIMIT if request.url.path.startswith("/api/uploads") else DEFAULT_BODY_LIMIT
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                body_size = int(content_length)
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=_error_payload("INVALID_CONTENT_LENGTH", "Content-Length must be an integer"),
                )
            if body_size > limit:
                return JSONResponse(
                    status_code=413,
                    content=_error_payload("PAYLOAD_TOO_LARGE", "Request body is too large"),
                )

        # Content-Length is optional (for example with chunked transfer
        # encoding), so enforce the same ceiling while consuming the ASGI body.
        chunks: list[bytes] = []
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > limit:
                return JSONResponse(
                    status_code=413,
                    content=_error_payload("PAYLOAD_TOO_LARGE", "Request body is too large"),
                )
            chunks.append(chunk)
        request._body = b"".join(chunks)  # noqa: SLF001 - Starlette replay buffer for downstream parsers.
        return await call_next(request)

    @application.middleware("http")
    async def secure_api_responses(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    # Register CORS last so it wraps early body-limit and security responses as
    # well as ordinary route handlers.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for issue in exc.errors():
            details.append(
                {
                    "code": issue.get("type"),
                    "path": list(issue.get("loc", ())),
                    "message": issue.get("msg"),
                }
            )
        return JSONResponse(
            status_code=400,
            content=_error_payload("VALIDATION_ERROR", "Request validation failed", details),
        )

    @application.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("Application error: %s (%s)", exc.code, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(
                exc.code,
                exc.message,
                exc.details,
                include_details=exc.status_code < 500,
            ),
        )

    @application.exception_handler(sqlite3.IntegrityError)
    async def sqlite_conflict(_request: Request, _exc: sqlite3.IntegrityError) -> JSONResponse:
        message = "A record with these details already exists or is in use"
        return JSONResponse(status_code=409, content=_error_payload("CONFLICT", message))

    @application.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return JSONResponse(
                status_code=404,
                content=_error_payload("ROUTE_NOT_FOUND", "The requested API route does not exist"),
            )
        message = str(exc.detail) if exc.detail else "Request failed"
        return JSONResponse(status_code=exc.status_code, content=_error_payload("HTTP_ERROR", message))

    @application.exception_handler(Exception)
    async def unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled request error", exc_info=exc)
        message = "An unexpected server error occurred"
        return JSONResponse(status_code=500, content=_error_payload("INTERNAL_ERROR", message, include_details=False))

    @application.get("/api/health")
    def health() -> dict[str, Any]:
        with db.connection() as connection:
            ok = connection.execute("SELECT 1 AS ok").fetchone()["ok"] == 1
        return {
            "status": "ok" if ok else "degraded",
            "service": "simclin-au-api",
            "version": application.version,
            "runtime": "python",
            "schemaVersion": SCHEMA_VERSION,
            "buildId": resolved_settings.build_id[:12],
            "database": "ok",
            "aiConfigured": bool(resolved_settings.deepseek_api_key),
            "aiProvider": resolved_settings.ai_provider,
            "aiModel": resolved_settings.deepseek_model,
            "facultyAccessProtected": bool(resolved_settings.faculty_demo_access_code)
            and not resolved_settings.faculty_demo_open_access,
            "facultyAccessMode": "open-demo"
            if resolved_settings.faculty_demo_open_access or not resolved_settings.faculty_demo_access_code
            else "protected",
            "timestamp": now_iso(),
        }

    application.include_router(auth_router)
    application.include_router(cases_router)
    application.include_router(rubrics_router)
    application.include_router(sessions_router)
    application.include_router(results_router)
    application.include_router(history_router)
    application.include_router(insights_router)
    application.include_router(uploads_router)
    return application


app = create_app()
