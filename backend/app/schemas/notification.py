from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NotificationOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    type: str
    data: dict | None = None
    read_at: datetime | None = None
    created_at: datetime | None = None
