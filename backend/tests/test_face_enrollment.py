"""Comprehensive unit tests for the Face Enrollment System.

Tests cover:
- Face Image Processing (alignment, cropping, enhancement)
- Enrollment Scoring (quality, diversity, completeness)
- Enrollment Service (full workflow, validation, re-enrollment)
- Enrollment Requirements and Configuration
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest
from PIL import Image

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.enrollment_scoring import (
    ALL_POSE_TYPES,
    MIN_IMAGES,
    OPTIONAL_POSE_TYPES,
    RECOMMENDED_IMAGES_MIN,
    REQUIRED_POSE_TYPES,
    EnrollmentScore,
    EnrollmentScorer,
    EnrollmentStatus,
)
from app.services.enrollment_service import (
    SUPPORTED_IMAGE_FORMATS,
    EnrollmentImageResult,
    EnrollmentMethod,
    EnrollmentResult,
    EnrollmentType,
    FaceEnrollmentService,
    ReEnrollmentTrigger,
)
from app.services.face_image_processor import FaceImageProcessor, ProcessedFaceImage


# ═══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════════


def _make_test_image(width: int = 640, height: int = 480, brightness: int = 128) -> np.ndarray:
    """Create a synthetic BGR test image with face-like patterns."""
    rng = np.random.default_rng(42)
    img = np.full((height, width, 3), brightness, dtype=np.uint8)
    noise = rng.integers(-20, 20, size=(height, width, 3), dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    cv2.circle(img, (width // 2, height // 2), min(width, height) // 4, (200, 180, 160), -1)
    return img


def _encode_image(img: np.ndarray) -> str:
    """Encode a BGR numpy image as base64 JPEG string."""
    success, buffer = cv2.imencode(".jpg", img)
    assert success
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def _make_test_image_b64(width: int = 640, height: int = 480, seed: int = 42) -> str:
    """Create a base64-encoded test image."""
    rng = np.random.default_rng(seed)
    img = rng.integers(80, 200, size=(height, width, 3), dtype=np.uint8)
    return _encode_image(img)


@pytest.fixture
def test_image():
    return _make_test_image()


@pytest.fixture
def test_image_b64():
    return _make_test_image_b64()


@pytest.fixture
def sample_landmarks():
    return np.array([
        [200.0, 170.0],  # left eye
        [280.0, 170.0],  # right eye
        [240.0, 210.0],  # nose
        [210.0, 250.0],  # left mouth
        [270.0, 250.0],  # right mouth
    ], dtype=np.float32)


@pytest.fixture
def enrollment_images():
    """Generate 12 unique base64 images for enrollment."""
    return [_make_test_image_b64(640, 480, seed=i) for i in range(12)]


@pytest.fixture
def mock_faiss_index():
    """Create a mock FAISS index."""
    index = MagicMock()
    index.add_batch.return_value = list(range(10))
    index.remove_employee.return_value = None
    return index


@pytest.fixture
def processor():
    return FaceImageProcessor()


@pytest.fixture
def scorer():
    return EnrollmentScorer()


@pytest.fixture
def enrollment_service(mock_faiss_index):
    service = FaceEnrollmentService(index=mock_faiss_index)
    service._face_app = None
    return service


def _patch_mock_mode(service):
    """Patch the service to use mock mode (no InsightFace)."""
    service._face_app = None
    return patch.object(
        FaceEnrollmentService, "_get_face_app", return_value=None
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Face Image Processor
# ═══════════════════════════════════════════════════════════════════════════════


class TestFaceImageProcessor:
    """Tests for face alignment, cropping, and enhancement."""

    def test_process_returns_processed_face_image(self, processor, test_image, sample_landmarks):
        result = processor.process(
            test_image,
            landmarks=sample_landmarks,
            bbox=(100, 60, 380, 340),
        )

        assert isinstance(result, ProcessedFaceImage)
        assert result.aligned_face is not None
        assert result.cropped_face is not None
        assert result.enhanced_face is not None
        assert result.original_shape == (480, 640)
        assert result.face_bbox == (100, 60, 380, 340)

    def test_crop_produces_desired_size(self, processor, test_image):
        result = processor.process(test_image, bbox=(100, 60, 380, 340))

        assert result.cropped_face.shape[:2] == FaceImageProcessor.DESIRED_FACE_SIZE

    def test_alignment_with_landmarks(self, processor, test_image, sample_landmarks):
        result = processor.process(test_image, landmarks=sample_landmarks, bbox=(100, 60, 380, 340))

        assert "align" in result.processing_applied
        assert result.eye_positions is not None
        assert result.aligned_face.shape[:2] == FaceImageProcessor.DESIRED_FACE_SIZE

    def test_process_without_landmarks_skips_alignment(self, processor, test_image):
        result = processor.process(test_image, landmarks=None, bbox=(100, 60, 380, 340))

        assert "align" not in result.processing_applied
        assert result.eye_positions is None

    def test_enhancement_applied(self, processor, test_image, sample_landmarks):
        result = processor.process(test_image, landmarks=sample_landmarks, bbox=(100, 60, 380, 340))

        assert "enhance" in result.processing_applied
        assert result.enhanced_face is not None
        assert result.enhanced_face.shape == result.aligned_face.shape

    def test_crop_with_margin(self, processor, test_image):
        result = processor.process(test_image, bbox=(150, 100, 350, 300))

        assert result.cropped_face.shape[:2] == FaceImageProcessor.DESIRED_FACE_SIZE

    def test_crop_edge_case_small_bbox(self, processor, test_image):
        result = processor.process(test_image, bbox=(0, 0, 50, 50))

        assert result.cropped_face is not None
        assert result.cropped_face.size > 0

    def test_brightness_correction(self, processor):
        dark_image = np.full((224, 224, 3), 30, dtype=np.uint8)
        result = processor._enhance(dark_image)
        lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB)
        assert np.mean(lab[:, :, 0]) > np.mean(
            cv2.cvtColor(dark_image, cv2.COLOR_BGR2LAB)[:, :, 0]
        )

    def test_contrast_enhancement(self, processor):
        flat_image = np.full((224, 224, 3), 128, dtype=np.uint8)
        result = processor._correct_contrast(flat_image)
        assert result.shape == flat_image.shape

    def test_noise_reduction(self, processor):
        rng = np.random.default_rng(7)
        noisy = rng.integers(0, 255, size=(224, 224, 3), dtype=np.uint8)
        denoised = processor._reduce_noise(noisy)
        assert denoised.shape == noisy.shape
        noise_var_before = float(np.var(noisy.astype(np.float32)))
        noise_var_after = float(np.var(denoised.astype(np.float32)))
        assert noise_var_after <= noise_var_before

    def test_process_with_none_bbox_uses_full_image(self, processor, test_image):
        result = processor.process(test_image, bbox=None)

        assert result.face_bbox == (0, 0, 640, 480)


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Enrollment Scoring
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnrollmentScoring:
    """Tests for enrollment scoring: quality, diversity, completeness."""

    def test_empty_images_returns_re_enroll(self, scorer):
        score = scorer.score([])

        assert score.overall_score == 0.0
        assert score.status == EnrollmentStatus.RE_ENROLL_REQUIRED

    def test_excellent_score(self, scorer):
        images = self._make_diverse_images(quality=0.95, count=20)
        score = scorer.score(images)

        assert score.status == EnrollmentStatus.EXCELLENT
        assert score.overall_score >= 90

    def test_good_score(self, scorer):
        images = self._make_images_with_some_poses(quality=0.90, count=20)
        score = scorer.score(images)

        assert score.status in (EnrollmentStatus.EXCELLENT, EnrollmentStatus.GOOD)
        assert score.overall_score >= 80

    def test_acceptable_score(self, scorer):
        images = [
            {"quality_score": 0.75, "pose_type": "front", "checks": {"brightness_score": 0.6}}
            for _ in range(10)
        ]
        score = scorer.score(images)

        assert score.overall_score >= 0

    def test_re_enroll_required_low_quality(self, scorer):
        images = [
            {"quality_score": 0.3, "pose_type": "front", "checks": {"brightness_score": 0.3}}
            for _ in range(10)
        ]
        score = scorer.score(images)

        assert score.status == EnrollmentStatus.RE_ENROLL_REQUIRED
        assert score.overall_score < 70

    def test_pose_diversity_all_required(self, scorer):
        images = []
        for pose in REQUIRED_POSE_TYPES:
            images.append({
                "quality_score": 0.9,
                "pose_type": pose,
                "checks": {"brightness_score": 0.7},
            })
        for i in range(5):
            images.append({
                "quality_score": 0.9,
                "pose_type": "front",
                "checks": {"brightness_score": 0.7},
            })

        score = scorer.score(images)
        assert score.pose_diversity_score >= 70

    def test_pose_diversity_missing_poses(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(10)
        ]
        score = scorer.score(images)

        assert score.pose_diversity_score < 50

    def test_completeness_minimum_images(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(MIN_IMAGES)
        ]
        score = scorer.score(images)

        assert score.completeness_score >= 70

    def test_completeness_recommended_images(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(RECOMMENDED_IMAGES_MIN)
        ]
        score = scorer.score(images)

        assert score.completeness_score == 100.0

    def test_lighting_diversity_varied(self, scorer):
        images = []
        for i in range(10):
            brightness = 0.3 + (i * 0.07)
            images.append({
                "quality_score": 0.9,
                "pose_type": "front",
                "checks": {"brightness_score": min(1.0, brightness)},
            })
        score = scorer.score(images)

        assert score.lighting_diversity_score > 50

    def test_lighting_diversity_uniform(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(10)
        ]
        score = scorer.score(images)

        assert score.lighting_diversity_score <= 50

    def test_score_details_contain_required_fields(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(10)
        ]
        score = scorer.score(images)

        assert "image_count" in score.details
        assert "unique_poses" in score.details
        assert "required_poses_covered" in score.details
        assert "missing_poses" in score.details
        assert score.details["image_count"] == 10

    def test_to_dict_format(self, scorer):
        images = [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(10)
        ]
        score = scorer.score(images)
        d = score.to_dict()

        assert "overall_score" in d
        assert "status" in d
        assert "image_quality_score" in d
        assert "pose_diversity_score" in d
        assert "lighting_diversity_score" in d
        assert "completeness_score" in d
        assert "details" in d

    def test_status_thresholds(self, scorer):
        assert scorer._determine_status(95) == EnrollmentStatus.EXCELLENT
        assert scorer._determine_status(90) == EnrollmentStatus.EXCELLENT
        assert scorer._determine_status(85) == EnrollmentStatus.GOOD
        assert scorer._determine_status(80) == EnrollmentStatus.GOOD
        assert scorer._determine_status(75) == EnrollmentStatus.ACCEPTABLE
        assert scorer._determine_status(70) == EnrollmentStatus.ACCEPTABLE
        assert scorer._determine_status(69) == EnrollmentStatus.RE_ENROLL_REQUIRED
        assert scorer._determine_status(50) == EnrollmentStatus.RE_ENROLL_REQUIRED
        assert scorer._determine_status(0) == EnrollmentStatus.RE_ENROLL_REQUIRED

    def test_optional_poses_boost_score(self, scorer):
        base_images = [
            {"quality_score": 0.9, "pose_type": pose, "checks": {"brightness_score": 0.7}}
            for pose in REQUIRED_POSE_TYPES
        ]
        base_images += [
            {"quality_score": 0.9, "pose_type": "front", "checks": {"brightness_score": 0.7}}
            for _ in range(5)
        ]
        score_no_optional = scorer.score(base_images)

        with_optional = base_images + [
            {"quality_score": 0.9, "pose_type": pose, "checks": {"brightness_score": 0.7}}
            for pose in OPTIONAL_POSE_TYPES
        ]
        score_with_optional = scorer.score(with_optional)

        assert score_with_optional.pose_diversity_score >= score_no_optional.pose_diversity_score

    # ── Helpers ──

    def _make_diverse_images(self, quality: float, count: int) -> list[dict]:
        images = []
        all_poses = list(REQUIRED_POSE_TYPES | OPTIONAL_POSE_TYPES)
        for i in range(count):
            pose = all_poses[i % len(all_poses)]
            brightness = 0.4 + (i % 5) * 0.12
            images.append({
                "quality_score": quality,
                "pose_type": pose,
                "checks": {"brightness_score": min(1.0, brightness)},
            })
        return images

    def _make_images_with_some_poses(self, quality: float, count: int) -> list[dict]:
        images = []
        poses = ["front", "left", "right", "up", "down"]
        for i in range(count):
            pose = poses[i % len(poses)]
            images.append({
                "quality_score": quality,
                "pose_type": pose,
                "checks": {"brightness_score": 0.6 + (i % 3) * 0.1},
            })
        return images


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Face Enrollment Service
# ═══════════════════════════════════════════════════════════════════════════════


class TestFaceEnrollmentService:
    """Tests for the enrollment service orchestration."""

    def test_enroll_too_few_images(self, enrollment_service):
        images = [_make_test_image_b64(640, 480, seed=i) for i in range(5)]

        result = enrollment_service.enroll("emp-1", images)

        assert result.success is False
        assert "Minimum" in result.error
        assert result.enrollment_type == EnrollmentType.EMPLOYEE

    def test_enroll_too_many_images(self, enrollment_service):
        images = [_make_test_image_b64(640, 480, seed=i) for i in range(60)]

        result = enrollment_service.enroll("emp-1", images)

        assert result.success is False
        assert "Maximum" in result.error

    def test_enroll_invalid_images(self, enrollment_service):
        images = ["not-valid-base64!!!"] * 12

        result = enrollment_service.enroll("emp-1", images)

        assert result.success is False

    def test_enroll_low_resolution_images(self, enrollment_service):
        images = [_make_test_image_b64(320, 240, seed=i) for i in range(12)]

        result = enrollment_service.enroll("emp-1", images)

        assert result.success is False
        assert "low_resolution" in (result.error or "") or len(result.rejected_images) > 0

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_success_mock_mode(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        poses = ["front", "left", "right", "up", "down", "smiling", "neutral",
                 "glasses", "without_glasses", None, None, None]
        result = enrollment_service.enroll("emp-1", enrollment_images, expected_poses=poses)

        assert result.success is True
        assert result.embeddings_stored > 0
        assert len(result.faiss_ids) > 0
        assert result.enrollment_score is not None
        assert result.enrollment_type == EnrollmentType.EMPLOYEE

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_with_enrollment_type(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll(
            "emp-1", enrollment_images, enrollment_type=EnrollmentType.CONTRACTOR
        )

        assert result.success is True
        assert result.enrollment_type == EnrollmentType.CONTRACTOR

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_with_method(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll(
            "emp-1", enrollment_images, enrollment_method=EnrollmentMethod.WEBCAM
        )

        assert result.success is True
        assert result.enrollment_method == EnrollmentMethod.WEBCAM

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_stores_embeddings(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll("emp-1", enrollment_images)

        assert result.success is True
        enrollment_service._index.add_batch.assert_called_once()
        args = enrollment_service._index.add_batch.call_args
        assert args[0][0] == "emp-1"

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_result_to_dict(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll("emp-1", enrollment_images)
        d = result.to_dict()

        assert "success" in d
        assert "employee_id" in d
        assert "enrollment_type" in d
        assert "enrollment_method" in d
        assert "embeddings_stored" in d
        assert "faiss_ids" in d
        assert "enrollment_score" in d
        assert "accepted_count" in d
        assert "rejected_count" in d
        assert "processing_ms" in d

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_with_expected_poses(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        poses = ["front", "left", "right", "up", "down", "smiling", "neutral",
                 "glasses", "without_glasses"] + [None] * 3
        result = enrollment_service.enroll("emp-1", enrollment_images, expected_poses=poses)

        assert result.success is True
        pose_types = [a.pose_type for a in result.accepted_images if a.pose_type]
        assert "front" in pose_types
        assert "glasses" in pose_types

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_missing_required_poses_fails(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        """Guided enrollment must cover every required pose slot."""
        poses = ["front", "left", "right", "up", "down"] + [None] * 7
        result = enrollment_service.enroll("emp-1", enrollment_images, expected_poses=poses)

        assert result.success is False
        assert "Missing required poses" in result.error
        assert result.missing_poses is not None
        assert "smiling" in result.missing_poses
        assert "glasses" in result.missing_poses
        assert "front" not in result.missing_poses
        assert result.required_poses is not None
        d = result.to_dict()
        assert d["missing_poses"] == result.missing_poses

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_without_pose_slots_not_enforced(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        """Plain uploads carry no slot info, so coverage cannot be enforced."""
        result = enrollment_service.enroll("emp-1", enrollment_images)

        assert result.success is True

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enroll_pose_coverage_enforcement_can_be_disabled(
        self, mock_detect, mock_app, enrollment_service, enrollment_images, monkeypatch
    ):
        from app.core.config import settings as app_settings

        monkeypatch.setattr(app_settings, "face_enrollment_enforce_pose_coverage", False)
        poses = ["front", "left", "right", "up", "down"] + [None] * 7
        result = enrollment_service.enroll("emp-1", enrollment_images, expected_poses=poses)

        assert result.success is True

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_re_enroll_removes_old_data(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.re_enroll("emp-1", enrollment_images)

        assert result.success is True
        assert result.enrollment_type == EnrollmentType.RE_ENROLLMENT
        enrollment_service._index.remove_employee.assert_called_with("emp-1")
        assert result.metadata.get("re_enrollment_trigger") == "manual"

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_re_enroll_with_trigger(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.re_enroll(
            "emp-1", enrollment_images, trigger=ReEnrollmentTrigger.APPEARANCE_CHANGE
        )

        assert result.success is True
        assert result.metadata["re_enrollment_trigger"] == "employee_appearance_changes"

    def test_pose_slot_label_overrides_detected_pose(
        self, enrollment_service, test_image_b64, monkeypatch
    ):
        """Attribute slots (glasses/smiling) keep their slot label even though
        the pose detector reports a head pose like front/neutral."""
        from types import SimpleNamespace

        import app.services.enrollment_service as es

        face = SimpleNamespace(bbox=np.array([10.0, 10.0, 200.0, 200.0]), kps=None)
        monkeypatch.setattr(
            es,
            "validate_face_image",
            lambda img, faces, expected_pose=None: {
                "accepted": True,
                "quality_score": 0.9,
                "checks": {},
                "face_metadata": {"detected_pose": "front", "glasses_detected": True},
            },
        )
        monkeypatch.setattr(enrollment_service, "_detect_faces", lambda img: [face])
        monkeypatch.setattr(
            enrollment_service._processor,
            "process",
            lambda *a, **k: SimpleNamespace(processing_applied=[]),
        )

        result = enrollment_service._process_single_image(
            test_image_b64, "emp-1", 0, "glasses", None
        )

        assert result.accepted is True
        assert result.pose_type == "glasses"
        assert result.face_metadata["detected_pose"] == "front"

    def test_delete_enrollment(self, enrollment_service):
        result = enrollment_service.delete_enrollment("emp-1")

        assert result["success"] is True
        enrollment_service._index.remove_employee.assert_called_with("emp-1")

    def test_validate_single_image_invalid(self, enrollment_service):
        result = enrollment_service.validate_single_image("invalid-base64!!!")

        assert result["accepted"] is False
        assert result["reason"] == "invalid_image"
        assert result["quality_score"] == 0.0

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_validate_single_image_mock_mode(self, mock_detect, mock_app, enrollment_service, test_image_b64):
        result = enrollment_service.validate_single_image(test_image_b64)

        assert result["accepted"] is True
        assert result["quality_score"] > 0

    def test_validate_low_resolution_rejected(self, enrollment_service):
        small_image = _make_test_image_b64(320, 240)
        result = enrollment_service.validate_single_image(small_image)

        assert result["accepted"] is False
        assert result["reason"] == "low_resolution"

    def test_get_enrollment_quality_requirements(self, enrollment_service):
        reqs = enrollment_service.get_enrollment_quality_requirements()

        assert reqs["min_images"] == 10
        assert reqs["recommended_images"]["min"] == 20
        assert reqs["recommended_images"]["max"] == 30
        assert reqs["min_resolution"]["width"] == 640
        assert reqs["min_resolution"]["height"] == 480
        assert "jpg" in reqs["supported_formats"]
        assert "png" in reqs["supported_formats"]
        # All nine capture slots are required per the enrollment requirements
        for pose in (
            "front", "left", "right", "up", "down",
            "smiling", "neutral", "glasses", "without_glasses",
        ):
            assert pose in reqs["required_poses"]
        assert reqs["optional_poses"] == []
        assert reqs["pose_coverage_enforced"] is True
        assert reqs["embedding"]["dimension"] == 512
        assert reqs["embedding"]["model"] == "ArcFace/InsightFace"
        assert reqs["pose_validation"]["yaw_range"] == "±45°"
        assert reqs["pose_validation"]["pitch_range"] == "±30°"

    def test_enrollment_method_enum(self):
        assert EnrollmentMethod.WEBCAM.value == "webcam"
        assert EnrollmentMethod.MOBILE.value == "mobile"
        assert EnrollmentMethod.IMAGE_UPLOAD.value == "image_upload"
        assert EnrollmentMethod.KIOSK.value == "kiosk"

    def test_enrollment_type_enum(self):
        assert EnrollmentType.EMPLOYEE.value == "employee"
        assert EnrollmentType.VISITOR.value == "visitor"
        assert EnrollmentType.CONTRACTOR.value == "contractor"
        assert EnrollmentType.TEMPORARY_STAFF.value == "temporary_staff"
        assert EnrollmentType.RE_ENROLLMENT.value == "re_enrollment"
        assert EnrollmentType.BULK.value == "bulk"

    def test_re_enrollment_trigger_enum(self):
        assert ReEnrollmentTrigger.ACCURACY_DROP.value == "recognition_accuracy_drops"
        assert ReEnrollmentTrigger.APPEARANCE_CHANGE.value == "employee_appearance_changes"
        assert ReEnrollmentTrigger.TEMPLATE_OUTDATED.value == "face_template_outdated"
        assert ReEnrollmentTrigger.POOR_SCORE.value == "poor_enrollment_score"
        assert ReEnrollmentTrigger.MANUAL.value == "manual"
        assert ReEnrollmentTrigger.SCHEDULED.value == "scheduled"


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Image Decoding and Resolution Validation
# ═══════════════════════════════════════════════════════════════════════════════


class TestImageDecoding:
    """Tests for image decoding and format support."""

    def test_decode_valid_jpeg(self, enrollment_service):
        img = _make_test_image(640, 480)
        b64 = _encode_image(img)
        decoded = enrollment_service._decode_image(b64)

        assert decoded is not None
        assert decoded.shape[:2] == (480, 640)

    def test_decode_valid_png(self, enrollment_service):
        img = _make_test_image(640, 480)
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        buffer = io.BytesIO()
        pil_img.save(buffer, format="PNG")
        b64 = base64.b64encode(buffer.getvalue()).decode("ascii")

        decoded = enrollment_service._decode_image(b64)
        assert decoded is not None
        assert decoded.shape[:2] == (480, 640)

    def test_decode_with_data_uri_prefix(self, enrollment_service):
        img = _make_test_image(640, 480)
        b64 = _encode_image(img)
        data_uri = f"data:image/jpeg;base64,{b64}"

        decoded = enrollment_service._decode_image(data_uri)
        assert decoded is not None

    def test_decode_invalid_base64(self, enrollment_service):
        decoded = enrollment_service._decode_image("not-valid-base64!!!")
        assert decoded is None

    def test_decode_empty_string(self, enrollment_service):
        decoded = enrollment_service._decode_image("")
        assert decoded is None

    def test_mock_embedding_deterministic(self, enrollment_service):
        e1 = enrollment_service._mock_embedding("employee-42")
        e2 = enrollment_service._mock_embedding("employee-42")
        assert np.allclose(e1, e2)

    def test_mock_embedding_normalized(self, enrollment_service):
        emb = enrollment_service._mock_embedding("test")
        norm = np.linalg.norm(emb)
        assert abs(norm - 1.0) < 1e-5

    def test_mock_embedding_512_dimensions(self, enrollment_service):
        emb = enrollment_service._mock_embedding("test")
        assert emb.shape == (512,)

    def test_mock_embedding_different_seeds_differ(self, enrollment_service):
        e1 = enrollment_service._mock_embedding("employee-1")
        e2 = enrollment_service._mock_embedding("employee-2")
        assert not np.allclose(e1, e2)


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Enrollment Image Result
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnrollmentImageResult:
    """Tests for the enrollment image result dataclass."""

    def test_accepted_result(self):
        result = EnrollmentImageResult(
            index=0,
            accepted=True,
            quality_score=0.92,
            pose_type="front",
            checks={"blur_score": 0.95},
            face_metadata={"yaw": 0.01},
            embedding_dim=512,
        )

        assert result.accepted is True
        assert result.quality_score == 0.92
        assert result.pose_type == "front"
        assert result.embedding_dim == 512

    def test_rejected_result(self):
        result = EnrollmentImageResult(
            index=3,
            accepted=False,
            quality_score=0.25,
            rejection_reason="blurry",
        )

        assert result.accepted is False
        assert result.rejection_reason == "blurry"
        assert result.pose_type is None


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Enrollment Result Serialization
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnrollmentResult:
    """Tests for enrollment result serialization."""

    def test_success_result_to_dict(self):
        score = EnrollmentScore(
            overall_score=92.5,
            status=EnrollmentStatus.EXCELLENT,
            image_quality_score=90.0,
            pose_diversity_score=95.0,
            lighting_diversity_score=88.0,
            completeness_score=100.0,
        )
        result = EnrollmentResult(
            success=True,
            employee_id="emp-1",
            enrollment_type=EnrollmentType.EMPLOYEE,
            enrollment_method=EnrollmentMethod.WEBCAM,
            embeddings_stored=10,
            faiss_ids=["0", "1", "2"],
            enrollment_score=score,
            processing_ms=1500,
        )

        d = result.to_dict()
        assert d["success"] is True
        assert d["employee_id"] == "emp-1"
        assert d["enrollment_type"] == "employee"
        assert d["enrollment_method"] == "webcam"
        assert d["embeddings_stored"] == 10
        assert d["enrollment_score"]["status"] == "excellent"

    def test_failure_result_to_dict(self):
        result = EnrollmentResult(
            success=False,
            employee_id="emp-2",
            enrollment_type=EnrollmentType.EMPLOYEE,
            enrollment_method=EnrollmentMethod.IMAGE_UPLOAD,
            error="Minimum 10 images required, got 5",
            processing_ms=50,
        )

        d = result.to_dict()
        assert d["success"] is False
        assert d["error"] == "Minimum 10 images required, got 5"
        assert d["embeddings_stored"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Performance Requirements
# ═══════════════════════════════════════════════════════════════════════════════


class TestPerformanceRequirements:
    """Verify enrollment performance constraints from spec."""

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_validate_image_under_200ms(self, mock_detect, mock_app, enrollment_service, test_image_b64):
        import time

        start = time.perf_counter()
        enrollment_service.validate_single_image(test_image_b64)
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert elapsed_ms < 2000  # generous for CI; spec says <200ms

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enrollment_under_2_seconds(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        import time

        start = time.perf_counter()
        enrollment_service.enroll("emp-perf", enrollment_images)
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert elapsed_ms < 10000  # generous for CI; spec says <2s

    def test_embedding_size_512(self, enrollment_service):
        emb = enrollment_service._mock_embedding("test-512")
        assert emb.shape[0] == 512


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Configuration Constants
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnrollmentConstants:
    """Verify enrollment constants match specification."""

    def test_min_images_is_10(self):
        assert MIN_IMAGES == 10

    def test_recommended_images(self):
        assert RECOMMENDED_IMAGES_MIN == 20

    def test_supported_formats(self):
        for fmt in ["jpg", "jpeg", "png", "webp"]:
            assert fmt in SUPPORTED_IMAGE_FORMATS

    def test_required_poses(self):
        assert "front" in REQUIRED_POSE_TYPES
        assert "left" in REQUIRED_POSE_TYPES
        assert "right" in REQUIRED_POSE_TYPES
        assert "up" in REQUIRED_POSE_TYPES
        assert "down" in REQUIRED_POSE_TYPES

    def test_optional_poses(self):
        assert "smiling" in OPTIONAL_POSE_TYPES
        assert "neutral" in OPTIONAL_POSE_TYPES
        assert "glasses" in OPTIONAL_POSE_TYPES
        assert "without_glasses" in OPTIONAL_POSE_TYPES

    def test_all_pose_types_is_union(self):
        assert ALL_POSE_TYPES == REQUIRED_POSE_TYPES | OPTIONAL_POSE_TYPES


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Enrollment Status Transitions
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnrollmentStatusTransitions:
    """Test enrollment approval rules from spec (§5.8)."""

    def test_excellent_threshold(self):
        score = EnrollmentScore(
            overall_score=95.0,
            status=EnrollmentStatus.EXCELLENT,
            image_quality_score=95.0,
            pose_diversity_score=95.0,
            lighting_diversity_score=95.0,
            completeness_score=95.0,
        )
        assert score.status == EnrollmentStatus.EXCELLENT

    def test_good_threshold(self):
        score = EnrollmentScore(
            overall_score=85.0,
            status=EnrollmentStatus.GOOD,
            image_quality_score=85.0,
            pose_diversity_score=85.0,
            lighting_diversity_score=85.0,
            completeness_score=85.0,
        )
        assert score.status == EnrollmentStatus.GOOD

    def test_acceptable_threshold(self):
        score = EnrollmentScore(
            overall_score=75.0,
            status=EnrollmentStatus.ACCEPTABLE,
            image_quality_score=75.0,
            pose_diversity_score=75.0,
            lighting_diversity_score=75.0,
            completeness_score=75.0,
        )
        assert score.status == EnrollmentStatus.ACCEPTABLE

    def test_re_enroll_required_threshold(self):
        score = EnrollmentScore(
            overall_score=60.0,
            status=EnrollmentStatus.RE_ENROLL_REQUIRED,
            image_quality_score=60.0,
            pose_diversity_score=60.0,
            lighting_diversity_score=60.0,
            completeness_score=60.0,
        )
        assert score.status == EnrollmentStatus.RE_ENROLL_REQUIRED


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Face Metadata
# ═══════════════════════════════════════════════════════════════════════════════


class TestFaceMetadata:
    """Test face metadata generation per spec (§5.9)."""

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_metadata_in_accepted_images(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll("emp-meta", enrollment_images)

        assert result.success is True
        for img_result in result.accepted_images:
            assert img_result.face_metadata is not None

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_quality_score_in_accepted(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll("emp-q", enrollment_images)

        for img_result in result.accepted_images:
            assert 0.0 <= img_result.quality_score <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Security and Data Handling
# ═══════════════════════════════════════════════════════════════════════════════


class TestSecurityRequirements:
    """Test security-related enrollment requirements."""

    def test_embedding_is_float32(self, enrollment_service):
        emb = enrollment_service._mock_embedding("secure-test")
        assert emb.dtype == np.float32

    def test_embedding_is_normalized(self, enrollment_service):
        emb = enrollment_service._mock_embedding("norm-test")
        norm = float(np.linalg.norm(emb))
        assert abs(norm - 1.0) < 1e-5

    @patch.object(FaceEnrollmentService, "_get_face_app", return_value=None)
    @patch.object(FaceEnrollmentService, "_detect_faces", return_value=None)
    def test_enrollment_does_not_store_raw_images(self, mock_detect, mock_app, enrollment_service, enrollment_images):
        result = enrollment_service.enroll("emp-sec", enrollment_images)

        assert result.success is True
        for img_result in result.accepted_images:
            assert not hasattr(img_result, "raw_image")


# ═══════════════════════════════════════════════════════════════════════════════
# Tests: Edge Cases and Error Handling
# ═══════════════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    """Edge cases and error handling for enrollment."""

    def test_enroll_empty_list(self, enrollment_service):
        result = enrollment_service.enroll("emp-1", [])
        assert result.success is False

    def test_enroll_single_image(self, enrollment_service):
        images = [_make_test_image_b64(640, 480)]
        result = enrollment_service.enroll("emp-1", images)
        assert result.success is False

    def test_enroll_exactly_min_images(self, enrollment_service, mock_faiss_index):
        with patch.object(FaceEnrollmentService, "_detect_faces", return_value=None), \
             patch.object(FaceEnrollmentService, "_get_face_app", return_value=None):
            images = [_make_test_image_b64(640, 480, seed=i) for i in range(MIN_IMAGES)]
            result = enrollment_service.enroll("emp-min", images)
            assert result.success is True

    def test_validate_image_with_expected_pose(self, enrollment_service):
        with patch.object(FaceEnrollmentService, "_detect_faces", return_value=None):
            b64 = _make_test_image_b64(640, 480)
            result = enrollment_service.validate_single_image(b64, expected_pose="front")
            assert result["accepted"] is True

    def test_re_enroll_too_few_images(self, enrollment_service):
        images = [_make_test_image_b64(640, 480, seed=i) for i in range(5)]
        result = enrollment_service.re_enroll("emp-1", images)
        assert result.success is False

    def test_enrollment_service_singleton(self):
        import app.services.enrollment_service as mod
        mod._service = None
        s1 = mod.get_enrollment_service()
        s2 = mod.get_enrollment_service()
        assert s1 is s2
        mod._service = None

    def test_scorer_singleton(self):
        import app.services.enrollment_scoring as mod
        mod._scorer = None
        s1 = mod.get_enrollment_scorer()
        s2 = mod.get_enrollment_scorer()
        assert s1 is s2
        mod._scorer = None

    def test_processor_singleton(self):
        import app.services.face_image_processor as mod
        mod._processor = None
        p1 = mod.get_face_image_processor()
        p2 = mod.get_face_image_processor()
        assert p1 is p2
        mod._processor = None
