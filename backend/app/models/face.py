from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class FaceEnrollmentSession(Base, TimestampMixin):
    __tablename__ = "face_enrollment_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    image_count: Mapped[int] = mapped_column(SmallInteger)
    average_quality_score: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    enrollment_score: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    version: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    enrollment_mode: Mapped[str] = mapped_column(String(32), server_default="structured")
    raw_images_retained: Mapped[bool] = mapped_column(Boolean, server_default="0")

    employee: Mapped["Employee"] = relationship(lazy="selectin")
    embeddings: Mapped[list[FaceEmbedding]] = relationship(
        back_populates="enrollment_session", lazy="noload"
    )
    images: Mapped[list[FaceEnrollmentImage]] = relationship(
        back_populates="enrollment_session", lazy="noload"
    )


class FaceEmbedding(Base, TimestampMixin):
    __tablename__ = "face_embeddings"
    # Mirrors the index created in migration e5f6a7b8c9d0 (the model previously
    # lagged the schema, so autogenerate would propose dropping it).
    __table_args__ = (
        Index("ix_face_embeddings_employee_id_is_active", "employee_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    face_enrollment_session_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("face_enrollment_sessions.id", ondelete="SET NULL"), nullable=True
    )
    faiss_id: Mapped[str] = mapped_column(String(255), unique=True)
    quality_score: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    image_index: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    pose_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    face_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    employee: Mapped["Employee"] = relationship(back_populates="face_embeddings", lazy="selectin")
    enrollment_session: Mapped[FaceEnrollmentSession | None] = relationship(
        back_populates="embeddings", lazy="selectin"
    )


class FaceEnrollmentImage(Base, TimestampMixin):
    __tablename__ = "face_enrollment_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    face_enrollment_session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("face_enrollment_sessions.id", ondelete="CASCADE")
    )
    image_index: Mapped[int] = mapped_column(SmallInteger)
    pose_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    validation_checks: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    face_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    enrollment_session: Mapped[FaceEnrollmentSession] = relationship(
        back_populates="images", lazy="selectin"
    )
