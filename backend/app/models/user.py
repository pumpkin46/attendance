from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


role_permission = Table(
    "role_permission",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)

role_user = Table(
    "role_user",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

# A user may be granted access to many org-tree nodes — a company root or any
# sub-unit. Their read scope is the union of those nodes' sub-trees (employees)
# and the nodes' company roots (everything else); see app.core.dependencies
# (get_tenant_scope, get_tenant_org_id) and app.middleware.tenant.Scope.
user_organization = Table(
    "user_organization",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "organization_id",
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Role(Base, TimestampMixin):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    label: Mapped[str] = mapped_column(String(255))

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permission, lazy="selectin"
    )


class Permission(Base, TimestampMixin):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    label: Mapped[str] = mapped_column(String(255))


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("oauth_provider", "oauth_id"),
        Index("ix_users_auth_provider_external_id", "auth_provider", "external_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    password: Mapped[str] = mapped_column(String(255))
    auth_provider: Mapped[str] = mapped_column(String(32), server_default="local")
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    remember_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Bumped on every password change. Access tokens carry the value they were
    # minted with; get_current_user rejects any token older than this, so a
    # password change invalidates all previously-issued tokens.
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    roles: Mapped[list[Role]] = relationship(secondary=role_user, lazy="selectin")
    # Organizations (company roots) this account may access. Drives the tenant
    # read-scope for non-super-admins (union of these orgs' sub-trees).
    organizations: Mapped[list["Organization"]] = relationship(
        secondary=user_organization, lazy="selectin"
    )

    def has_role(self, role_name: str) -> bool:
        return any(r.name == role_name for r in self.roles)

    def has_permission(self, permission_name: str) -> bool:
        for role in self.roles:
            for perm in role.permissions:
                if perm.name == permission_name:
                    return True
        return False
