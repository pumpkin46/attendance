from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.core.dependencies import CurrentUser
from app.services.upload_storage import resolve_upload_path

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])


@router.get("/visitors/{org_id}/{visitor_id}/{category}/{filename}")
async def serve_visitor_upload(
    org_id: int,
    visitor_id: int,
    category: str,
    filename: str,
    user: CurrentUser,
):
    if category not in ("photos", "documents"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    path = resolve_upload_path(org_id, visitor_id, category, filename)
    media = "application/pdf" if path.suffix.lower() == ".pdf" else "image/jpeg"
    if path.suffix.lower() == ".png":
        media = "image/png"
    elif path.suffix.lower() == ".webp":
        media = "image/webp"
    return FileResponse(path, media_type=media)
