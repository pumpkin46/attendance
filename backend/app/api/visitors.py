from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Query, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_, select, update

from app.core.dependencies import (
    DbSession,
    TenantOrgId,
    TenantScope,
    require_permission,
)
from app.core.errors import NotFoundError, ValidationError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.middleware.tenant import apply_tenant_filter
from app.models.visitor import (
    DocumentType,
    Visitor,
    VisitorBlacklist,
    VisitorDocument,
    VisitorLog,
    VisitorPhoto,
    VisitorStatus,
)
from app.schemas.visitor import (
    AccessPermissionSet,
    ApprovalRequest,
    BlacklistCreate,
    BlacklistOut,
    HostOut,
    PhotoUploadBase64,
    RejectRequest,
    VisitorAccessPermissionOut,
    VisitorCreate,
    VisitorDailyReport,
    VisitorDashboard,
    VisitorDocumentOut,
    VisitorFaceEnrollResult,
    VisitorLogOut,
    VisitorOut,
    VisitorPhotoOut,
    VisitorUpdate,
)
from app.services.upload_storage import (
    ALLOWED_DOC_EXT,
    delete_visitor_file,
    save_visitor_base64,
    save_visitor_upload,
)
from app.services import face_service
from app.services.audit_service import log_action
from app.services import visitor_service
from app.realtime.hub import emit

logger = logging.getLogger(__name__)


async def _emit_visitor_change(visitor) -> None:
    await emit(visitor.organization_id, "visitors.changed", {"visitor_id": visitor.id})

router = APIRouter(prefix="/api/v1", tags=["visitors"])

_expiry_task: asyncio.Task | None = None


def _format_visitor(visitor: Visitor) -> VisitorOut:
    data = VisitorOut.model_validate(visitor, from_attributes=True)
    host = visitor_service.format_host(visitor.host_employee)
    data.host = HostOut(**host) if host else None
    if visitor.id_type:
        data.id_type = visitor.id_type.value
    if visitor.visitor_category:
        data.visitor_category = visitor.visitor_category.value
    if visitor.visit_type:
        data.visit_type = visitor.visit_type.value
    if visitor.approval_status:
        data.approval_status = visitor.approval_status.value
    return data


# ── Admin Visitor Routes ──────────────────────────────────────────────────────


_EMPTY_DASHBOARD = VisitorDashboard(
    on_site=0,
    expected=0,
    checked_in_today=0,
    checked_out_today=0,
    overdue=0,
    pending_approval=0,
)


@router.get("/visitors/dashboard", response_model=VisitorDashboard)
async def visitor_dashboard(
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
):
    if org_id is None:
        return _EMPTY_DASHBOARD
    stats = await visitor_service.get_dashboard_stats(db, org_id)
    return VisitorDashboard(**stats)


@router.get("/visitors/active", response_model=list[VisitorOut])
async def list_active_visitors(
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
):
    if org_id is None:
        return []
    visitors = await visitor_service.get_active_visitors(db, org_id)
    return [_format_visitor(v) for v in visitors]


@router.get("/visitors/reports/daily", response_model=VisitorDailyReport)
async def visitor_daily_report(
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
    report_date: str | None = None,
):
    from datetime import date as date_type

    d = date_type.fromisoformat(report_date) if report_date else date_type.today()
    if org_id is None:
        return VisitorDailyReport(
            date=d.isoformat(),
            total=0,
            checked_in=0,
            checked_out=0,
            pending=0,
            overdue=0,
        )
    report = await visitor_service.get_daily_report(db, org_id, d)
    return VisitorDailyReport(**report)


@router.get("/visitors/pending-approval", response_model=list[VisitorOut])
async def list_pending_approvals(
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
):
    if org_id is None:
        return []
    visitors = await visitor_service.get_pending_approvals(db, org_id)
    return [_format_visitor(v) for v in visitors]


@router.get("/visitors", response_model=PaginatedResponse[VisitorOut])
async def list_visitors(
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
    pagination: PaginationDep,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
):
    stmt = select(Visitor).order_by(Visitor.id.desc())
    stmt = apply_tenant_filter(stmt, org_id, Visitor.organization_id)
    if status_filter:
        try:
            stmt = stmt.where(Visitor.status == VisitorStatus(status_filter))
        except ValueError:
            pass
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            or_(Visitor.name.ilike(like), Visitor.company.ilike(like), Visitor.check_in_code.ilike(like))
        )

    result = await paginate(db, stmt, pagination.page, pagination.per_page, None)
    result.data = [_format_visitor(v) for v in result.data]
    return result


@router.post("/visitors", response_model=VisitorOut, status_code=status.HTTP_201_CREATED)
async def create_visitor(
    body: VisitorCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")
    try:
        visitor = await visitor_service.create_visitor(
            db,
            org_id,
            body.model_dump(exclude_none=True),
            user_id=user.id,
            pre_registered=body.pre_registered,
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e

    await log_action(
        db,
        user_id=user.id,
        action="visitor.created",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(exclude_none=True),
    )
    await _emit_visitor_change(visitor)
    return _format_visitor(visitor)


@router.get("/visitors/{visitor_id}", response_model=VisitorOut)
async def get_visitor(
    visitor_id: int,
    db: DbSession,
    user: require_permission("visitors.view"),
    org_id: TenantScope,
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    return _format_visitor(visitor)


@router.patch("/visitors/{visitor_id}", response_model=VisitorOut)
async def update_visitor(
    visitor_id: int,
    body: VisitorUpdate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    updates = body.model_dump(exclude_none=True)
    if updates.get("host_employee_id") is not None and not await visitor_service.is_org_employee(
        db, updates["host_employee_id"], visitor.organization_id
    ):
        raise ValidationError("Host employee not found in this organization")
    if "first_name" in updates or "last_name" in updates:
        first = updates.get("first_name", visitor.first_name)
        last = updates.get("last_name", visitor.last_name)
        if first and last:
            updates["name"] = f"{first} {last}"
    for key, val in updates.items():
        setattr(visitor, key, val)
    await db.flush()
    await db.refresh(visitor)
    await log_action(
        db,
        user_id=user.id,
        action="visitor.updated",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
        new_values=updates,
    )
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/enroll-face", response_model=VisitorFaceEnrollResult)
async def enroll_visitor_face(
    visitor_id: int,
    request: Request,
    db: DbSession,
    user: require_permission("visitors.manage"),
    org_id: TenantOrgId,
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    body = await request.json()
    image = body.get("image")
    if not image:
        raise ValidationError("Image required")
    method = body.get("method", "admin")
    return await visitor_service.enroll_visitor_face(db, visitor, image, method=method)


@router.post("/visitors/{visitor_id}/check-in", response_model=VisitorOut)
async def check_in_visitor(
    visitor_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    try:
        visitor = await visitor_service.check_in_visitor(
            db, visitor, user_id=user.id, method="reception"
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e
    await log_action(
        db,
        user_id=user.id,
        action="visitor.checked_in",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    await _emit_visitor_change(visitor)
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/check-out", response_model=VisitorOut)
async def check_out_visitor(
    visitor_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    notes = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            notes = body.get("notes")
    except Exception:
        pass
    try:
        visitor = await visitor_service.check_out_visitor(
            db,
            visitor,
            user_id=user.id,
            method="reception",
            notes=notes,
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e
    await log_action(
        db,
        user_id=user.id,
        action="visitor.checked_out",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    await _emit_visitor_change(visitor)
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/approve", response_model=VisitorOut)
async def approve_visitor(
    visitor_id: int,
    body: ApprovalRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    try:
        visitor = await visitor_service.approve_visitor(
            db, visitor, body.stage, user_id=user.id, notes=body.notes
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e
    await log_action(
        db,
        user_id=user.id,
        action=f"visitor.approved.{body.stage}",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/cancel", response_model=VisitorOut)
async def cancel_visitor(
    visitor_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    visitor.status = VisitorStatus.cancelled
    identity = f"visitor-{visitor.id}"
    await run_in_threadpool(face_service.delete_employee, identity)
    visitor.face_registered = False
    await visitor_service.log_visitor_event(
        db, visitor.id, "cancelled", "Visit cancelled", user.id
    )
    await db.flush()
    await db.refresh(visitor)
    await log_action(
        db,
        user_id=user.id,
        action="visitor.cancelled",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    await _emit_visitor_change(visitor)
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/revoke-access", response_model=VisitorOut)
async def revoke_visitor_access(
    visitor_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    identity = f"visitor-{visitor.id}"
    await run_in_threadpool(face_service.delete_employee, identity)
    visitor.face_registered = False
    visitor.face_expires_at = datetime.now(timezone.utc)
    visitor.status = VisitorStatus.expired
    await visitor_service.log_visitor_event(
        db, visitor.id, "access_revoked", "Access manually revoked", user.id
    )
    await db.flush()
    await db.refresh(visitor)
    return _format_visitor(visitor)


@router.post("/visitors/{visitor_id}/reject", response_model=VisitorOut)
async def reject_visitor(
    visitor_id: int,
    body: RejectRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    visitor = await visitor_service.reject_visitor(
        db, visitor, user_id=user.id, notes=body.notes
    )
    await log_action(
        db,
        user_id=user.id,
        action="visitor.rejected",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    return _format_visitor(visitor)


# ── Photos & Documents ──────────────────────────────────────────────────────


async def _make_photo_primary(db, visitor: Visitor, photo: VisitorPhoto) -> None:
    """Mark a photo as the visitor's single primary photo.

    `visitor.photo_url` mirrors the primary photo's URL (used as the avatar);
    keeping exactly one row flagged prevents the same image from being listed
    twice in clients.
    """
    await db.execute(
        update(VisitorPhoto)
        .where(VisitorPhoto.visitor_id == visitor.id, VisitorPhoto.id != photo.id)
        .values(is_primary=False)
    )
    photo.is_primary = True
    visitor.photo_url = photo.url


@router.get("/visitors/{visitor_id}/photos", response_model=list[VisitorPhotoOut])
async def list_visitor_photos(
    visitor_id: int,
    db: DbSession,
    org_id: TenantScope,
    user: require_permission("visitors.view"),
):
    await _get_visitor_or_404(db, visitor_id, org_id)
    stmt = (
        select(VisitorPhoto)
        .where(VisitorPhoto.visitor_id == visitor_id)
        .order_by(VisitorPhoto.is_primary.desc(), VisitorPhoto.id.desc())
    )
    photos = list((await db.execute(stmt)).scalars().all())
    return [VisitorPhotoOut.model_validate(p, from_attributes=True) for p in photos]


@router.post("/visitors/{visitor_id}/photos", response_model=VisitorPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_visitor_photo(
    visitor_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
    file: UploadFile | None = File(None),
    image: str | None = Form(None),
    caption: str | None = Form(None),
    is_primary: bool = Form(False),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    oid = visitor.organization_id
    if file:
        _, url = save_visitor_upload(oid, visitor_id, "photos", file)
    elif image:
        _, url = save_visitor_base64(oid, visitor_id, "photos", image)
    else:
        raise ValidationError("File or image required")

    photo = VisitorPhoto(visitor_id=visitor.id, url=url, is_primary=False, caption=caption)
    db.add(photo)
    await db.flush()
    # The first photo always becomes primary so the visitor gets an avatar.
    if is_primary or not visitor.photo_url:
        await _make_photo_primary(db, visitor, photo)
    await visitor_service.log_visitor_event(
        db, visitor.id, "photo_uploaded", caption or "Photo uploaded", user.id
    )
    await db.flush()
    await db.refresh(photo)
    return VisitorPhotoOut.model_validate(photo, from_attributes=True)


@router.post("/visitors/{visitor_id}/photos/base64", response_model=VisitorPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_visitor_photo_base64(
    visitor_id: int,
    body: PhotoUploadBase64,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    _, url = save_visitor_base64(visitor.organization_id, visitor_id, "photos", body.image)
    photo = VisitorPhoto(visitor_id=visitor.id, url=url, is_primary=False, caption=body.caption)
    db.add(photo)
    await db.flush()
    if body.is_primary or not visitor.photo_url:
        await _make_photo_primary(db, visitor, photo)
    await visitor_service.log_visitor_event(
        db, visitor.id, "photo_uploaded", body.caption or "Photo uploaded", user.id
    )
    await db.flush()
    await db.refresh(photo)
    return VisitorPhotoOut.model_validate(photo, from_attributes=True)


@router.post("/visitors/{visitor_id}/photos/{photo_id}/primary", response_model=VisitorPhotoOut)
async def set_primary_visitor_photo(
    visitor_id: int,
    photo_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    photo = await db.get(VisitorPhoto, photo_id)
    if not photo or photo.visitor_id != visitor_id:
        raise NotFoundError("Photo not found")
    await _make_photo_primary(db, visitor, photo)
    await db.flush()
    await db.refresh(photo)
    return VisitorPhotoOut.model_validate(photo, from_attributes=True)


@router.delete("/visitors/{visitor_id}/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_visitor_photo(
    visitor_id: int,
    photo_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    photo = await db.get(VisitorPhoto, photo_id)
    if not photo or photo.visitor_id != visitor_id:
        raise NotFoundError("Photo not found")
    url = photo.url
    was_primary = photo.is_primary or visitor.photo_url == url
    await db.delete(photo)
    await db.flush()
    if was_primary:
        # Promote the newest remaining photo so the avatar never goes stale.
        remaining = (
            (
                await db.execute(
                    select(VisitorPhoto)
                    .where(VisitorPhoto.visitor_id == visitor_id)
                    .order_by(VisitorPhoto.id.desc())
                )
            )
            .scalars()
            .first()
        )
        if remaining:
            await _make_photo_primary(db, visitor, remaining)
        else:
            visitor.photo_url = None
    await visitor_service.log_visitor_event(db, visitor_id, "photo_deleted", "Photo deleted", user.id)
    await db.flush()
    delete_visitor_file(url)


@router.get("/visitors/{visitor_id}/documents", response_model=list[VisitorDocumentOut])
async def list_visitor_documents(
    visitor_id: int,
    db: DbSession,
    org_id: TenantScope,
    user: require_permission("visitors.view"),
):
    await _get_visitor_or_404(db, visitor_id, org_id)
    stmt = select(VisitorDocument).where(VisitorDocument.visitor_id == visitor_id)
    docs = list((await db.execute(stmt)).scalars().all())
    return [
        VisitorDocumentOut(
            id=d.id,
            visitor_id=d.visitor_id,
            document_type=d.document_type.value,
            url=d.url,
            filename=d.filename,
            notes=d.notes,
            created_at=d.created_at,
        )
        for d in docs
    ]


@router.post("/visitors/{visitor_id}/documents", response_model=VisitorDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_visitor_document(
    visitor_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    notes: str | None = Form(None),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    try:
        doc_type = DocumentType(document_type)
    except ValueError:
        doc_type = DocumentType.other

    _, url = save_visitor_upload(visitor.organization_id, visitor_id, "documents", file, allowed_ext=ALLOWED_DOC_EXT)
    doc = VisitorDocument(
        visitor_id=visitor.id,
        document_type=doc_type,
        url=url,
        filename=file.filename,
        notes=notes,
    )
    db.add(doc)
    await visitor_service.log_visitor_event(
        db, visitor.id, "document_uploaded", f"{doc_type.value} uploaded", user.id
    )
    await db.flush()
    await db.refresh(doc)
    return VisitorDocumentOut(
        id=doc.id,
        visitor_id=doc.visitor_id,
        document_type=doc.document_type.value,
        url=doc.url,
        filename=doc.filename,
        notes=doc.notes,
        created_at=doc.created_at,
    )


@router.delete("/visitors/{visitor_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_visitor_document(
    visitor_id: int,
    doc_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    await _get_visitor_or_404(db, visitor_id, org_id)
    doc = await db.get(VisitorDocument, doc_id)
    if not doc or doc.visitor_id != visitor_id:
        raise NotFoundError("Document not found")
    url = doc.url
    doc_type = doc.document_type.value
    await db.delete(doc)
    await visitor_service.log_visitor_event(
        db, visitor_id, "document_deleted", f"{doc_type} deleted", user.id
    )
    await db.flush()
    delete_visitor_file(url)


@router.get("/visitors/{visitor_id}/timeline", response_model=list[VisitorLogOut])
async def get_visitor_timeline(
    visitor_id: int,
    db: DbSession,
    org_id: TenantScope,
    user: require_permission("visitors.view"),
    limit: int = Query(50, ge=1, le=200),
):
    await _get_visitor_or_404(db, visitor_id, org_id)
    stmt = (
        select(VisitorLog)
        .where(VisitorLog.visitor_id == visitor_id)
        .order_by(VisitorLog.created_at.desc(), VisitorLog.id.desc())
        .limit(limit)
    )
    logs = list((await db.execute(stmt)).scalars().all())
    return [VisitorLogOut.model_validate(entry, from_attributes=True) for entry in logs]


# ── Access permissions ────────────────────────────────────────────────────────


@router.get("/visitors/{visitor_id}/access-permissions", response_model=list[VisitorAccessPermissionOut])
async def list_visitor_access_permissions(
    visitor_id: int,
    db: DbSession,
    org_id: TenantScope,
    user: require_permission("visitors.view"),
):
    from app.models.visitor import VisitorAccessPermission
    await _get_visitor_or_404(db, visitor_id, org_id)
    stmt = select(VisitorAccessPermission).where(
        VisitorAccessPermission.visitor_id == visitor_id
    )
    perms = list((await db.execute(stmt)).scalars().all())
    return [VisitorAccessPermissionOut.model_validate(p, from_attributes=True) for p in perms]


@router.put("/visitors/{visitor_id}/access-permissions", response_model=list[VisitorAccessPermissionOut])
async def set_visitor_access_permissions(
    visitor_id: int,
    body: AccessPermissionSet,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    perms = await visitor_service.set_access_permissions(db, visitor, body.zones)
    await log_action(
        db,
        user_id=user.id,
        action="visitor.access_permissions_set",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
        new_values={"zones": body.zones},
    )
    return [VisitorAccessPermissionOut.model_validate(p, from_attributes=True) for p in perms]


# ── Blacklist ─────────────────────────────────────────────────────────────────


@router.get("/visitor-blacklist", response_model=PaginatedResponse[BlacklistOut])
async def list_blacklist(
    db: DbSession,
    org_id: TenantScope,
    user: require_permission("visitors.view"),
    pagination: PaginationDep,
):
    stmt = select(VisitorBlacklist).where(VisitorBlacklist.is_active == True).order_by(VisitorBlacklist.id.desc())  # noqa: E712
    stmt = apply_tenant_filter(stmt, org_id, VisitorBlacklist.organization_id)
    result = await paginate(db, stmt, pagination.page, pagination.per_page, None)
    result.data = [
        BlacklistOut(
            id=e.id,
            organization_id=e.organization_id,
            visitor_id=e.visitor_id,
            name=e.name,
            id_number=e.id_number,
            reason=e.reason.value,
            notes=e.notes,
            is_active=e.is_active,
            created_at=e.created_at,
        )
        for e in result.data
    ]
    return result


@router.post("/visitor-blacklist", response_model=BlacklistOut, status_code=status.HTTP_201_CREATED)
async def add_to_blacklist(
    body: BlacklistCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")
    from app.models.visitor import BlacklistReason
    try:
        reason = BlacklistReason(body.reason)
    except ValueError:
        reason = BlacklistReason.blocked
    entry = VisitorBlacklist(
        organization_id=org_id,
        visitor_id=body.visitor_id,
        name=body.name,
        id_number=body.id_number,
        reason=reason,
        notes=body.notes,
        added_by_user_id=user.id,
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    await log_action(
        db,
        user_id=user.id,
        action="visitor.blacklisted",
        entity_type="visitor_blacklist",
        entity_id=entry.id,
        ip_address=request.client.host if request.client else None,
    )
    out = BlacklistOut.model_validate(entry, from_attributes=True)
    out.reason = entry.reason.value
    return out


@router.delete("/visitor-blacklist/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_blacklist(
    entry_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitors.manage"),
):
    stmt = select(VisitorBlacklist).where(VisitorBlacklist.id == entry_id)
    stmt = apply_tenant_filter(stmt, org_id, VisitorBlacklist.organization_id)
    entry = (await db.execute(stmt)).scalar_one_or_none()
    if not entry:
        raise NotFoundError("Blacklist entry not found")
    entry.is_active = False
    await db.flush()


# ── Background expiry task ────────────────────────────────────────────────────


async def _run_visitor_expiry_loop() -> None:
    from app.core.database import async_session_factory
    while True:
        try:
            async with async_session_factory() as db:
                count = await visitor_service.expire_visitors(db)
                await db.commit()
                if count:
                    logger.info("[visitor-expiry] Expired %d visitor(s)", count)
        except Exception:
            logger.exception("[visitor-expiry] loop error")
        await asyncio.sleep(60)


def start_visitor_expiry_task() -> asyncio.Task:
    global _expiry_task
    if _expiry_task is None or _expiry_task.done():
        _expiry_task = asyncio.create_task(_run_visitor_expiry_loop())
    return _expiry_task


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_visitor_or_404(
    db: DbSession, visitor_id: int, org_id: int | list[int] | None
) -> Visitor:
    stmt = select(Visitor).where(Visitor.id == visitor_id)
    stmt = apply_tenant_filter(stmt, org_id, Visitor.organization_id)
    visitor = (await db.execute(stmt)).scalar_one_or_none()
    if not visitor:
        raise NotFoundError("Visitor not found")
    return visitor
