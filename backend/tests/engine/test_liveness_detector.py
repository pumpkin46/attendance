"""Tests for liveness detection."""

from app.engine.config import engine_config
from app.engine.liveness_detector import LivenessDetector


def test_liveness_disabled_passes(sample_frame, make_face):
    detector = LivenessDetector()
    engine_config.liveness.enabled = False
    face = make_face(confidence=0.95)

    result = detector.verify(sample_frame, face)

    assert result.passed is True
    assert result.is_live is True
    assert result.score == 1.0


def test_passive_check_detects_live_texture(sample_frame, make_face):
    detector = LivenessDetector()
    engine_config.liveness.enabled = True
    engine_config.liveness.passive_enabled = True
    engine_config.liveness.active_enabled = False
    engine_config.liveness.min_score = 0.35
    face = make_face(confidence=0.95)

    result = detector.verify(sample_frame, face, require_active=False)

    assert result.passed is True
    assert result.passive_score >= engine_config.liveness.min_score


def test_uniform_region_fails_passive_check(make_face):
    detector = LivenessDetector()
    engine_config.liveness.enabled = True
    engine_config.liveness.min_score = 0.85

    flat = __import__("numpy").full((240, 320, 3), 128, dtype=__import__("numpy").uint8)
    face = make_face(confidence=0.95)
    passive = detector._passive_check(flat, face)

    assert passive["score"] < engine_config.liveness.min_score
    assert passive.get("spoof_type") is not None


def test_active_check_requires_minimum_frames(make_face):
    detector = LivenessDetector()
    frames = [__import__("numpy").zeros((120, 160, 3), dtype=__import__("numpy").uint8)]
    face = make_face()

    result = detector._active_check(frames, face)

    assert result["score"] == 0.0
    assert result["reason"] == "insufficient_frames"


def test_liveness_result_to_dict(sample_frame, make_face):
    detector = LivenessDetector()
    engine_config.liveness.enabled = False
    face = make_face(confidence=0.95)

    payload = detector.verify(sample_frame, face).to_dict()

    assert payload["passed"] is True
    assert payload["is_live"] is True
    assert "verification_ms" in payload
