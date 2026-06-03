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
from app.models.face import FaceEmbedding
from app.services import face_service
from app.services.audit_service import log_action
from app.services.face_pose import POSE_LABELS

router = APIRouter(prefix="/api/v1", tags=["enrollment"])


# ── Request / Response schemas ──────────────────────────────────────────────

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


class StructuredEnrollRequest(BaseModel):
    poses: dict[str, str] = Field(
        ..., description="Map of pose_type -> base64 image"
    )


class FaceStatusResponse(BaseModel):
    employee_id: int
    face_enrolled: bool
    face_enrolled_at: datetime | None = None
    face_enrollment_score: float | None = None
    embedding_count: int = 0
    poses_enrolled: list[str] = []


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/enrollment/config", response_model=EnrollmentConfigResponse)
async def enrollment_config(user: CurrentUser):
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


@router.post("/enrollment/validate-image")
async def validate_image(body: ValidateImageRequest, user: CurrentUser):
    result = face_service.validate_image(body.image, body.expected_pose)
    return result


@router.post("/employees/{employee_id}/enroll-face")
async def enroll_face_single(
    employee_id: int,
    body: SingleEnrollRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("employees.manage"),
):
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


@router.get("/employees/{employee_id}/face-status", response_model=FaceStatusResponse)
async def face_status(
    employee_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
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

    return FaceStatusResponse(
        employee_id=emp.id,
        face_enrolled=emp.face_enrolled,
        face_enrolled_at=emp.face_enrolled_at,
        face_enrollment_score=emp.face_enrollment_score,
        embedding_count=len(embeddings),
        poses_enrolled=poses_enrolled,
    )


# ── Helpers ─────────────────────────────────────────────────────────────────

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
