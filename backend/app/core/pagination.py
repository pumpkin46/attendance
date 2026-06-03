from __future__ import annotations

import math
from typing import Any, Generic, TypeVar

from typing import Annotated

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    data: list[T]
    current_page: int
    last_page: int
    per_page: int
    total: int


class PaginationParams:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        per_page: int = Query(15, ge=1, le=100),
    ):
        self.page = page
        self.per_page = per_page


PaginationDep = Annotated[PaginationParams, Depends()]


async def paginate(
    db: AsyncSession,
    stmt: Select,
    page: int,
    per_page: int,
    response_model: type | None = None,
) -> dict[str, Any]:
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * per_page
    items_stmt = stmt.offset(offset).limit(per_page)
    result = await db.execute(items_stmt)
    items = list(result.scalars().all())

    last_page = max(1, math.ceil(total / per_page))

    if response_model:
        data = [response_model.model_validate(item, from_attributes=True) for item in items]
    else:
        data = items

    return {
        "data": data,
        "current_page": page,
        "last_page": last_page,
        "per_page": per_page,
        "total": total,
    }
