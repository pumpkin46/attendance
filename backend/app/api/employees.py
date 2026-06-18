from __future__ import annotations

from fastapi import APIRouter, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.middleware.tenant import apply_tenant_filter
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
    org_id: TenantOrgId,
    pag: PaginationDep,
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
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    return await paginate(db, stmt, pag.page, pag.per_page, EmployeeOut)


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    # Tenant context wins over the request body — a tenant-scoped caller can
    # never plant an employee in another organization (IDOR guard).
    effective_org_id = org_id if org_id is not None else body.organization_id
    if effective_org_id is None:
        raise ValidationError("Organization context required")

    if body.location_id is not None:
        await _require_org_location(db, body.location_id, effective_org_id)

    emp = Employee(
        organization_id=effective_org_id,
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
    org_id: TenantOrgId,
):
    emp = await _get_employee_or_404(db, employee_id, org_id)
    return EmployeeOut.model_validate(emp, from_attributes=True)


@router.put("/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: int,
    body: EmployeeUpdate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    emp = await _get_employee_or_404(db, employee_id, org_id)

    update_data = body.model_dump(exclude_unset=True)
    if update_data.get("location_id") is not None:
        # Validate against the employee's own org so a foreign location can't be
        # planted, even for a super-admin caller (org_id is None).
        await _require_org_location(db, update_data["location_id"], emp.organization_id)
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
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Deactivate an employee (soft delete).

    A hard delete would cascade into attendance/payroll history, shift
    assignments and leave requests — irreversible destruction from a routine
    admin action. Deactivating preserves the ledger; the privacy-erase
    endpoint exists for genuine GDPR removal. Face vectors are purged from
    the FAISS index either way so the person stops being matchable.
    """
    emp = await _get_employee_or_404(db, employee_id, org_id)

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


async def _require_org_location(
    db: DbSession,
    location_id: int,
    org_id: int | None,
) -> None:
    """Reject a location id that is not in the given organization.

    Closes the cross-tenant write where a client-supplied location_id could
    point an employee at another tenant's location.
    """
    stmt = select(Location.id).where(Location.id == location_id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    if (await db.execute(stmt)).scalar_one_or_none() is None:
        raise ValidationError("Location not found in this organization")


async def _get_employee_or_404(
    db: DbSession,
    employee_id: int,
    org_id: int | None,
) -> Employee:
    stmt = select(Employee).where(Employee.id == employee_id)
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    result = await db.execute(stmt)
    emp = result.scalar_one_or_none()
    if emp is None:
        raise NotFoundError("Employee not found")
    return emp
