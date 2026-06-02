"""Multi-layer liveness: passive anti-spoof (FR-017) + active verification (FR-018)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.core.config import settings
from app.services.active_liveness import verify_active_liveness
from app.services.antispoof import get_antispoof_verifier


@dataclass
class LivenessResult:
    passed: bool
    score: float
    face_count: int
    det_score: float
    checks: dict = field(default_factory=dict)
    reason: str | None = None
    spoof_type: str | None = None


def verify_liveness(
    image: np.ndarray | None,
    bbox_xyxy: list[float] | None,
    face_count: int,
    det_score: float,
    insightface_available: bool,
    liveness_frames: list[str] | None = None,
) -> LivenessResult:
    """
    Layer 1: exactly one face with sufficient detection confidence.
    Layer 2: MiniFASNet anti-spoof ONNX — printed photos, screens, deepfakes (FR-017).
    Layer 3: Active blink + head movement on frame sequence (FR-018).
    """
    checks: dict = {
        "single_face": face_count == 1,
        "det_score_ok": det_score >= settings.liveness_min_det_score,
        "det_score": round(det_score, 4),
        "face_count": face_count,
        "methods": {
            "ai_model": settings.antispoof_enabled,
            "blink_detection": settings.active_liveness_enabled,
            "head_movement": settings.active_liveness_enabled,
        },
    }

    if not insightface_available:
        return LivenessResult(
            passed=True,
            score=det_score,
            face_count=face_count,
            det_score=det_score,
            checks={**checks, "mode": "mock_skip"},
        )

    if face_count != 1:
        return LivenessResult(
            passed=False,
            score=0.0,
            face_count=face_count,
            det_score=det_score,
            checks=checks,
            reason="multiple_or_no_face",
        )

    if det_score < settings.liveness_min_det_score:
        return LivenessResult(
            passed=False,
            score=det_score,
            face_count=face_count,
            det_score=det_score,
            checks=checks,
            reason="low_detection_score",
        )

    if not settings.liveness_enabled:
        return LivenessResult(
            passed=True,
            score=det_score,
            face_count=face_count,
            det_score=det_score,
            checks={**checks, "liveness_disabled": True},
        )

    if image is None or bbox_xyxy is None:
        return LivenessResult(
            passed=False,
            score=0.0,
            face_count=face_count,
            det_score=det_score,
            checks=checks,
            reason="invalid_image",
        )

    spoof_type: str | None = None
    score = det_score

    if settings.antispoof_enabled:
        antispoof = get_antispoof_verifier().verify(image, bbox_xyxy)
        checks["antispoof"] = antispoof.checks
        checks["ai_model"] = "MiniFASNetV2"
        if antispoof.spoof_type:
            checks["spoof_type"] = antispoof.spoof_type
            spoof_type = antispoof.spoof_type
        if not antispoof.passed:
            return LivenessResult(
                passed=False,
                score=antispoof.live_score,
                face_count=face_count,
                det_score=det_score,
                checks=checks,
                reason=antispoof.reason or "spoof_detected",
                spoof_type=spoof_type,
            )
        score = antispoof.live_score

    if settings.active_liveness_enabled and liveness_frames:
        active = verify_active_liveness(liveness_frames)
        checks["active_liveness"] = active.checks
        checks["blink_detected"] = active.blink_detected
        checks["head_movement_detected"] = active.head_movement_detected
        if not active.passed:
            return LivenessResult(
                passed=False,
                score=active.score,
                face_count=face_count,
                det_score=det_score,
                checks=checks,
                reason=active.reason or "active_liveness_failed",
                spoof_type="video_replay" if active.reason == "blink_not_detected" else spoof_type,
            )
        score = min(1.0, (score + active.score) / 2)

    elif (
        settings.active_liveness_enabled
        and settings.active_liveness_require_frames
        and not liveness_frames
    ):
        return LivenessResult(
            passed=False,
            score=score,
            face_count=face_count,
            det_score=det_score,
            checks={**checks, "frames_required": True},
            reason="liveness_frames_required",
        )

    return LivenessResult(
        passed=True,
        score=score,
        face_count=face_count,
        det_score=det_score,
        checks=checks,
        spoof_type=None,
    )


def check_liveness(image_b64: str) -> tuple[bool, float]:
    """Backward-compatible wrapper."""
    from app.services.face_service import _analyze_image

    img, embedding, det_score, face_count, insightface_ok, bbox = _analyze_image(image_b64)
    result = verify_liveness(img, bbox, face_count, det_score, insightface_ok)
    return result.passed, result.score
