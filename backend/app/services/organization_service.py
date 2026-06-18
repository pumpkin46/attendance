"""Organization-tree and location business logic.

The ``organizations`` table is a plain ``parent_id`` adjacency-list tree. A
company *root* (``parent_id IS NULL``) is the tenant; its descendant nodes
(departments, teams, branches, ...) are sub-units — a structural org chart.
Members (employees/users/locations) belong to the company via
``organization_id`` (the tenant root); they are not assigned to individual
nodes. A node's company root and sub-tree are derived by walking ``parent_id``
with the recursive helpers in ``app.middleware.tenant``. The tree endpoints
expose ``depth``/``path``/``root_organization_id`` as values COMPUTED while
assembling a response.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.middleware.tenant import (
    ancestor_chain,
    apply_tenant_filter,
    descendant_ids,
    fetch_subtree,
    root_id_of,
)
from app.models.employee import Employee
from app.models.location import Location
from app.models.organization import Organization
from app.schemas.organization import (
    LocationCreate,
    LocationOut,
    LocationUpdate,
    OrganizationCreate,
    OrganizationOut,
    OrganizationUpdate,
    OrganizationWithCounts,
    OrgNodeBrief,
    OrgNodeCreate,
    OrgNodeDetail,
    OrgNodeMove,
    OrgNodeOut,
    OrgNodeUpdate,
)


# ── Shared helpers ─────────────────────────────────────────────────────────────


async def _count_where(db: AsyncSession, model, column, value: int) -> int:
    stmt = select(func.count()).select_from(model).where(column == value)
    return (await db.execute(stmt)).scalar_one()


async def _node_out(db: AsyncSession, node: Organization) -> OrgNodeOut:
    """Build an OrgNodeOut for a single node, computing depth/path/root."""
    chain = await ancestor_chain(db, node.id, include_self=True)  # root → … → node
    depth = max(0, len(chain) - 1)
    path = "/" + "/".join(str(o.id) for o in chain) + "/" if chain else f"/{node.id}/"
    root_id = chain[0].id if chain else node.id
    return OrgNodeOut(
        id=node.id,
        name=node.name,
        code=node.code,
        node_type=node.node_type,
        parent_id=node.parent_id,
        root_organization_id=root_id,
        timezone=node.timezone,
        depth=depth,
        path=path,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        children=None,
    )


# ── Organizations (company roots) ───────────────────────────────────────────────


async def _ensure_unique_root_code(
    db: AsyncSession, code: str, *, exclude_id: int | None = None
) -> None:
    """Company codes stay globally unique (app-layer; roots only)."""
    stmt = select(Organization.id).where(
        Organization.code == code, Organization.parent_id.is_(None)
    )
    if exclude_id is not None:
        stmt = stmt.where(Organization.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise ConflictError(f"Organization code '{code}' is already in use")


async def list_organizations(
    db: AsyncSession,
    *,
    is_super_admin: bool,
    user_org_id: int | None,
    tenant_org_id: int | None,
) -> list[OrganizationWithCounts]:
    stmt = (
        select(Organization)
        .where(Organization.parent_id.is_(None))
        .order_by(Organization.name)
    )
    if not is_super_admin:
        stmt = stmt.where(Organization.id == user_org_id)
    elif tenant_org_id is not None:
        stmt = stmt.where(Organization.id == tenant_org_id)
    roots = list((await db.execute(stmt)).scalars().all())

    result: list[OrganizationWithCounts] = []
    for root in roots:
        descendants = await descendant_ids(db, root.id, include_self=False)
        employees = await _count_where(db, Employee, Employee.organization_id, root.id)
        result.append(
            OrganizationWithCounts(
                **OrganizationOut.model_validate(root, from_attributes=True).model_dump(),
                nodes_count=len(descendants),
                employees_count=employees,
            )
        )
    return result


async def create_organization(
    db: AsyncSession, body: OrganizationCreate, *, is_super_admin: bool
) -> Organization:
    if not is_super_admin:
        raise PermissionDeniedError("Only super admins can create organizations")
    await _ensure_unique_root_code(db, body.code)
    org = Organization(
        name=body.name,
        code=body.code,
        timezone=body.timezone,
        settings=body.settings,
        node_type="company",
        parent_id=None,
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return org


async def get_organization(
    db: AsyncSession, target_org_id: int, *, is_super_admin: bool, user_org_id: int | None
) -> Organization:
    if not is_super_admin and user_org_id != target_org_id:
        raise PermissionDeniedError("Access denied")
    org = (
        await db.execute(
            select(Organization).where(
                Organization.id == target_org_id, Organization.parent_id.is_(None)
            )
        )
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization not found")
    return org


async def update_organization(
    db: AsyncSession,
    target_org_id: int,
    body: OrganizationUpdate,
    *,
    is_super_admin: bool,
    user_org_id: int | None,
) -> Organization:
    org = await get_organization(
        db, target_org_id, is_super_admin=is_super_admin, user_org_id=user_org_id
    )
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != org.code:
        await _ensure_unique_root_code(db, changes["code"], exclude_id=org.id)
    for field, value in changes.items():
        setattr(org, field, value)
    await db.flush()
    await db.refresh(org)
    return org


async def delete_organization(
    db: AsyncSession, target_org_id: int, *, is_super_admin: bool
) -> None:
    if not is_super_admin:
        raise PermissionDeniedError("Only super admins can delete organizations")
    org = (
        await db.execute(
            select(Organization).where(
                Organization.id == target_org_id, Organization.parent_id.is_(None)
            )
        )
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization not found")

    descendants = await descendant_ids(db, org.id, include_self=False)
    if descendants:
        raise ConflictError(
            f"Organization still has {len(descendants)} sub-unit(s); remove them first"
        )
    employees = await _count_where(db, Employee, Employee.organization_id, org.id)
    if employees:
        raise ConflictError(
            f"Organization still has {employees} employee(s); reassign or remove them first"
        )
    await db.delete(org)
    await db.flush()


# ── Org-tree nodes ───────────────────────────────────────────────────────────


async def _ensure_unique_sibling_code(
    db: AsyncSession, parent_id: int, code: str, *, exclude_id: int | None = None
) -> None:
    stmt = select(Organization.id).where(
        Organization.parent_id == parent_id, Organization.code == code
    )
    if exclude_id is not None:
        stmt = stmt.where(Organization.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise ConflictError(f"Code '{code}' is already in use under this parent")


async def _get_node_in_tenant(
    db: AsyncSession, tenant_org_id: int | None, node_id: int
) -> Organization:
    """Load a node belonging to the caller's tenant (or any node when global)."""
    node = (
        await db.execute(select(Organization).where(Organization.id == node_id))
    ).scalar_one_or_none()
    if node is None:
        raise NotFoundError("Organization node not found")
    if tenant_org_id is not None and await root_id_of(db, node.id) != tenant_org_id:
        raise NotFoundError("Organization node not found")
    return node


async def get_tree(db: AsyncSession, tenant_org_id: int | None) -> list[OrgNodeOut]:
    """Return the tenant's org tree as nested OrgNodeOut roots.

    depth/path/root_organization_id are computed during assembly. For a global
    super admin (tenant_org_id None) every company is returned.
    """
    if tenant_org_id is not None:
        rows = await fetch_subtree(db, tenant_org_id)
        top_ids = [tenant_org_id]
    else:
        rows = list((await db.execute(select(Organization))).scalars().all())
        top_ids = [r.id for r in rows if r.parent_id is None]
    if not rows:
        return []

    by_id = {r.id: r for r in rows}
    by_parent: dict[int | None, list[Organization]] = {}
    for r in rows:
        by_parent.setdefault(r.parent_id, []).append(r)

    def build(node: Organization, parent_path: str, depth: int, root_resp: int) -> OrgNodeOut:
        path = f"{parent_path}{node.id}/"
        kids = sorted(by_parent.get(node.id, []), key=lambda o: o.name)
        return OrgNodeOut(
            id=node.id,
            name=node.name,
            code=node.code,
            node_type=node.node_type,
            parent_id=node.parent_id,
            root_organization_id=root_resp,
            timezone=node.timezone,
            depth=depth,
            path=path,
            is_active=node.is_active,
            created_at=node.created_at,
            updated_at=node.updated_at,
            children=[build(k, path, depth + 1, root_resp) for k in kids],
        )

    out: list[OrgNodeOut] = []
    for top_id in top_ids:
        top = by_id.get(top_id)
        if top is None:
            continue
        root_resp = tenant_org_id if tenant_org_id is not None else top.id
        out.append(build(top, "/", 0, root_resp))
    return out


async def get_node(db: AsyncSession, tenant_org_id: int | None, node_id: int) -> OrgNodeDetail:
    node = await _get_node_in_tenant(db, tenant_org_id, node_id)
    base = await _node_out(db, node)
    breadcrumb_rows = await ancestor_chain(db, node.id, include_self=False)
    breadcrumb = [
        OrgNodeBrief(id=o.id, name=o.name, node_type=o.node_type) for o in breadcrumb_rows
    ]
    return OrgNodeDetail(**base.model_dump(), breadcrumb=breadcrumb)


async def create_node(
    db: AsyncSession, tenant_org_id: int | None, body: OrgNodeCreate
) -> OrgNodeOut:
    parent = await _get_node_in_tenant(db, tenant_org_id, body.parent_id)
    await _ensure_unique_sibling_code(db, parent.id, body.code)
    node = Organization(
        name=body.name,
        code=body.code,
        node_type=body.node_type,
        parent_id=parent.id,
        timezone=body.timezone,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    return await _node_out(db, node)


async def update_node(
    db: AsyncSession, tenant_org_id: int | None, node_id: int, body: OrgNodeUpdate
) -> OrgNodeOut:
    node = await _get_node_in_tenant(db, tenant_org_id, node_id)
    if node.parent_id is None:
        raise ValidationError("Use the organizations endpoint to edit a company root")
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != node.code:
        await _ensure_unique_sibling_code(db, node.parent_id, changes["code"], exclude_id=node.id)
    for field, value in changes.items():
        setattr(node, field, value)
    await db.flush()
    await db.refresh(node)
    return await _node_out(db, node)


async def move_node(
    db: AsyncSession, tenant_org_id: int | None, node_id: int, body: OrgNodeMove
) -> OrgNodeOut:
    node = await _get_node_in_tenant(db, tenant_org_id, node_id)
    if node.parent_id is None:
        raise ValidationError("A company root cannot be moved")
    new_parent = await _get_node_in_tenant(db, tenant_org_id, body.new_parent_id)

    node_root = await root_id_of(db, node.id)
    if await root_id_of(db, new_parent.id) != node_root:
        raise ValidationError("Cannot move a node to a different organization")
    if new_parent.id == node.parent_id:
        await db.refresh(node)
        return await _node_out(db, node)

    # Serialize concurrent reparents within this company: without a lock two
    # moves (X under Y; Y under X) each evaluate the cycle guard against a
    # pre-move snapshot, both pass, and commit a cycle (write-skew). Locking the
    # company-root row makes the second move wait and then re-read the first's
    # change below. A no-op on SQLite (tests); a real row lock on PostgreSQL.
    if node_root is not None:
        await db.execute(
            select(Organization.id).where(Organization.id == node_root).with_for_update()
        )

    # Cycle guard (re-evaluated under the lock): the new parent must not be the
    # node itself or a descendant.
    blocked = await descendant_ids(db, node.id, include_self=True)
    if new_parent.id in blocked:
        raise ValidationError("Cannot move a node beneath itself")
    await _ensure_unique_sibling_code(db, new_parent.id, node.code, exclude_id=node.id)

    node.parent_id = new_parent.id
    await db.flush()
    await db.refresh(node)
    return await _node_out(db, node)


async def delete_node(db: AsyncSession, tenant_org_id: int | None, node_id: int) -> None:
    node = await _get_node_in_tenant(db, tenant_org_id, node_id)
    if node.parent_id is None:
        raise ValidationError("Use the organizations endpoint to delete a company root")
    child_nodes = await _count_where(db, Organization, Organization.parent_id, node.id)
    if child_nodes:
        raise ConflictError(
            f"Node still has {child_nodes} sub-unit(s); remove or move them first"
        )
    await db.delete(node)
    await db.flush()


# ── Locations ─────────────────────────────────────────────────────────────────


async def _resolve_target_org_id(
    db: AsyncSession, tenant_org_id: int | None, body_org_id: int | None
) -> int:
    """The tenant root a new location belongs to (tenant context wins)."""
    org_id = tenant_org_id if tenant_org_id is not None else body_org_id
    if org_id is None:
        raise ValidationError("Organization context required")
    root_id = await root_id_of(db, org_id)
    if root_id is None:
        raise NotFoundError("Organization not found")
    return root_id


async def list_locations(db: AsyncSession, tenant_org_id: int | None) -> list[LocationOut]:
    stmt = select(Location).order_by(Location.name)
    stmt = apply_tenant_filter(stmt, tenant_org_id, Location.organization_id)
    return [
        LocationOut.model_validate(loc, from_attributes=True)
        for loc in (await db.execute(stmt)).scalars().all()
    ]


async def _get_location(db: AsyncSession, tenant_org_id: int | None, location_id: int) -> Location:
    stmt = select(Location).where(Location.id == location_id)
    stmt = apply_tenant_filter(stmt, tenant_org_id, Location.organization_id)
    location = (await db.execute(stmt)).scalar_one_or_none()
    if location is None:
        raise NotFoundError("Location not found")
    return location


async def create_location(
    db: AsyncSession, tenant_org_id: int | None, body: LocationCreate
) -> LocationOut:
    target_org_id = await _resolve_target_org_id(db, tenant_org_id, body.organization_id)
    location = Location(
        organization_id=target_org_id,
        name=body.name,
        address=body.address,
        timezone=body.timezone,
    )
    db.add(location)
    await db.flush()
    await db.refresh(location)
    return LocationOut.model_validate(location, from_attributes=True)


async def update_location(
    db: AsyncSession, tenant_org_id: int | None, location_id: int, body: LocationUpdate
) -> LocationOut:
    location = await _get_location(db, tenant_org_id, location_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(location, field, value)
    await db.flush()
    await db.refresh(location)
    return LocationOut.model_validate(location, from_attributes=True)


async def _location_dependents(db: AsyncSession, location_id: int) -> dict[str, int]:
    """Counts of records that would cascade-delete with the location."""
    from app.models.camera import Camera
    from app.models.edge import EdgeDevice
    from app.models.rfid import RfidReader

    counts: dict[str, int] = {}
    for label, model in (("camera", Camera), ("RFID reader", RfidReader), ("edge device", EdgeDevice)):
        stmt = select(func.count()).select_from(model).where(model.location_id == location_id)
        count = (await db.execute(stmt)).scalar_one()
        if count:
            counts[label] = count
    return counts


async def delete_location(db: AsyncSession, tenant_org_id: int | None, location_id: int) -> None:
    location = await _get_location(db, tenant_org_id, location_id)

    # Cameras, RFID readers, and edge devices cascade-delete with their
    # location — refuse instead of silently destroying device configuration.
    dependents = await _location_dependents(db, location.id)
    if dependents:
        detail = ", ".join(f"{count} {label}(s)" for label, count in dependents.items())
        raise ConflictError(f"Location still has {detail}; move or remove them first")

    employees = await _count_where(db, Employee, Employee.location_id, location.id)
    if employees:
        raise ConflictError(
            f"Location still has {employees} employee(s); reassign or remove them first"
        )

    # Attendance history and holidays that pointed here are detached
    # (location_id SET NULL) by the database.
    await db.delete(location)
    await db.flush()
