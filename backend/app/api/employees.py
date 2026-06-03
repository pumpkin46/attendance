from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginationDep, paginate
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1/employees", tags=["employees"])


@router.get("", response_model=dict)
async def list_employees(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pag: PaginationDep,
):
    stmt = select(Employee).order_by(Employee.last_name, Employee.first_name)
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
    effective_org_id = body.organization_id or org_id
    if effective_org_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization context required",
        )

    emp = Employee(
        organization_id=effective_org_id,
        location_id=body.location_id,
        branch_id=body.branch_id,
        department_id=body.department_id,
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

    old_values = {}
    update_data = body.model_dump(exclude_unset=True)
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

    await db.delete(emp)
    await db.flush()


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return emp
