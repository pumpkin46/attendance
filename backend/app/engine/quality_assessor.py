"""
Stage 4: Face Quality Assessment.

Quality Checks:
- Blur Detection (out of focus, motion blur, camera shake)
- Brightness Check (overexposed, underexposed)
- Face Angle Validation (yaw ±45°, pitch ±30°, roll ±30°)
- Occlusion Detection (mask, sunglasses, helmet, hair, hands)
- Minimum Quality Score >= 70%
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import cv2
import numpy as np

from app.engine.config import engine_config
from app.engine.face_detector import DetectedFace

logger = logging.getLogger(__name__)


@dataclass
class QualityAssessment:
    accepted: bool
    quality_score: float
    blur_score: float
    brightness_score: float
    resolution_score: float
    occlusion_score: float
    angle_valid: bool
    yaw: float
    pitch: float
    roll: float
    rejection_reason: str | None = None
    assessment_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "accepted": self.accepted,
            "quality_score": round(self.quality_score, 4),
            "blur_score": round(self.blur_score, 4),
            "brightness_score": round(self.brightness_score, 4),
            "resolution_score": round(self.resolution_score, 4),
            "occlusion_score": round(self.occlusion_score, 4),
            "angle_valid": self.angle_valid,
            "pose": {
                "yaw": round(self.yaw, 2),
                "pitch": round(self.pitch, 2),
                "roll": round(self.roll, 2),
            },
            "rejection_reason": self.rejection_reason,
            "assessment_ms": self.assessment_ms,
        }


class QualityAssessor:
    """Determine whether a face image is suitable for recognition."""

    def assess(self, frame: np.ndarray, face: DetectedFace) -> QualityAssessment:
        t0 = time.perf_counter()
        cfg = engine_config.quality

        bbox = face.bbox_xyxy
        x1, y1, x2, y2 = [int(v) for v in bbox]
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return self._reject("empty_crop", time.perf_counter() - t0)

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

        blur_score = self._assess_blur(gray)
        brightness_score = self._assess_brightness(gray)
        resolution_score = self._assess_resolution(face, frame.shape)
        occlusion_score = self._assess_occlusion(face, frame.shape)
        yaw, pitch, roll = self._estimate_pose(face)
        angle_valid = self._validate_angles(yaw, pitch, roll, cfg)

        quality_score = (
            0.25 * blur_score
            + 0.20 * brightness_score
            + 0.20 * resolution_score
            + 0.20 * occlusion_score
            + 0.15 * face.confidence
        )

        assessment_ms = int((time.perf_counter() - t0) * 1000)

        if blur_score < cfg.min_blur_score:
            return QualityAssessment(
                accepted=False, quality_score=quality_score,
                blur_score=blur_score, brightness_score=brightness_score,
                resolution_score=resolution_score, occlusion_score=occlusion_score,
                angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
                rejection_reason="blurry", assessment_ms=assessment_ms,
            )

        if brightness_score < cfg.min_brightness_score:
            reason = "overexposed" if self._is_overexposed(gray) else "underexposed"
            return QualityAssessment(
                accepted=False, quality_score=quality_score,
                blur_score=blur_score, brightness_score=brightness_score,
                resolution_score=resolution_score, occlusion_score=occlusion_score,
                angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
                rejection_reason=reason, assessment_ms=assessment_ms,
            )

        if not angle_valid:
            return QualityAssessment(
                accepted=False, quality_score=quality_score,
                blur_score=blur_score, brightness_score=brightness_score,
                resolution_score=resolution_score, occlusion_score=occlusion_score,
                angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
                rejection_reason="extreme_angle", assessment_ms=assessment_ms,
            )

        if occlusion_score < cfg.min_occlusion_score:
            return QualityAssessment(
                accepted=False, quality_score=quality_score,
                blur_score=blur_score, brightness_score=brightness_score,
                resolution_score=resolution_score, occlusion_score=occlusion_score,
                angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
                rejection_reason="occluded", assessment_ms=assessment_ms,
            )

        if quality_score < cfg.min_quality_score:
            return QualityAssessment(
                accepted=False, quality_score=quality_score,
                blur_score=blur_score, brightness_score=brightness_score,
                resolution_score=resolution_score, occlusion_score=occlusion_score,
                angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
                rejection_reason="low_quality", assessment_ms=assessment_ms,
            )

        return QualityAssessment(
            accepted=True, quality_score=quality_score,
            blur_score=blur_score, brightness_score=brightness_score,
            resolution_score=resolution_score, occlusion_score=occlusion_score,
            angle_valid=angle_valid, yaw=yaw, pitch=pitch, roll=roll,
            assessment_ms=assessment_ms,
        )

    def _assess_blur(self, gray: np.ndarray) -> float:
        if gray.size == 0:
            return 0.0
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        return float(min(1.0, variance / 120.0))

    def _assess_brightness(self, gray: np.ndarray) -> float:
        if gray.size == 0:
            return 0.0
        mean = float(np.mean(gray))
        if mean < 40 or mean > 220:
            return max(0.0, 1.0 - abs(mean - 130) / 130.0)
        return float(np.clip((mean - 40.0) / 140.0, 0.0, 1.0))

    def _is_overexposed(self, gray: np.ndarray) -> bool:
        return float(np.mean(gray)) > 180

    def _assess_resolution(self, face: DetectedFace, img_shape: tuple) -> float:
        min_dim = min(face.bounding_box["width"], face.bounding_box["height"])
        return float(min(1.0, min_dim / 80.0))

    def _assess_occlusion(self, face: DetectedFace, img_shape: tuple) -> float:
        if face.landmarks is None or len(face.landmarks) < 5:
            return 0.75

        h, w = img_shape[:2]
        pts = face.landmarks
        xs, ys = pts[:, 0], pts[:, 1]

        if np.any(xs < 0) or np.any(ys < 0) or np.any(xs >= w) or np.any(ys >= h):
            return 0.2

        left_eye, right_eye, nose = pts[0], pts[1], pts[2]
        eye_dist = float(np.linalg.norm(right_eye - left_eye))
        if eye_dist < 10:
            return 0.25

        face_w = max(face.bounding_box["width"], 1.0)
        ratio = eye_dist / face_w
        if ratio < 0.18 or ratio > 0.55:
            return 0.35

        return min(1.0, 0.5 + ratio)

    def _estimate_pose(self, face: DetectedFace) -> tuple[float, float, float]:
        """Estimate yaw, pitch, roll from 5-point landmarks."""
        if face.landmarks is None or len(face.landmarks) < 5:
            return 0.0, 0.0, 0.0

        left_eye, right_eye, nose, left_mouth, right_mouth = face.landmarks[:5]
        eye_center = (left_eye + right_eye) / 2.0
        eye_dist = float(np.linalg.norm(right_eye - left_eye)) + 1e-6

        yaw = float((nose[0] - eye_center[0]) / eye_dist) * 90.0
        mouth_center = (left_mouth + right_mouth) / 2.0
        vertical_dist = float(np.linalg.norm(mouth_center - eye_center)) + 1e-6
        pitch = float((nose[1] - eye_center[1]) / vertical_dist - 0.5) * 60.0

        dy = right_eye[1] - left_eye[1]
        dx = right_eye[0] - left_eye[0]
        roll = float(np.degrees(np.arctan2(dy, dx)))

        return yaw, pitch, roll

    def _validate_angles(self, yaw: float, pitch: float, roll: float, cfg) -> bool:
        return (
            abs(yaw) <= cfg.supported_yaw_degrees
            and abs(pitch) <= cfg.supported_pitch_degrees
            and abs(roll) <= cfg.supported_roll_degrees
        )

    def _reject(self, reason: str, elapsed: float) -> QualityAssessment:
        return QualityAssessment(
            accepted=False, quality_score=0.0,
            blur_score=0.0, brightness_score=0.0,
            resolution_score=0.0, occlusion_score=0.0,
            angle_valid=False, yaw=0.0, pitch=0.0, roll=0.0,
            rejection_reason=reason,
            assessment_ms=int(elapsed * 1000),
        )


_assessor: QualityAssessor | None = None


def get_quality_assessor() -> QualityAssessor:
    global _assessor
    if _assessor is None:
        _assessor = QualityAssessor()
    return _assessor
