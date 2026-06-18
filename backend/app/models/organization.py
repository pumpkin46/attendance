from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Organization(Base, TimestampMixin):
    """A node in the organization tree (a plain ``parent_id`` adjacency list).

    A root node (``parent_id IS NULL``) is a *company* and the tenant boundary;
    its descendants (departments, teams, branches, ...) are sub-units of that
    same company. A node's company root and its sub-tree are derived by walking
    ``parent_id`` (see ``app.middleware.tenant`` recursive helpers); they are
    not denormalized onto the row.
    """

    __tablename__ = "organizations"
    __table_args__ = (
        # Sibling nodes (and root companies among themselves) can't share a code.
        UniqueConstraint("parent_id", "code", name="uq_org_parent_code"),
        # Company roots have parent_id IS NULL, which the constraint above treats
        # as distinct in Postgres — so a partial unique index is needed to keep
        # root codes (the company identifier) unique at the DB level.
        Index(
            "uq_org_root_code",
            "code",
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
            sqlite_where=text("parent_id IS NULL"),
        ),
        Index("ix_org_parent", "parent_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(255))

    # Tree link. parent_id NULL marks a root (company). RESTRICT so a node can
    # never be deleted out from under its descendants — deletes are guarded in
    # the service layer with a clear 409 (organization_service.delete_node).
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    # Free-form label ('company' is reserved for roots, e.g. 'department',
    # 'team', 'branch'). Kept as a string so new levels need no migration.
    node_type: Mapped[str] = mapped_column(String(32), server_default="company")

    timezone: Mapped[str] = mapped_column(String(255), server_default="UTC")
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    parent: Mapped[Organization | None] = relationship(
        "Organization",
        remote_side=[id],
        back_populates="children",
        lazy="noload",
    )
    children: Mapped[list[Organization]] = relationship(
        "Organization",
        back_populates="parent",
        lazy="noload",
    )
