"""Recognition quality gate is advisory by default (lenient recognition).

A blurry/dim frame with a detectable face should still be matched, unless
recognition_require_quality is enabled. Enrollment is unaffected (separate path).
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

import app.services.recognition_pipeline as rp


@pytest.fixture
def stub_pipeline(monkeypatch):
    """Stub detection/quality/liveness/index so we can drive the pipeline without
    InsightFace or a real face image. Quality is forced to fail ("blurry")."""
    face = SimpleNamespace(
        bbox=np.array([100, 80, 300, 360], dtype=np.float32),
        det_score=0.9,
        embedding=np.ones(512, dtype=np.float32),
        kps=np.array([[150, 160], [250, 160], [200, 240], [160, 300], [240, 300]], dtype=np.float32),
    )
    monkeypatch.setattr(rp, "_decode_image", lambda b64: np.zeros((480, 640, 3), dtype=np.uint8))
    monkeypatch.setattr(rp, "_get_faces", lambda img: (object(), [face]))
    monkeypatch.setattr(
        rp, "validate_face_image",
        lambda img, faces: {"accepted": False, "reason": "blurry", "quality_score": 0.1, "checks": {}},
    )
    monkeypatch.setattr(rp, "assign_track", lambda sid, bbox: {"track_id": "t1"})
    monkeypatch.setattr(
        rp, "verify_liveness",
        lambda *a, **k: SimpleNamespace(passed=True, score=0.9, reason=None, face_count=1, checks={}, spoof_type=None),
    )
    monkeypatch.setattr(rp, "get_index", lambda: SimpleNamespace(search=lambda emb: ("1", 0.7)))


def test_blurry_frame_still_matches_by_default(stub_pipeline, monkeypatch):
    monkeypatch.setattr(rp.settings, "recognition_require_quality", False)
    monkeypatch.setattr(rp.settings, "recognition_threshold", 0.5)

    result = rp.recognize("img", require_liveness=False)

    assert result["matched"] is True
    assert result["employee_id"] == "1"
    # Quality was still measured and reported, just not enforced.
    quality_stage = next(s for s in result["pipeline"] if s["stage"] == "face_quality_check")
    assert quality_stage["reason"] == "blurry"
    assert quality_stage["enforced"] is False


def test_blurry_frame_rejected_when_quality_enforced(stub_pipeline, monkeypatch):
    monkeypatch.setattr(rp.settings, "recognition_require_quality", True)

    result = rp.recognize("img", require_liveness=False)

    assert result["matched"] is False
    assert result["reason"] == "blurry"
    assert result["employee_id"] is None
