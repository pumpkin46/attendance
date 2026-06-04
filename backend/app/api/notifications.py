from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.dependencies import CurrentUser, DbSession
from app.core.errors import NotFoundError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.models.notification import Notification
from app.schemas.notification import NotificationOut

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

# The notifications table is polymorphic (Laravel-style notifiable_type/_id),
# not a flat user_id column. User-targeted notifications use this notifiable_type.
USER_NOTIFIABLE = "user"


class UnreadCountResponse(BaseModel):
    unread_count: int


class MarkAllReadResponse(BaseModel):
    marked_read: int


@router.get("", response_model=PaginatedResponse[NotificationOut])
async def list_notifications(
    db: DbSession,
    user: CurrentUser,
    pagination: PaginationDep,
):
    stmt = (
        select(Notification)
        .where(
            Notification.notifiable_type == USER_NOTIFIABLE,
            Notification.notifiable_id == user.id,
        )
        .order_by(Notification.created_at.desc())
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, NotificationOut)


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(func.count(Notification.id)).where(
        Notification.notifiable_type == USER_NOTIFIABLE,
        Notification.notifiable_id == user.id,
        Notification.read_at.is_(None),
    )
    count = (await db.execute(stmt)).scalar() or 0
    return UnreadCountResponse(unread_count=count)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_as_read(
    notification_id: str,
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.notifiable_type == USER_NOTIFIABLE,
        Notification.notifiable_id == user.id,
    )
    result = await db.execute(stmt)
    notif = result.scalar_one_or_none()
    if not notif:
        raise NotFoundError("Notification not found")

    if notif.read_at is None:
        notif.read_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(notif)
    return NotificationOut.model_validate(notif, from_attributes=True)


@router.post("/read-all", response_model=MarkAllReadResponse)
async def mark_all_as_read(
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(Notification).where(
        Notification.notifiable_type == USER_NOTIFIABLE,
        Notification.notifiable_id == user.id,
        Notification.read_at.is_(None),
    )
    result = await db.execute(stmt)
    notifications = result.scalars().all()

    now = datetime.now(timezone.utc)
    count = 0
    for notif in notifications:
        notif.read_at = now
        count += 1
    await db.flush()
    return MarkAllReadResponse(marked_read=count)
