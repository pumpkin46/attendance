"""Face Enrollment Service — orchestrates the complete enrollment workflow.

Enrollment Process:
1. Identity Verification
2. Capture Face Images
3. Face Quality Validation
4. Image Processing (alignment, cropping, enhancement)
5. Embedding Generation
6. Enrollment Scoring
7. Store Face Templates
8. Enrollment Approval
"""

from __future__ import annotations

import base64
import io
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import cv2
import numpy as np
from PIL import Image

from app.core.config import settings
from app.services.enrollment_scoring import (
    EnrollmentScorer,
    EnrollmentScore,
    EnrollmentStatus,
    MIN_IMAGES,
    get_enrollment_scorer,
)
from app.services.face_image_processor import FaceImageProcessor, get_face_image_processor
from app.services.face_quality import validate_face_image
from app.services.faiss_index import FaissIndex

logger = logging.getLogger(__name__)


class EnrollmentMethod(str, Enum):
    WEBCAM = "webcam"
    MOBILE = "mobile"
    IMAGE_UPLOAD = "image_upload"
    KIOSK = "kiosk"


class EnrollmentType(str, Enum):
    EMPLOYEE = "employee"
    VISITOR = "visitor"
    CONTRACTOR = "contractor"
    TEMPORARY_STAFF = "temporary_staff"
    RE_ENROLLMENT = "re_enrollment"
    BULK = "bulk"


class ReEnrollmentTrigger(str, Enum):
    ACCURACY_DROP = "recognition_accuracy_drops"
    APPEARANCE_CHANGE = "employee_appearance_changes"
    TEMPLATE_OUTDATED = "face_template_outdated"
    POOR_SCORE = "poor_enrollment_score"
    MANUAL = "manual"
    SCHEDULED = "scheduled"


SUPPORTED_IMAGE_FORMATS = {"jpg", "jpeg", "png", "webp"}
MIN_RESOLUTION = (640, 480)
RECOMMENDED_RESOLUTION = (1280, 720)


@dataclass
class EnrollmentImageResult:
    index: int
    accepted: bool
    quality_score: float
    pose_type: str | None = None
    checks: dict = field(default_factory=dict)
    face_metadata: dict | None = None
    rejection_reason: str | None = None
    embedding_dim: int | None = None


@dataclass
class EnrollmentResult:
    success: bool
    employee_id: str
    enrollment_type: EnrollmentType
    enrollment_method: EnrollmentMethod
    embeddings_stored: int = 0
    faiss_ids: list[str] = field(default_factory=list)
    enrollment_score: EnrollmentScore | None = None
    accepted_images: list[EnrollmentImageResult] = field(default_factory=list)
    rejected_images: list[EnrollmentImageResult] = field(default_factory=list)
    processing_ms: int = 0
    error: str | None = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        result: dict[str, Any] = {
            "success": self.success,
            "employee_id": self.employee_id,
            "enrollment_type": self.enrollment_type.value,
            "enrollment_method": self.enrollment_method.value,
            "embeddings_stored": self.embeddings_stored,
            "faiss_ids": self.faiss_ids,
            "accepted_count": len(self.accepted_images),
            "rejected_count": len(self.rejected_images),
            "processing_ms": self.processing_ms,
        }
        if self.enrollment_score:
            result["enrollment_score"] = self.enrollment_score.to_dict()
        if self.error:
            result["error"] = self.error
        if self.metadata:
            result["metadata"] = self.metadata
        return result


class FaceEnrollmentService:
    """Orchestrates the full face enrollment pipeline."""

    def __init__(
        self,
        index: FaissIndex | None = None,
        processor: FaceImageProcessor | None = None,
        scorer: EnrollmentScorer | None = None,
    ) -> None:
        self._index = index
        self._processor = processor or get_face_image_processor()
        self._scorer = scorer or get_enrollment_scorer()
        self._face_app = None

    @property
    def index(self) -> FaissIndex:
        if self._index is None:
            from app.services.face_service import get_index
            self._index = get_index()
        return self._index

    def enroll(
        self,
        employee_id: str,
        images_b64: list[str],
        *,
        enrollment_type: EnrollmentType = EnrollmentType.EMPLOYEE,
        enrollment_method: EnrollmentMethod = EnrollmentMethod.IMAGE_UPLOAD,
        expected_poses: list[str | None] | None = None,
        capture_metadata: list[dict] | None = None,
    ) -> EnrollmentResult:
        """Execute the full enrollment workflow."""
        start = time.perf_counter()

        if len(images_b64) < MIN_IMAGES:
            return EnrollmentResult(
                success=False,
                employee_id=employee_id,
                enrollment_type=enrollment_type,
                enrollment_method=enrollment_method,
                error=f"Minimum {MIN_IMAGES} images required, got {len(images_b64)}",
                processing_ms=int((time.perf_counter() - start) * 1000),
            )

        max_images = settings.face_enrollment_max_images
        if len(images_b64) > max_images:
            return EnrollmentResult(
                success=False,
                employee_id=employee_id,
                enrollment_type=enrollment_type,
                enrollment_method=enrollment_method,
                error=f"Maximum {max_images} images allowed, got {len(images_b64)}",
                processing_ms=int((time.perf_counter() - start) * 1000),
            )

        accepted: list[EnrollmentImageResult] = []
        rejected: list[EnrollmentImageResult] = []
        embeddings: list[np.ndarray] = []
        accepted_dicts: list[dict] = []

        for i, image_b64 in enumerate(images_b64):
            expected_pose = (
                expected_poses[i] if expected_poses and i < len(expected_poses) else None
            )
            meta = (
                capture_metadata[i] if capture_metadata and i < len(capture_metadata) else None
            )

            result = self._process_single_image(
                image_b64, employee_id, i, expected_pose, meta
            )

            if result.accepted:
                accepted.append(result)
                accepted_dicts.append({
                    "index": result.index,
                    "quality_score": result.quality_score,
                    "pose_type": result.pose_type,
                    "checks": result.checks,
                    "face_metadata": result.face_metadata,
                })
            else:
                rejected.append(result)

        if len(accepted) < MIN_IMAGES:
            return EnrollmentResult(
                success=False,
                employee_id=employee_id,
                enrollment_type=enrollment_type,
                enrollment_method=enrollment_method,
                accepted_images=accepted,
                rejected_images=rejected,
                error=f"Only {len(accepted)} images passed validation; minimum {MIN_IMAGES} required",
                processing_ms=int((time.perf_counter() - start) * 1000),
            )

        for result_item in accepted:
            embedding = self._generate_embedding(
                images_b64[result_item.index], employee_id, result_item.index
            )
            if embedding is not None:
                embeddings.append(embedding)
                result_item.embedding_dim = int(embedding.shape[0])

        if len(embeddings) < MIN_IMAGES:
            return EnrollmentResult(
                success=False,
                employee_id=employee_id,
                enrollment_type=enrollment_type,
                enrollment_method=enrollment_method,
                accepted_images=accepted,
                rejected_images=rejected,
                error=f"Only {len(embeddings)} embeddings generated; minimum {MIN_IMAGES} required",
                processing_ms=int((time.perf_counter() - start) * 1000),
            )

        enrollment_score = self._scorer.score(accepted_dicts)

        faiss_ids = self.index.add_batch(employee_id, embeddings)
        processing_ms = int((time.perf_counter() - start) * 1000)

        return EnrollmentResult(
            success=True,
            employee_id=employee_id,
            enrollment_type=enrollment_type,
            enrollment_method=enrollment_method,
            embeddings_stored=len(faiss_ids),
            faiss_ids=[str(fid) for fid in faiss_ids],
            enrollment_score=enrollment_score,
            accepted_images=accepted,
            rejected_images=rejected,
            processing_ms=processing_ms,
            metadata={
                "average_quality_score": round(
                    sum(a.quality_score for a in accepted) / len(accepted), 4
                ),
                "pose_coverage": list({
                    a.pose_type for a in accepted if a.pose_type
                }),
            },
        )

    def validate_single_image(
        self,
        image_b64: str,
        expected_pose: str | None = None,
    ) -> dict:
        """Validate a single image without storing (for live preview)."""
        start = time.perf_counter()
        img = self._decode_image(image_b64)
        if img is None:
            return {
                "accepted": False,
                "reason": "invalid_image",
                "quality_score": 0.0,
                "checks": {"resolution_valid": False},
                "processing_ms": int((time.perf_counter() - start) * 1000),
            }

        h, w = img.shape[:2]
        resolution_valid = w >= MIN_RESOLUTION[0] and h >= MIN_RESOLUTION[1]

        if not resolution_valid:
            return {
                "accepted": False,
                "reason": "low_resolution",
                "quality_score": 0.0,
                "checks": {
                    "resolution_valid": False,
                    "image_width": w,
                    "image_height": h,
                    "min_width": MIN_RESOLUTION[0],
                    "min_height": MIN_RESOLUTION[1],
                },
                "processing_ms": int((time.perf_counter() - start) * 1000),
            }

        faces = self._detect_faces(img)
        if faces is None:
            result = {
                "accepted": True,
                "reason": None,
                "quality_score": 0.85,
                "checks": {
                    "mode": "mock",
                    "resolution_valid": resolution_valid,
                    "image_width": w,
                    "image_height": h,
                },
                "face_metadata": {"detected_pose": expected_pose, "mode": "mock"},
                "processing_ms": int((time.perf_counter() - start) * 1000),
            }
            return result

        result = validate_face_image(img, faces, expected_pose=expected_pose)
        result["checks"] = result.get("checks", {})
        result["checks"]["resolution_valid"] = resolution_valid
        result["checks"]["image_width"] = w
        result["checks"]["image_height"] = h
        result["processing_ms"] = int((time.perf_counter() - start) * 1000)

        if not resolution_valid and result.get("accepted"):
            result["accepted"] = False
            result["reason"] = "low_resolution"

        return result

    def re_enroll(
        self,
        employee_id: str,
        images_b64: list[str],
        *,
        trigger: ReEnrollmentTrigger = ReEnrollmentTrigger.MANUAL,
        enrollment_method: EnrollmentMethod = EnrollmentMethod.IMAGE_UPLOAD,
        expected_poses: list[str | None] | None = None,
    ) -> EnrollmentResult:
        """Re-enroll an employee (removes existing embeddings first)."""
        self.index.remove_employee(employee_id)
        logger.info("Re-enrollment triggered for %s (reason: %s)", employee_id, trigger.value)

        result = self.enroll(
            employee_id,
            images_b64,
            enrollment_type=EnrollmentType.RE_ENROLLMENT,
            enrollment_method=enrollment_method,
            expected_poses=expected_poses,
        )
        result.metadata["re_enrollment_trigger"] = trigger.value
        return result

    def delete_enrollment(self, employee_id: str) -> dict:
        """Remove all face data for an employee."""
        self.index.remove_employee(employee_id)
        return {"success": True, "employee_id": employee_id}

    def get_enrollment_quality_requirements(self) -> dict:
        """Return enrollment requirements and thresholds."""
        return {
            "min_images": MIN_IMAGES,
            "recommended_images": {"min": 20, "max": 30},
            "min_resolution": {"width": MIN_RESOLUTION[0], "height": MIN_RESOLUTION[1]},
            "recommended_resolution": {
                "width": RECOMMENDED_RESOLUTION[0],
                "height": RECOMMENDED_RESOLUTION[1],
            },
            "supported_formats": list(SUPPORTED_IMAGE_FORMATS),
            "required_poses": ["front", "left", "right", "up", "down"],
            "optional_poses": ["smiling", "neutral", "glasses", "without_glasses"],
            "quality_thresholds": {
                "min_det_score": settings.quality_min_det_score,
                "min_blur_score": settings.quality_min_blur_score,
                "min_brightness_score": settings.quality_min_brightness_score,
                "min_overall_score": settings.quality_min_overall_score,
            },
            "enrollment_approval_rules": {
                "90-100": "Excellent",
                "80-89": "Good",
                "70-79": "Acceptable",
                "<70": "Re-Enroll Required",
            },
            "pose_validation": {
                "yaw_range": "±45°",
                "pitch_range": "±30°",
                "roll_range": "±30°",
            },
            "embedding": {
                "dimension": settings.embedding_dim,
                "model": "ArcFace/InsightFace",
                "normalized": True,
            },
        }

    def _process_single_image(
        self,
        image_b64: str,
        employee_id: str,
        index: int,
        expected_pose: str | None,
        capture_metadata: dict | None,
    ) -> EnrollmentImageResult:
        """Validate and process a single enrollment image."""
        img = self._decode_image(image_b64)
        if img is None:
            return EnrollmentImageResult(
                index=index, accepted=False, quality_score=0.0,
                rejection_reason="invalid_image",
            )

        h, w = img.shape[:2]
        if w < MIN_RESOLUTION[0] or h < MIN_RESOLUTION[1]:
            return EnrollmentImageResult(
                index=index, accepted=False, quality_score=0.0,
                rejection_reason="low_resolution",
                checks={"image_width": w, "image_height": h},
            )

        faces = self._detect_faces(img)
        if faces is None:
            # Mock mode — accept with synthetic quality
            return EnrollmentImageResult(
                index=index, accepted=True, quality_score=0.85,
                pose_type=expected_pose,
                checks={"mode": "mock"},
                face_metadata={"detected_pose": expected_pose, "mode": "mock"},
            )

        validation = validate_face_image(img, faces, expected_pose=expected_pose)

        if not validation["accepted"]:
            return EnrollmentImageResult(
                index=index, accepted=False,
                quality_score=validation.get("quality_score", 0.0),
                rejection_reason=validation.get("reason", "validation_failed"),
                checks=validation.get("checks", {}),
            )

        face_metadata = validation.get("face_metadata") or {}
        detected_pose = face_metadata.get("detected_pose") or expected_pose

        processed = self._processor.process(
            img,
            landmarks=self._get_landmarks(faces),
            bbox=self._get_bbox_tuple(faces),
        )

        checks = validation.get("checks", {})
        checks["processing_applied"] = processed.processing_applied

        return EnrollmentImageResult(
            index=index,
            accepted=True,
            quality_score=validation["quality_score"],
            pose_type=detected_pose,
            checks=checks,
            face_metadata=face_metadata,
        )

    def _generate_embedding(
        self, image_b64: str, employee_id: str, index: int
    ) -> np.ndarray | None:
        """Generate a 512-d embedding from a face image."""
        img = self._decode_image(image_b64)
        if img is None:
            return None

        app = self._get_face_app()
        if app is None:
            return self._mock_embedding(f"{employee_id}-{index}")

        faces = app.get(img)
        if not faces:
            return None

        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        embedding = np.array(face.embedding, dtype=np.float32)
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding

    def _detect_faces(self, img: np.ndarray):
        """Detect faces using InsightFace or return None for mock mode."""
        app = self._get_face_app()
        if app is None:
            return None
        return app.get(img)

    def _get_face_app(self):
        if self._face_app is not None:
            return self._face_app
        try:
            from insightface.app import FaceAnalysis
            app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=0, det_size=(640, 640))
            self._face_app = app
            return self._face_app
        except Exception:
            return None

    def _get_landmarks(self, faces) -> np.ndarray | None:
        if not faces:
            return None
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        kps = getattr(face, "kps", None)
        if kps is not None:
            return np.array(kps, dtype=np.float32)
        return None

    def _get_bbox_tuple(self, faces) -> tuple[int, int, int, int] | None:
        if not faces:
            return None
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        bb = face.bbox
        return (int(bb[0]), int(bb[1]), int(bb[2]), int(bb[3]))

    @staticmethod
    def _decode_image(image_b64: str) -> np.ndarray | None:
        try:
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            data = base64.b64decode(image_b64)
            pil = Image.open(io.BytesIO(data)).convert("RGB")
            return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            return None

    @staticmethod
    def _mock_embedding(seed: str) -> np.ndarray:
        rng = np.random.default_rng(abs(hash(seed)) % (2**32))
        vec = rng.standard_normal(settings.embedding_dim).astype(np.float32)
        return vec / np.linalg.norm(vec)


_service: FaceEnrollmentService | None = None


def get_enrollment_service() -> FaceEnrollmentService:
    global _service
    if _service is None:
        _service = FaceEnrollmentService()
    return _service
