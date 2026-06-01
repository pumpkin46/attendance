"""Liveness uses the same InsightFace detector as enrollment (not Haar cascade)."""

from __future__ import annotations

from app.core.config import settings


def passes_liveness(face_count: int, det_score: float, insightface_available: bool) -> tuple[bool, float]:
    """
    Pass when InsightFace finds exactly one face above min detection score.
    If InsightFace is unavailable (mock mode), liveness is skipped (pass).
    """
    if not insightface_available:
        return True, det_score

    if face_count != 1:
        return False, det_score

    passed = det_score >= settings.liveness_min_det_score
    return passed, det_score


def check_liveness(image_b64: str) -> tuple[bool, float]:
    """Backward-compatible wrapper (older imports / cached bytecode)."""
    from app.services.face_service import _analyze_image

    _, det_score, face_count, insightface_ok = _analyze_image(image_b64)
    return passes_liveness(face_count, det_score, insightface_ok)
