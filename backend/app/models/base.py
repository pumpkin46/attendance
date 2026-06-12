from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    # Server-defaulted so every row is stamped even on inserts that bypass the
    # ORM; updated_at is also maintained by the ORM (onupdate). Left nullable to
    # match the existing schema across all timestamped tables (tightening to
    # NOT NULL would need a coordinated migration over every such table).
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )
