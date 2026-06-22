from __future__ import annotations

from fastapi import APIRouter, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, or_, select
from sqlalchemy.orm import lazyload

from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantNodeScope,
    TenantOrgId,
    require_permission,
)
from app.core.errors import NotFoundError, ValidationError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.middleware.tenant import (
    apply_employee_tenant_filter,
    apply_tenant_filter,
    as_scope_ids,
    descendants_subquery,
    descendants_subquery_multi,
    root_id_of,
)
from app.models.employee import Employee
from app.models.location import Location
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.services import face_service
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1/employees", tags=["employees"])


@router.get("", response_model=PaginatedResponse[EmployeeOut])
async def list_employees(
    db: DbSession,
    user: CurrentUser,
    node_scope: TenantNodeScope,
    pag: PaginationDep,
    search: str | None = None,
    # Filter to one org-tree node and its descendants (the directory sidebar).
    org_node_id: int | None = None,
    is_active: bool | None = None,
):
    # EmployeeOut is flat (FK ids only); skip the lazy="selectin" relationship
    # loads (organization/location) the response never reads.
    stmt = (
        select(Employee)
        .options(
            lazyload(Employee.organization),
            lazyload(Employee.location),
        )
        .order_by(Employee.last_name, Employee.first_name)
    )
    # Employees live anywhere in the company tree, and a user may be granted any
    # set of nodes, so the tenant boundary is sub-tree membership over the union
    # of the caller's GRANTED NODES — a sub-unit grant sees only that unit's tree.
    stmt = apply_employee_tenant_filter(stmt, node_scope, Employee.organization_id)
    if org_node_id is not None:
        # Narrow to the selected unit + its descendants. Intersecting with the
        # tenant sub-tree above means a foreign node id simply yields nothing
        # (no cross-tenant read), so no extra ownership check is required.
        stmt = stmt.where(Employee.organization_id.in_(descendants_subquery(org_node_id)))
    if is_active is not None:
        stmt = stmt.where(Employee.is_active.is_(is_active))
    if search and (term := search.strip()):
        like = f"%{term}%"
        stmt = stmt.where(
            or_(
                Employee.first_name.ilike(like),
                Employee.last_name.ilike(like),
                Employee.employee_code.ilike(like),
                Employee.email.ilike(like),
            )
        )
    return await paginate(db, stmt, pag.page, pag.per_page, EmployeeOut)


@router.get("/org-node-counts", response_model=dict[int, int])
async def employee_counts_by_org_node(
    db: DbSession,
    user: CurrentUser,
    node_scope: TenantNodeScope,
):
    """Direct employee count per org-tree node, for the directory sidebar.

    Keyed by the node the employee is assigned to (no sub-tree roll-up — the
    client owns the tree and sums descendants). Tenant-scoped to the union of
    the caller's granted nodes' sub-trees. Declared before ``/{employee_id}`` so
    the literal path wins over the int path param.
    """
    stmt = select(Employee.organization_id, func.count()).group_by(Employee.organization_id)
    stmt = apply_employee_tenant_filter(stmt, node_scope, Employee.organization_id)
    rows = (await db.execute(stmt)).all()
    return {node_id: count for node_id, count in rows}


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    node_scope: TenantNodeScope,
    user: require_permission("employees.manage"),
):
    # Resolve (and tenant-validate) the org-tree node this employee belongs to.
    # A tenant-scoped caller can never plant an employee outside their company
    # tree (IDOR guard); body.organization_id may name any node within it.
    node_id, root_id = await _resolve_employee_org(db, org_id, body.organization_id)
    # …and, when the caller only holds part of that company, never outside the
    # sub-trees they were granted.
    await _require_node_in_scope(db, node_id, node_scope)

    if body.location_id is not None:
        # Locations are owned by the company root, so validate against it.
        await _require_org_location(db, body.location_id, root_id)

    emp = Employee(
        organization_id=node_id,
        location_id=body.location_id,
        employee_code=body.employee_code,
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        department=body.department,
        job_title=body.job_title,
        hire_date=body.hire_date,
    )
    db.add(emp)
    await db.flush()
    await db.refresh(emp)

    await log_action(
        db,
        user_id=user.id,
        action="employee.created",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(exclude_none=True),
    )

    return EmployeeOut.model_validate(emp, from_attributes=True)


@router.get("/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: int,
    db: DbSession,
    user: CurrentUser,
    node_scope: TenantNodeScope,
):
    emp = await _get_employee_or_404(db, employee_id, node_scope)
    return EmployeeOut.model_validate(emp, from_attributes=True)


@router.put("/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: int,
    body: EmployeeUpdate,
    request: Request,
    db: DbSession,
    node_scope: TenantNodeScope,
    user: require_permission("employees.manage"),
):
    emp = await _get_employee_or_404(db, employee_id, node_scope)

    # The employee's current company root anchors both the re-assignment boundary
    # and location validation below. The FK makes a missing org impossible, but
    # fail clearly rather than silently skipping the tenant checks if it ever is.
    emp_root = await root_id_of(db, emp.organization_id)
    if emp_root is None:
        raise ValidationError("Employee's organization is no longer valid")

    update_data = body.model_dump(exclude_unset=True)
    # Company root used to validate a new location (locations are root-owned).
    effective_root = emp_root

    # Re-assigning the employee to a different org-tree node: the target must
    # stay inside what the caller may manage. A tenant caller is bounded by the
    # sub-trees of their granted nodes; a global super admin is bounded by the
    # employee's current company (no cross-company moves, which would orphan
    # history).
    if "organization_id" in update_data:
        requested = update_data["organization_id"]
        if requested is None:
            # An explicit null means "leave it" — never a NOT NULL violation.
            update_data.pop("organization_id")
        else:
            new_root = await root_id_of(db, requested)
            if new_root is None:
                raise ValidationError("Organization unit not found")
            await _require_node_in_scope(db, requested, node_scope, fallback_root=emp_root)
            effective_root = new_root

    if update_data.get("location_id") is not None:
        await _require_org_location(db, update_data["location_id"], effective_root)
    old_values = {}
    for field, value in update_data.items():
        old_values[field] = getattr(emp, field)
        setattr(emp, field, value)

    await db.flush()
    await db.refresh(emp)

    await log_action(
        db,
        user_id=user.id,
        action="employee.updated",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        old_values=old_values,
        new_values=update_data,
    )

    return EmployeeOut.model_validate(emp, from_attributes=True)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    employee_id: int,
    request: Request,
    db: DbSession,
    node_scope: TenantNodeScope,
    user: require_permission("employees.manage"),
):
    """Deactivate an employee (soft delete).

    A hard delete would cascade into attendance/payroll history, shift
    assignments and leave requests — irreversible destruction from a routine
    admin action. Deactivating preserves the ledger; the privacy-erase
    endpoint exists for genuine GDPR removal. Face vectors are purged from
    the FAISS index either way so the person stops being matchable.
    """
    emp = await _get_employee_or_404(db, employee_id, node_scope)

    await log_action(
        db,
        user_id=user.id,
        action="employee.deleted",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        old_values={"employee_code": emp.employee_code, "name": f"{emp.first_name} {emp.last_name}"},
    )

    await run_in_threadpool(face_service.delete_employee, str(employee_id))
    emp.is_active = False
    emp.face_enrolled = False
    emp.face_enrolled_at = None
    await db.flush()


async def _resolve_employee_org(
    db: DbSession,
    org_id: int | None,
    requested: int | None,
) -> tuple[int, int]:
    """Resolve a new employee's org-tree node and return (node_id, company_root).

    The employee's ``organization_id`` may be the company root OR any descendant
    node (its directory placement). When the caller is tenant-scoped (``org_id``
    set), the chosen node must belong to that tenant; a global super admin may
    target any company. Falls back to the tenant root when no node is supplied.
    """
    if requested is not None:
        root = await root_id_of(db, requested)
        if root is None:
            raise ValidationError("Organization unit not found")
        if org_id is not None and root != org_id:
            raise ValidationError("Organization unit not in this organization")
        return requested, root
    if org_id is None:
        raise ValidationError("Organization context required")
    return org_id, org_id


async def _require_node_in_scope(
    db: DbSession,
    node_id: int,
    node_scope: list[int] | int | None,
    *,
    fallback_root: int | None = None,
) -> None:
    """Reject an org node the caller may not place/move an employee into.

    A tenant caller is bounded by the union of their granted nodes' sub-trees
    (``node_scope``) — they cannot reach a sibling unit they don't hold even
    within their own company. A global super admin (``node_scope`` None) is
    unbounded unless ``fallback_root`` is given, which bounds them to that
    company's sub-tree (used on re-assignment to forbid cross-company moves).
    """
    seed = as_scope_ids(node_scope)  # normalise a single id / list / None
    if seed is None:
        if fallback_root is None:
            return
        seed = [fallback_root]
    allowed = set((await db.execute(descendants_subquery_multi(seed))).scalars().all())
    if node_id not in allowed:
        raise ValidationError("Organization unit not in this organization")


async def _require_org_location(
    db: DbSession,
    location_id: int,
    org_root_id: int | None,
) -> None:
    """Reject a location id that is not in the given company root.

    Locations are owned by the company root (never a sub-node), so callers pass
    the employee's resolved company root. Closes the cross-tenant write where a
    client-supplied location_id could point an employee at another tenant's
    location.
    """
    stmt = select(Location.id).where(Location.id == location_id)
    stmt = apply_tenant_filter(stmt, org_root_id, Location.organization_id)
    if (await db.execute(stmt)).scalar_one_or_none() is None:
        raise ValidationError("Location not found in this organization")


async def _get_employee_or_404(
    db: DbSession,
    employee_id: int,
    node_scope: list[int] | None,
) -> Employee:
    stmt = select(Employee).where(Employee.id == employee_id)
    # Employees may sit on any node in the company tree → sub-tree scoping over
    # the caller's GRANTED NODES (a sub-unit grant sees only that unit's tree).
    stmt = apply_employee_tenant_filter(stmt, node_scope, Employee.organization_id)
    result = await db.execute(stmt)
    emp = result.scalar_one_or_none()
    if emp is None:
        raise NotFoundError("Employee not found")
    return emp
