from __future__ import annotations

from typing import Any

from pydantic_core import to_jsonable_python
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


def _json_safe_values(values: dict[str, Any] | None) -> dict[str, Any] | None:
    if values is None:
        return None
    return to_jsonable_python(values)


async def log_action(
    db: AsyncSession,
    user_id: int | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    old_values: dict | None = None,
    new_values: dict | None = None,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        ip_address=ip_address,
        user_agent=user_agent,
        old_values=_json_safe_values(old_values),
        new_values=_json_safe_values(new_values),
    )
    db.add(entry)
    await db.flush()
