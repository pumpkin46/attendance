"""Standardized application errors and global exception handlers.

Every error response uses a single envelope::

    {"error": {"code": "not_found", "message": "Shift not found", "details": {}}}

Service-layer code raises the typed :class:`AppError` subclasses below; route
handlers do not build ``HTTPException`` by hand. Legacy ``HTTPException`` usages
are still supported and are translated into the same envelope by the global
handler, so the wire format is consistent regardless of how the error was raised.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Base class for expected, client-facing application errors.

    Raise these from the service layer. The global handler turns them into the
    standard error envelope with the right HTTP status code.
    """

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class PermissionDeniedError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


# Maps a bare HTTP status code to a stable, machine-readable error code so that
# legacy ``HTTPException(404, ...)`` calls produce the same ``code`` as the typed
# errors above.
_STATUS_CODE_NAMES: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "internal_error",
}


def _envelope(code: str, message: str, details: Any | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


logger = logging.getLogger("app.errors")


def register_exception_handlers(app: FastAPI) -> None:
    """Install global handlers so all error responses share one envelope."""

    @app.exception_handler(AppError)
    async def _handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        # ``detail`` may already be a dict (e.g. structured error) or a plain string.
        if isinstance(detail, dict) and "error" in detail:
            content = detail
        else:
            code = _STATUS_CODE_NAMES.get(exc.status_code, "error")
            message = detail if isinstance(detail, str) else "Request failed"
            content = _envelope(code, message, None if isinstance(detail, str) else detail)
        return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope("validation_error", "Validation failed", jsonable_encoder(exc.errors())),
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Unhandled errors: log the full traceback server-side, return a clean,
        # non-leaky envelope so clients always get a parseable error body.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("internal_error", "An unexpected error occurred."),
        )
