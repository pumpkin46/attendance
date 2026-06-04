from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError
from app.middleware.tenant import apply_tenant_filter
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.models.notification import Notification
from app.models.recognition import RecognitionEvent
from app.services import face_service
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1", tags=["privacy"])


class PrivacyPolicyResponse(BaseModel):
    gdpr_enabled: bool
    retention_audit_logs_days: int
    retention_recognition_events_days: int
    retention_notifications_days: int
    privacy_contact_email: str | None = None
    data_collected: list[str]
    data_purposes: list[str]


class PrivacyUser(BaseModel):
    id: int
    name: str | None = None
    email: str | None = None


class PrivacyAttendanceRecord(BaseModel):
    work_date: str
    check_in_at: str | None = None
    check_out_at: str | None = None
    status: str | None = None
    worked_minutes: int | None = None


class MyDataExportResponse(BaseModel):
    user: PrivacyUser
    attendance_records: list[PrivacyAttendanceRecord]
    notifications_count: int
    audit_logs_count: int


class PrivacyEraseResponse(BaseModel):
    success: bool
    message: str


@router.get("/privacy/policy", response_model=PrivacyPolicyResponse)
async def get_privacy_policy():
    return {
        "gdpr_enabled": settings.gdpr_enabled,
        "retention_audit_logs_days": settings.retention_audit_logs_days,
        "retention_recognition_events_days": settings.retention_recognition_events_days,
        "retention_notifications_days": settings.retention_notifications_days,
        "privacy_contact_email": settings.privacy_contact_email,
        "data_collected": [
            "Face embeddings (biometric)",
            "Attendance records",
            "RFID card identifiers",
            "Recognition event logs",
        ],
        "data_purposes": [
            "Attendance tracking",
            "Access control",
            "Security monitoring",
        ],
    }


@router.get("/privacy/my-data", response_model=MyDataExportResponse)
async def export_my_data(
    db: DbSession,
    user: CurrentUser,
):
    from app.models.audit import AuditLog

    att_stmt = select(AttendanceRecord).join(
        Employee, AttendanceRecord.employee_id == Employee.id
    ).where(Employee.email == user.email).order_by(AttendanceRecord.id.desc()).limit(500)
    att_result = await db.execute(att_stmt)
    records = att_result.scalars().all()

    notif_stmt = select(Notification).where(
        Notification.user_id == user.id
    ).order_by(Notification.created_at.desc()).limit(200)
    notif_result = await db.execute(notif_stmt)
    notifications = notif_result.scalars().all()

    audit_stmt = select(AuditLog).where(
        AuditLog.user_id == user.id
    ).order_by(AuditLog.id.desc()).limit(200)
    audit_result = await db.execute(audit_stmt)
    audit_logs = audit_result.scalars().all()

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
        "attendance_records": [
            {
                "work_date": str(r.work_date),
                "check_in_at": r.check_in_at.isoformat() if r.check_in_at else None,
                "check_out_at": r.check_out_at.isoformat() if r.check_out_at else None,
                "status": r.status,
                "worked_minutes": r.worked_minutes,
            }
            for r in records
        ],
        "notifications_count": len(list(notifications)),
        "audit_logs_count": len(list(audit_logs)),
    }


@router.post("/employees/{employee_id}/privacy/erase", response_model=PrivacyEraseResponse)
async def erase_employee_data(
    employee_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    stmt = select(Employee).where(Employee.id == employee_id)
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    result = await db.execute(stmt)
    emp = result.scalar_one_or_none()
    if not emp:
        raise NotFoundError("Employee not found")

    await run_in_threadpool(face_service.delete_employee, str(employee_id))

    rec_stmt = select(RecognitionEvent).where(RecognitionEvent.employee_id == employee_id)
    rec_result = await db.execute(rec_stmt)
    for event in rec_result.scalars().all():
        event.employee_id = None
        event.snapshot_path = None

    att_stmt = select(AttendanceRecord).where(AttendanceRecord.employee_id == employee_id)
    att_result = await db.execute(att_stmt)
    for record in att_result.scalars().all():
        await db.delete(record)

    emp.face_enrolled = False
    emp.face_enrolled_at = None
    emp.first_name = "ERASED"
    emp.last_name = "ERASED"
    emp.email = None
    emp.is_active = False

    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="employee.privacy_erased",
        entity_type="employee",
        entity_id=employee_id,
        ip_address=request.client.host if request.client else None,
    )

    return PrivacyEraseResponse(
        success=True, message=f"Employee {employee_id} data erased"
    )
