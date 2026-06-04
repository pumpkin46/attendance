"""Face Enrollment API — endpoints for the complete enrollment workflow.

Supports:
- Employee Enrollment
- Visitor Enrollment
- Contractor Enrollment
- Temporary Staff Enrollment
- Re-Enrollment
- Bulk Enrollment
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.face import FaceEmbedding, FaceEnrollmentImage, FaceEnrollmentSession
from app.services.audit_service import log_action
from app.services.enrollment_scoring import EnrollmentStatus
from app.services.enrollment_service import (
    EnrollmentMethod,
    EnrollmentType,
    FaceEnrollmentService,
    ReEnrollmentTrigger,
    get_enrollment_service,
)
from app.services.face_pose import POSE_LABELS

router = APIRouter(prefix="/api/v1", tags=["enrollment"])


# ── Request / Response Schemas ───────────────────────────────────────────────


class EnrollmentConfigResponse(BaseModel):
    mode: str
    required_poses: list[str]
    pose_labels: dict[str, str]
    min_images: int
    max_images: int
    retain_raw_images: bool
    quality_thresholds: dict[str, float]


class ValidateImageRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image")
    expected_pose: str | None = None


class SingleEnrollRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image")


class BatchEnrollRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, description="Base64-encoded images")
    enrollment_method: str = "image_upload"
    expected_poses: list[str | None] | None = None


class StructuredEnrollRequest(BaseModel):
    poses: dict[str, str] = Field(
        ..., description="Map of pose_type -> base64 image"
    )


class FullEnrollRequest(BaseModel):
    images: list[str] = Field(..., min_length=10, description="Base64-encoded images (min 10)")
    enrollment_type: str = "employee"
    enrollment_method: str = "image_upload"
    expected_poses: list[str | None] | None = None
    capture_metadata: list[dict] | None = None


class ReEnrollRequest(BaseModel):
    images: list[str] = Field(..., min_length=10, description="Base64-encoded images (min 10)")
    trigger: str = "manual"
    enrollment_method: str = "image_upload"
    expected_poses: list[str | None] | None = None


class BulkEnrollItem(BaseModel):
    employee_id: int
    images: list[str] = Field(..., min_length=10)
    expected_poses: list[str | None] | None = None


class BulkEnrollRequest(BaseModel):
    employees: list[BulkEnrollItem] = Field(..., min_length=1)
    enrollment_method: str = "image_upload"


class FaceStatusResponse(BaseModel):
    employee_id: int
    face_enrolled: bool
    face_enrolled_at: datetime | None = None
    face_enrollment_score: float | None = None
    embedding_count: int = 0
    poses_enrolled: list[str] = []
    enrollment_status: str | None = None


class FaceMetadataResponse(BaseModel):
    capture_device: str | None = None
    capture_time: str | None = None
    yaw: float | None = None
    pitch: float | None = None
    roll: float | None = None
    quality_score: float | None = None
    lighting_score: float | None = None
    sharpness_score: float | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/enrollment/config", response_model=EnrollmentConfigResponse)
async def enrollment_config(user: CurrentUser):
    """Get enrollment configuration and requirements."""
    required_poses = [
        p.strip()
        for p in settings.face_enrollment_required_poses.split(",")
        if p.strip()
    ]
    return EnrollmentConfigResponse(
        mode=settings.face_enrollment_mode,
        required_poses=required_poses,
        pose_labels={p: POSE_LABELS.get(p, p.replace("_", " ").title()) for p in required_poses},
        min_images=settings.face_enrollment_min_images,
        max_images=settings.face_enrollment_max_images,
        retain_raw_images=settings.face_enrollment_retain_raw_images,
        quality_thresholds={
            "min_det_score": settings.quality_min_det_score,
            "min_blur_score": settings.quality_min_blur_score,
            "min_brightness_score": settings.quality_min_brightness_score,
            "min_overall_score": settings.quality_min_overall_score,
        },
    )


@router.get("/enrollment/requirements")
async def enrollment_requirements(user: CurrentUser):
    """Get detailed enrollment quality requirements and approval rules."""
    service = get_enrollment_service()
    return service.get_enrollment_quality_requirements()


@router.post("/enrollment/validate-image")
async def validate_image(body: ValidateImageRequest, user: CurrentUser):
    """Validate a single image quality without storing (live preview)."""
    service = get_enrollment_service()
    return service.validate_single_image(body.image, body.expected_pose)


@router.post("/employees/{employee_id}/enroll-face")
async def enroll_face_single(
    employee_id: int,
    body: SingleEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Enroll a single face image (quick enrollment)."""
    from app.services import face_service

    emp = await _get_employee_or_404(db, employee_id, org_id)
    result = face_service.enroll(str(emp.id), body.image)

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.get("error", "Enrollment failed"),
        )

    await _save_enrollment(
        db, emp, result,
        embeddings_info=[{
            "faiss_id": result.get("faiss_id"),
            "quality_score": result.get("quality_score"),
        }],
    )

    await log_action(
        db,
        user_id=user.id,
        action="face.enrolled",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        new_values={"method": "single", "faiss_id": result.get("faiss_id")},
    )

    return result


@router.post("/employees/{employee_id}/enroll-face-batch")
async def enroll_face_batch(
    employee_id: int,
    body: BatchEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Batch enroll with 10+ face images and quality validation."""
    from app.services import face_service

    emp = await _get_employee_or_404(db, employee_id, org_id)
    result = face_service.enroll_batch(str(emp.id), body.images)

    if not result.get("success"):
        return result

    embeddings_info = [
        {"faiss_id": fid, "quality_score": result.get("average_quality_score")}
        for fid in (result.get("faiss_ids") or [])
    ]
    await _save_enrollment(db, emp, result, embeddings_info=embeddings_info)

    await log_action(
        db,
        user_id=user.id,
        action="face.enrolled_batch",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        new_values={
            "method": "batch",
            "embeddings_stored": result.get("embeddings_stored"),
        },
    )

    return result


@router.post("/employees/{employee_id}/enroll-face-structured")
async def enroll_face_structured(
    employee_id: int,
    body: StructuredEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Structured enrollment with required pose slots."""
    from app.services import face_service

    emp = await _get_employee_or_404(db, employee_id, org_id)
    result = face_service.enroll_structured(str(emp.id), body.poses)

    if not result.get("success"):
        return result

    embeddings_info = []
    for i, fid in enumerate(result.get("faiss_ids") or []):
        accepted = result.get("accepted") or []
        pose_type = accepted[i].get("pose_type") if i < len(accepted) else None
        quality = accepted[i].get("quality_score") if i < len(accepted) else None
        embeddings_info.append({
            "faiss_id": fid,
            "pose_type": pose_type,
            "quality_score": quality,
        })

    await _save_enrollment(
        db, emp, result,
        embeddings_info=embeddings_info,
        enrollment_score=result.get("enrollment_score"),
    )

    await log_action(
        db,
        user_id=user.id,
        action="face.enrolled_structured",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
        new_values={
            "method": "structured",
            "embeddings_stored": result.get("embeddings_stored"),
            "enrollment_score": result.get("enrollment_score"),
        },
    )

    return result


@router.post("/employees/{employee_id}/enroll-face-full")
async def enroll_face_full(
    employee_id: int,
    body: FullEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Full enrollment workflow with scoring, diversity analysis, and approval."""
    emp = await _get_employee_or_404(db, employee_id, org_id)
    service = get_enrollment_service()

    try:
        e_type = EnrollmentType(body.enrollment_type)
    except ValueError:
        e_type = EnrollmentType.EMPLOYEE

    try:
        e_method = EnrollmentMethod(body.enrollment_method)
    except ValueError:
        e_method = EnrollmentMethod.IMAGE_UPLOAD

    result = service.enroll(
        str(emp.id),
        body.images,
        enrollment_type=e_type,
        enrollment_method=e_method,
        expected_poses=body.expected_poses,
        capture_metadata=body.capture_metadata,
    )

    if result.success:
        enrollment_score_val = (
            result.enrollment_score.overall_score / 100.0
            if result.enrollment_score
            else None
        )
        await _save_enrollment(
            db, emp, result.to_dict(),
            embeddings_info=[
                {"faiss_id": fid, "quality_score": None}
                for fid in result.faiss_ids
            ],
            enrollment_score=enrollment_score_val,
        )

        session = FaceEnrollmentSession(
            employee_id=emp.id,
            image_count=len(result.accepted_images),
            average_quality_score=result.metadata.get("average_quality_score"),
            enrollment_score=enrollment_score_val,
            enrollment_mode="full",
        )
        db.add(session)
        await db.flush()

        for img_result in result.accepted_images:
            img_record = FaceEnrollmentImage(
                face_enrollment_session_id=session.id,
                image_index=img_result.index,
                pose_type=img_result.pose_type,
                quality_score=img_result.quality_score,
                validation_checks=img_result.checks,
                face_metadata=img_result.face_metadata,
            )
            db.add(img_record)

        await db.flush()

        await log_action(
            db,
            user_id=user.id,
            action="face.enrolled_full",
            entity_type="employee",
            entity_id=emp.id,
            ip_address=request.client.host if request.client else None,
            new_values={
                "method": "full",
                "embeddings_stored": result.embeddings_stored,
                "enrollment_score": enrollment_score_val,
                "enrollment_status": (
                    result.enrollment_score.status.value if result.enrollment_score else None
                ),
            },
        )

    return result.to_dict()


@router.post("/employees/{employee_id}/re-enroll")
async def re_enroll_face(
    employee_id: int,
    body: ReEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Re-enroll an employee (replaces existing face data)."""
    emp = await _get_employee_or_404(db, employee_id, org_id)
    service = get_enrollment_service()

    try:
        trigger = ReEnrollmentTrigger(body.trigger)
    except ValueError:
        trigger = ReEnrollmentTrigger.MANUAL

    try:
        e_method = EnrollmentMethod(body.enrollment_method)
    except ValueError:
        e_method = EnrollmentMethod.IMAGE_UPLOAD

    result = service.re_enroll(
        str(emp.id),
        body.images,
        trigger=trigger,
        enrollment_method=e_method,
        expected_poses=body.expected_poses,
    )

    if result.success:
        enrollment_score_val = (
            result.enrollment_score.overall_score / 100.0
            if result.enrollment_score
            else None
        )
        await _save_enrollment(
            db, emp, result.to_dict(),
            embeddings_info=[
                {"faiss_id": fid, "quality_score": None}
                for fid in result.faiss_ids
            ],
            enrollment_score=enrollment_score_val,
        )

        await log_action(
            db,
            user_id=user.id,
            action="face.re_enrolled",
            entity_type="employee",
            entity_id=emp.id,
            ip_address=request.client.host if request.client else None,
            new_values={
                "trigger": trigger.value,
                "embeddings_stored": result.embeddings_stored,
            },
        )

    return result.to_dict()


@router.post("/employees/bulk-enroll")
async def bulk_enroll(
    body: BulkEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Bulk enroll multiple employees at once."""
    service = get_enrollment_service()

    try:
        e_method = EnrollmentMethod(body.enrollment_method)
    except ValueError:
        e_method = EnrollmentMethod.IMAGE_UPLOAD

    results: list[dict] = []
    for item in body.employees:
        emp = await _get_employee_or_none(db, item.employee_id, org_id)
        if emp is None:
            results.append({
                "employee_id": item.employee_id,
                "success": False,
                "error": "Employee not found",
            })
            continue

        result = service.enroll(
            str(emp.id),
            item.images,
            enrollment_type=EnrollmentType.BULK,
            enrollment_method=e_method,
            expected_poses=item.expected_poses,
        )

        if result.success:
            enrollment_score_val = (
                result.enrollment_score.overall_score / 100.0
                if result.enrollment_score
                else None
            )
            await _save_enrollment(
                db, emp, result.to_dict(),
                embeddings_info=[
                    {"faiss_id": fid, "quality_score": None}
                    for fid in result.faiss_ids
                ],
                enrollment_score=enrollment_score_val,
            )

        results.append(result.to_dict())

    await log_action(
        db,
        user_id=user.id,
        action="face.bulk_enrolled",
        entity_type="employee",
        entity_id=None,
        ip_address=request.client.host if request.client else None,
        new_values={
            "employee_count": len(body.employees),
            "success_count": sum(1 for r in results if r.get("success")),
        },
    )

    return {
        "total": len(results),
        "success_count": sum(1 for r in results if r.get("success")),
        "failure_count": sum(1 for r in results if not r.get("success")),
        "results": results,
    }


@router.get("/employees/{employee_id}/face-status", response_model=FaceStatusResponse)
async def face_status(
    employee_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    """Get enrollment status and face data summary for an employee."""
    emp = await _get_employee_or_404(db, employee_id, org_id)

    stmt = (
        select(FaceEmbedding)
        .where(FaceEmbedding.employee_id == emp.id, FaceEmbedding.is_active == True)  # noqa: E712
    )
    result = await db.execute(stmt)
    embeddings = list(result.scalars().all())

    poses_enrolled = [
        e.pose_type for e in embeddings if e.pose_type is not None
    ]

    enrollment_score = getattr(emp, "face_enrollment_score", None)
    if enrollment_score is not None and enrollment_score >= 0.9:
        e_status = "excellent"
    elif enrollment_score is not None and enrollment_score >= 0.8:
        e_status = "good"
    elif enrollment_score is not None and enrollment_score >= 0.7:
        e_status = "acceptable"
    elif enrollment_score is not None:
        e_status = "re_enroll_required"
    else:
        e_status = None

    return FaceStatusResponse(
        employee_id=emp.id,
        face_enrolled=emp.face_enrolled,
        face_enrolled_at=emp.face_enrolled_at,
        face_enrollment_score=enrollment_score,
        embedding_count=len(embeddings),
        poses_enrolled=poses_enrolled,
        enrollment_status=e_status,
    )


@router.delete("/employees/{employee_id}/face-enrollment")
async def delete_face_enrollment(
    employee_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
    """Delete all face enrollment data for an employee."""
    emp = await _get_employee_or_404(db, employee_id, org_id)
    service = get_enrollment_service()
    service.delete_enrollment(str(emp.id))

    emp.face_enrolled = False
    emp.face_enrolled_at = None

    stmt = select(FaceEmbedding).where(FaceEmbedding.employee_id == emp.id)
    result = await db.execute(stmt)
    for emb in result.scalars().all():
        emb.is_active = False

    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="face.deleted",
        entity_type="employee",
        entity_id=emp.id,
        ip_address=request.client.host if request.client else None,
    )

    return {"success": True, "employee_id": employee_id}


# ── Helpers ──────────────────────────────────────────────────────────────────


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found"
        )
    return emp


async def _get_employee_or_none(
    db: DbSession,
    employee_id: int,
    org_id: int | None,
) -> Employee | None:
    stmt = select(Employee).where(Employee.id == employee_id)
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _save_enrollment(
    db: DbSession,
    emp: Employee,
    result: dict[str, Any],
    embeddings_info: list[dict[str, Any]],
    enrollment_score: float | None = None,
) -> None:
    """Update employee face status and persist FaceEmbedding records."""
    emp.face_enrolled = True
    emp.face_enrolled_at = datetime.now(timezone.utc)
    if enrollment_score is not None:
        emp.face_enrollment_score = enrollment_score
    elif result.get("average_quality_score") is not None:
        emp.face_enrollment_score = result["average_quality_score"]

    for info in embeddings_info:
        record = FaceEmbedding(
            employee_id=emp.id,
            faiss_id=info.get("faiss_id"),
            pose_type=info.get("pose_type"),
            quality_score=info.get("quality_score"),
            is_active=True,
        )
        db.add(record)

    await db.flush()
