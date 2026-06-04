from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.live_event import LiveEvent
from app.realtime.hub import emit


async def create_live_event(
    db: AsyncSession,
    organization_id: int | None,
    event_type: str,
    message: str,
    payload: dict | None = None,
    camera_id: int | None = None,
    employee_id: int | None = None,
    visitor_id: int | None = None,
    access_point_id: int | None = None,
) -> None:
    event = LiveEvent(
        organization_id=organization_id,
        event_type=event_type,
        message=message,
        payload=json.dumps(payload) if payload else None,
        camera_id=camera_id,
        employee_id=employee_id,
        visitor_id=visitor_id,
        access_point_id=access_point_id,
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.flush()

    await emit(
        organization_id,
        event_type,
        {
            "message": message,
            "payload": payload,
            "camera_id": camera_id,
            "employee_id": employee_id,
            "visitor_id": visitor_id,
            "access_point_id": access_point_id,
            "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
        },
    )
