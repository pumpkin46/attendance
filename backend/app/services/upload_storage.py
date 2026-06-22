from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_DOC_EXT = ALLOWED_IMAGE_EXT | {".pdf"}
# Chat attachments accept images plus common, non-executable document/archive
# types. Deliberately excludes scripts/binaries (.exe/.sh/.js/...) — files are
# only stored and downloaded, never executed, but the allowlist keeps obviously
# dangerous payloads out of the shared upload root.
ALLOWED_AUDIO_EXT = {".webm", ".ogg", ".oga", ".mp3", ".m4a", ".wav"}
ALLOWED_CHAT_EXT = ALLOWED_IMAGE_EXT | ALLOWED_AUDIO_EXT | {
    ".pdf", ".txt", ".csv", ".md", ".rtf",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _upload_root() -> Path:
    root = Path(settings.upload_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_filename(name: str) -> str:
    base = Path(name).name
    return re.sub(r"[^a-zA-Z0-9._-]", "_", base)[:128]


def _ext_from_content_type(content_type: str | None) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
    }
    return mapping.get(content_type or "", ".bin")


def save_visitor_upload(
    org_id: int,
    visitor_id: int,
    category: str,
    file: UploadFile,
    *,
    allowed_ext: set[str] | None = None,
) -> tuple[str, str]:
    """Save uploaded file; returns (absolute_path, public_url)."""
    allowed = allowed_ext or ALLOWED_IMAGE_EXT
    ext = Path(_safe_filename(file.filename or "")).suffix.lower()
    if not ext:
        ext = _ext_from_content_type(file.content_type)
    if ext not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File type not allowed. Accepted: {', '.join(sorted(allowed))}",
        )

    dest_dir = _upload_root() / "visitors" / str(org_id) / str(visitor_id) / category
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / filename

    size = 0
    with dest_path.open("wb") as out:
        while chunk := file.file.read(1024 * 64):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                dest_path.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large (max 10MB)")
            out.write(chunk)

    public_url = f"/api/v1/uploads/visitors/{org_id}/{visitor_id}/{category}/{filename}"
    return str(dest_path), public_url


def save_visitor_base64(
    org_id: int,
    visitor_id: int,
    category: str,
    data_url: str,
    *,
    allowed_ext: set[str] | None = None,
) -> tuple[str, str]:
    allowed = allowed_ext or ALLOWED_IMAGE_EXT
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
        ext = ".jpg"
        if "png" in header:
            ext = ".png"
        elif "webp" in header:
            ext = ".webp"
        elif "pdf" in header:
            ext = ".pdf"
    else:
        b64 = data_url
        ext = ".jpg"

    if ext not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"File type not allowed: {ext}")

    raw = base64.b64decode(b64)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large (max 10MB)")

    dest_dir = _upload_root() / "visitors" / str(org_id) / str(visitor_id) / category
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / filename
    dest_path.write_bytes(raw)
    public_url = f"/api/v1/uploads/visitors/{org_id}/{visitor_id}/{category}/{filename}"
    return str(dest_path), public_url


def delete_visitor_file(public_url: str) -> None:
    """Best-effort removal of a stored upload given its public URL.

    Silently ignores URLs that don't point inside the upload root (external
    URLs, already-deleted files) so DB cleanup never fails on disk state.
    """
    prefix = "/api/v1/uploads/"
    if not public_url or not public_url.startswith(prefix):
        return
    root = _upload_root().resolve()
    path = (_upload_root() / public_url[len(prefix):]).resolve()
    if not str(path).startswith(str(root)):
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def resolve_upload_path(org_id: int, visitor_id: int, category: str, filename: str) -> Path:
    safe = _safe_filename(filename)
    path = _upload_root() / "visitors" / str(org_id) / str(visitor_id) / category / safe
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    resolved = path.resolve()
    if not str(resolved).startswith(str(_upload_root().resolve())):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid path")
    return resolved


# ── Chat attachments ──────────────────────────────────────────────────────────
def _guess_content_type(ext: str, declared: str | None) -> str:
    mapping = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
        ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown",
        ".zip": "application/zip",
        ".webm": "audio/webm", ".ogg": "audio/ogg", ".oga": "audio/ogg",
        ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
    }
    return mapping.get(ext, declared or "application/octet-stream")


def save_chat_upload(
    org_id: int,
    conversation_id: int,
    file: UploadFile,
) -> tuple[str, str, str, int, str]:
    """Save a chat attachment.

    Returns ``(absolute_path, public_url, content_type, size_bytes, kind)`` where
    ``kind`` is ``"image"`` (inline-renderable), ``"audio"`` (voice message), or
    ``"file"`` otherwise.
    """
    ext = Path(_safe_filename(file.filename or "")).suffix.lower()
    if not ext:
        ext = _ext_from_content_type(file.content_type)
    if ext not in ALLOWED_CHAT_EXT:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File type not allowed: {ext or 'unknown'}",
        )

    dest_dir = _upload_root() / "chat" / str(org_id) / str(conversation_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / filename

    size = 0
    with dest_path.open("wb") as out:
        while chunk := file.file.read(1024 * 64):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                dest_path.unlink(missing_ok=True)
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large (max 10MB)"
                )
            out.write(chunk)

    content_type = _guess_content_type(ext, file.content_type)
    if ext in ALLOWED_IMAGE_EXT:
        kind = "image"
    elif ext in ALLOWED_AUDIO_EXT:
        kind = "audio"
    else:
        kind = "file"
    public_url = f"/api/v1/chat/attachments/{org_id}/{conversation_id}/{filename}"
    return str(dest_path), public_url, content_type, size, kind


def delete_chat_file(public_url: str) -> None:
    """Best-effort removal of a stored chat attachment given its public URL.

    Mirrors :func:`delete_visitor_file` for the chat upload prefix; ignores URLs
    that don't resolve inside the upload root so DB cleanup never fails on disk
    state.
    """
    prefix = "/api/v1/chat/attachments/"
    if not public_url or not public_url.startswith(prefix):
        return
    root = _upload_root().resolve()
    # Map the public URL back onto data/uploads/chat/<rest>.
    rel = public_url[len("/api/v1/chat/attachments/"):]
    path = (_upload_root() / "chat" / rel).resolve()
    if not str(path).startswith(str(root)):
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def resolve_chat_upload_path(org_id: int, conversation_id: int, filename: str) -> Path:
    safe = _safe_filename(filename)
    path = _upload_root() / "chat" / str(org_id) / str(conversation_id) / safe
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    resolved = path.resolve()
    if not str(resolved).startswith(str(_upload_root().resolve())):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid path")
    return resolved
