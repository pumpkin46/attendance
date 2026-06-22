"""Public first-run setup wizard.

On a fresh database (migrations applied, nothing seeded) the frontend shows a
setup page that creates the organization and the first super-admin account in
one call. The endpoints are public but self-disable: once a super admin
exists, status reports ``needs_setup: false`` and the POST returns 409.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.dependencies import DbSession
from app.core.errors import ConflictError
from app.core.rate_limit import register_rate_limit
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.services import setup_migrations
from app.services.audit_service import log_action
from app.services.bootstrap import ensure_roles_and_permissions, super_admin_exists

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


class SetupStatus(BaseModel):
    needs_setup: bool
    database_ready: bool
    database_name: str
    pending_migrations: int
    migration_status: str


class DatabaseSetupRequest(BaseModel):
    database_name: str | None = Field(default=None, max_length=63)

    @field_validator("database_name")
    @classmethod
    def _valid_identifier(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
            raise ValueError(
                "Database name may only contain letters, digits and underscores, "
                "and must not start with a digit"
            )
        return value


class MigrationProgress(BaseModel):
    status: str
    lines: list[str]
    total: int
    completed: int
    error: str | None = None


class SetupRequest(BaseModel):
    organization_name: str = Field(min_length=1, max_length=255)
    timezone: str = Field(default="UTC", max_length=255)
    admin_name: str = Field(min_length=1, max_length=255)
    admin_email: str = Field(max_length=255)
    admin_password: str = Field(min_length=8, max_length=255)

    @field_validator("organization_name", "admin_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be empty")
        return stripped

    @field_validator("admin_email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Invalid email address")
        return normalized


class SetupResult(BaseModel):
    message: str


def _org_code(name: str) -> str:
    """Derive a stable org code from the name (e.g. "Acme Corp." -> "ACME-CORP")."""
    code = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()[:32]
    return code or "MAIN"


async def _admin_exists_safe() -> bool:
    """super_admin_exists that treats an unusable database as 'no admin'."""
    try:
        async with async_session_factory() as db:
            return await super_admin_exists(db)
    except Exception:
        return False


@router.get("/status", response_model=SetupStatus)
async def setup_status():
    # Deliberately avoids the DbSession dependency: this endpoint must answer
    # even when the database doesn't exist yet (that's what it reports).
    reachable, pending = await setup_migrations.check_database()
    database_ready = reachable and pending == 0
    has_admin = database_ready and await _admin_exists_safe()
    return SetupStatus(
        needs_setup=not database_ready or not has_admin,
        database_ready=database_ready,
        database_name=settings.db_database,
        pending_migrations=max(pending, 0),
        migration_status=setup_migrations.get_state()["status"],
    )


@router.post("/database", response_model=MigrationProgress, dependencies=[register_rate_limit()])
async def start_database_setup(body: DatabaseSetupRequest | None = None):
    """Create the database (if missing) and run migrations in the background.

    An optional custom ``database_name`` overrides the configured one — it is
    persisted to .env and the live engine reconnects after migration. Public
    but self-disabling: once the system is fully set up (schema at head AND a
    super admin exists), this returns 409 — schema maintenance is then an
    operator concern, not an anonymous one.
    """
    reachable, pending = await setup_migrations.check_database()
    if reachable and pending == 0 and await _admin_exists_safe():
        raise ConflictError("The system is already set up")
    setup_migrations.start_migration(body.database_name if body else None)
    return MigrationProgress(**setup_migrations.get_state())


@router.get("/database/progress", response_model=MigrationProgress)
async def database_progress():
    return MigrationProgress(**setup_migrations.get_state())


@router.post("", response_model=SetupResult, status_code=201, dependencies=[register_rate_limit()])
async def run_setup(body: SetupRequest, request: Request, db: DbSession):
    if await super_admin_exists(db):
        raise ConflictError("The system is already set up")

    roles = await ensure_roles_and_permissions(db)

    # Reuse a pre-existing organization (partial seed) rather than creating a
    # second one — single-org deployments rely on there being exactly one.
    org = (
        (await db.execute(select(Organization).order_by(Organization.id).limit(1)))
        .scalars()
        .first()
    )
    if org is None:
        org = Organization(
            name=body.organization_name,
            code=_org_code(body.organization_name),
            timezone=body.timezone,
            node_type="company",
            parent_id=None,
        )
        db.add(org)
        await db.flush()

    existing = await db.execute(select(User.id).where(User.email == body.admin_email))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("An account with that email already exists")

    admin = User(
        name=body.admin_name,
        email=body.admin_email,
        password=hash_password(body.admin_password),
        auth_provider="local",
        is_active=True,
    )
    admin.roles = [roles[settings.super_admin_role]]
    db.add(admin)
    await db.flush()

    await log_action(
        db,
        user_id=admin.id,
        action="setup.completed",
        entity_type="organization",
        entity_id=org.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )
    return SetupResult(message="Setup complete")
