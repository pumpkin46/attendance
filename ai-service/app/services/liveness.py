"""Multi-layer liveness: face quality + anti-spoof (print/screen) detection."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.core.config import settings
from app.services.antispoof import get_antispoof_verifier


@dataclass
class LivenessResult:
    passed: bool
    score: float
    face_count: int
    det_score: float
    checks: dict = field(default_factory=dict)
    reason: str | None = None


def verify_liveness(
    image: np.ndarray | None,
    bbox_xyxy: list[float] | None,
    face_count: int,
    det_score: float,
    insightface_available: bool,
) -> LivenessResult:
    """
    Layer 1: exactly one face with sufficient detection confidence.
    Layer 2: MiniFASNet anti-spoof ONNX (blocks photos & screen replays).
    Layer 3: texture / moiré heuristics (fallback & ensemble).
    """
    checks: dict = {
        "single_face": face_count == 1,
        "det_score_ok": det_score >= settings.liveness_min_det_score,
        "det_score": round(det_score, 4),
        "face_count": face_count,
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

    if settings.antispoof_enabled:
        antispoof = get_antispoof_verifier().verify(image, bbox_xyxy)
        checks["antispoof"] = antispoof.checks
        if not antispoof.passed:
            return LivenessResult(
                passed=False,
                score=antispoof.live_score,
                face_count=face_count,
                det_score=det_score,
                checks=checks,
                reason=antispoof.reason or "spoof_detected",
            )
        score = antispoof.live_score
    else:
        score = det_score

    return LivenessResult(
        passed=True,
        score=score,
        face_count=face_count,
        det_score=det_score,
        checks=checks,
    )


def check_liveness(image_b64: str) -> tuple[bool, float]:
    """Backward-compatible wrapper."""
    from app.services.face_service import _analyze_image

    img, embedding, det_score, face_count, insightface_ok, bbox = _analyze_image(image_b64)
    result = verify_liveness(img, bbox, face_count, det_score, insightface_ok)
    return result.passed, result.score
