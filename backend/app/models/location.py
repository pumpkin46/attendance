from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Location(Base, TimestampMixin):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    branch_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str] = mapped_column(String(255), server_default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    branch: Mapped["Branch | None"] = relationship(lazy="selectin")
    cameras: Mapped[list["Camera"]] = relationship("Camera", back_populates="location", lazy="noload")
