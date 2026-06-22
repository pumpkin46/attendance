"""attendance_range_report node-granular scoping.

The export's employee filter must honour the GRANTED node scope: a sub-unit
grant (e.g. one hotel inside a company) sees only that sub-tree's employee
attendance, never a sibling unit's. The ``org_id`` argument stays the company
root (used by the router only for the export header's org-name lookup); the
new ``node_scope`` keyword overrides the employee filter.

Tree built here:

    Acme (company root)
    ├── HotelA (sub-unit)      <- granted to the scoped admin
    │   └── FrontDesk          <- descendant of HotelA
    └── HotelB (sub-unit)      <- must be excluded
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.schemas.organization import OrganizationCreate, OrgNodeCreate
from app.services import organization_service as svc
from app.services import report_service

GLOBAL = None  # tenant_org_id None == global super admin while building


async def _root(db, name, code):
    return await svc.create_organization(
        db, OrganizationCreate(name=name, code=code), is_super_admin=True
    )


async def _node(db, parent, name, code):
    return await svc.create_node(
        db, GLOBAL, OrgNodeCreate(parent_id=parent.id, name=name, code=code, node_type="department")
    )


async def _employee(db, *, org_id, code):
    emp = Employee(organization_id=org_id, employee_code=code, first_name="T", last_name=code)
    db.add(emp)
    await db.flush()
    return emp


async def _attendance(db, *, employee_id, work_date):
    rec = AttendanceRecord(
        employee_id=employee_id,
        work_date=work_date,
        status="present",
        attendance_type="regular",
        check_in_at=datetime(work_date.year, work_date.month, work_date.day, 9, tzinfo=timezone.utc),
        check_out_at=datetime(work_date.year, work_date.month, work_date.day, 17, tzinfo=timezone.utc),
        worked_minutes=480,
        overtime_minutes=0,
    )
    db.add(rec)
    await db.flush()
    return rec


async def test_attendance_range_report_is_node_granular(db_session):
    db = db_session
    acme = await _root(db, "Acme", "ACME")
    hotel_a = await _node(db, acme, "HotelA", "HA")
    front_desk = await _node(db, hotel_a, "FrontDesk", "FD")  # descendant of HotelA
    hotel_b = await _node(db, acme, "HotelB", "HB")

    # Employees: one directly in HotelA, one in HotelA's descendant FrontDesk,
    # one in the sibling HotelB.
    emp_a = await _employee(db, org_id=hotel_a.id, code="A1")
    emp_fd = await _employee(db, org_id=front_desk.id, code="FD1")
    emp_b = await _employee(db, org_id=hotel_b.id, code="B1")

    start, end = date(2026, 6, 1), date(2026, 6, 30)
    work_day = date(2026, 6, 15)
    await _attendance(db, employee_id=emp_a.id, work_date=work_day)
    await _attendance(db, employee_id=emp_fd.id, work_date=work_day)
    await _attendance(db, employee_id=emp_b.id, work_date=work_day)

    # Scoped to the HotelA sub-tree: HotelA + FrontDesk attendance only,
    # HotelB excluded. org_id stays the company root (header lookup).
    report = await report_service.attendance_range_report(
        db, org_id=acme.id, start=start, end=end, node_scope=[hotel_a.id]
    )
    codes = {e.employee_code for e in report.entries}
    assert codes == {"A1", "FD1"}
    assert "B1" not in codes
    assert report.total_records == 2
    assert report.present == 2

    # Sanity: without a node scope the company-root org_id sees the whole company.
    full = await report_service.attendance_range_report(
        db, org_id=acme.id, start=start, end=end
    )
    assert {e.employee_code for e in full.entries} == {"A1", "FD1", "B1"}
    assert full.total_records == 3
