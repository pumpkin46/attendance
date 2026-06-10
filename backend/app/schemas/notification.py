from __future__ import annotations

import json
from datetime import datetime

from pydantic import BaseModel, field_validator


class NotificationOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    type: str
    data: dict | None = None
    read_at: datetime | None = None
    created_at: datetime | None = None

    @field_validator("data", mode="before")
    @classmethod
    def _parse_data(cls, value: object) -> dict | None:
        """`Notification.data` is stored as a JSON string (Laravel-style Text
        column); deserialize it to a dict for the API response."""
        if value is None or isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except (ValueError, TypeError):
                return None
            return parsed if isinstance(parsed, dict) else None
        return None
