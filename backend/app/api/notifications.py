from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.core.dependencies import CurrentUser, DbSession
from app.core.pagination import PaginationDep, paginate
from app.models.notification import Notification
from app.schemas.notification import NotificationOut

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    db: DbSession,
    user: CurrentUser,
    pagination: PaginationDep,
):
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, NotificationOut)


@router.get("/unread-count")
async def unread_count(
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(func.count(Notification.id)).where(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    )
    count = (await db.execute(stmt)).scalar() or 0
    return {"unread_count": count}


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_as_read(
    notification_id: str,
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    )
    result = await db.execute(stmt)
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")

    if notif.read_at is None:
        notif.read_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(notif)
    return NotificationOut.model_validate(notif, from_attributes=True)


@router.post("/read-all")
async def mark_all_as_read(
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(Notification).where(
        Notification.user_id == user.id,
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
    return {"marked_read": count}
