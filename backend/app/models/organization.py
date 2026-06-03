from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(255), unique=True)
    timezone: Mapped[str] = mapped_column(String(255), server_default="UTC")
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    branches: Mapped[list[Branch]] = relationship(back_populates="organization", lazy="selectin")
    departments: Mapped[list[Department]] = relationship(back_populates="organization", lazy="selectin")


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"
    __table_args__ = (
        UniqueConstraint("organization_id", "code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str] = mapped_column(String(255), server_default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped[Organization] = relationship(back_populates="branches", lazy="selectin")


class Department(Base, TimestampMixin):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("organization_id", "code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    branch_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped[Organization] = relationship(back_populates="departments", lazy="selectin")
    branch: Mapped[Branch | None] = relationship(lazy="selectin")
