"""Tests for the main recognition engine orchestrator."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.engine.attendance_generator import AttendanceEventType
from app.engine.config import EngineConfig
from app.engine.face_detector import DetectedFace, DetectionResult
from app.engine.liveness_detector import LivenessResult
from app.engine.quality_assessor import QualityAssessment
from app.engine.recognition_engine import RecognitionEngine
from app.engine.vector_search import MatchAction, SearchMatch, SearchResult


@pytest.fixture
def engine():
    return RecognitionEngine(config=EngineConfig())


def test_recognize_image_invalid_base64(engine):
    result = engine.recognize_image("not-valid-base64!!!")

    assert result.success is False
    assert result.reason == "invalid_image"


def test_recognize_image_no_face(engine, monkeypatch, sample_frame):
    monkeypatch.setattr(
        engine._detector,
        "detect",
        lambda frame: DetectionResult([], 320, 240, 5, "mock"),
    )

    import base64
    import io

    from PIL import Image

    pil = Image.fromarray(sample_frame[:, :, ::-1])
    buf = io.BytesIO()
    pil.save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    result = engine.recognize_image(b64)

    assert result.success is True
    assert result.reason == "no_face_detected"


def test_recognize_face_full_pipeline(engine, sample_frame, make_face, sample_embedding, temp_faiss_paths):
    face = make_face(embedding=sample_embedding)
    quality = QualityAssessment(
        accepted=True,
        quality_score=0.92,
        blur_score=0.8,
        brightness_score=0.8,
        resolution_score=0.8,
        occlusion_score=0.8,
        angle_valid=True,
        yaw=0.0,
        pitch=0.0,
        roll=0.0,
        assessment_ms=5,
    )
    liveness = LivenessResult(
        passed=True,
        score=0.91,
        is_live=True,
        verification_ms=10,
    )
    search = SearchResult(
        top_match=SearchMatch("EMP001", 0.96, 1),
        matches=[SearchMatch("EMP001", 0.96, 1)],
        action=MatchAction.AUTO_ACCEPT,
        search_ms=3,
        index_size=1,
    )

    engine._quality_assessor.assess = MagicMock(return_value=quality)
    engine._liveness_detector.verify = MagicMock(return_value=liveness)
    engine._vector_search.search = MagicMock(return_value=search)
    engine._vector_search.add_embedding("EMP001", sample_embedding)

    result = engine.recognize_face(
        sample_frame,
        face,
        camera_id=2,
        direction="in",
    )

    assert result.matched is True
    assert result.employee_id == "EMP001"
    assert result.liveness_passed is True
    assert result.event_type == AttendanceEventType.CHECK_IN.value
    assert result.attendance_event is not None
    assert any(stage["stage"] == "quality_assessment" for stage in result.pipeline_stages)


def test_recognize_face_unknown_person(engine, sample_frame, make_face, sample_embedding):
    face = make_face(embedding=sample_embedding)
    quality = QualityAssessment(
        accepted=True,
        quality_score=0.90,
        blur_score=0.8,
        brightness_score=0.8,
        resolution_score=0.8,
        occlusion_score=0.8,
        angle_valid=True,
        yaw=0.0,
        pitch=0.0,
        roll=0.0,
    )
    liveness = LivenessResult(passed=True, score=0.90, is_live=True)
    search = SearchResult(
        top_match=SearchMatch("EMP999", 0.55, 1),
        matches=[SearchMatch("EMP999", 0.55, 1)],
        action=MatchAction.UNKNOWN,
        search_ms=2,
        index_size=1,
    )

    engine._quality_assessor.assess = MagicMock(return_value=quality)
    engine._liveness_detector.verify = MagicMock(return_value=liveness)
    engine._vector_search.search = MagicMock(return_value=search)

    with patch.object(engine._unknown_detector, "process_unknown", return_value=MagicMock()) as mock_unknown:
        result = engine.recognize_face(sample_frame, face, camera_id=4)

    assert result.matched is False
    assert result.is_unknown is True
    mock_unknown.assert_called_once()


def test_recognize_face_forwards_require_active_to_liveness(
    engine, sample_frame, make_face, sample_embedding, temp_faiss_paths
):
    # The live path (when ENGINE_LIVE_ACTIVE_LIVENESS is on) must hand the
    # buffered frames and require_active flag to the liveness detector, instead
    # of the previously hardcoded passive-only call.
    face = make_face(embedding=sample_embedding)
    quality = QualityAssessment(
        accepted=True, quality_score=0.92, blur_score=0.8, brightness_score=0.8,
        resolution_score=0.8, occlusion_score=0.8, angle_valid=True,
        yaw=0.0, pitch=0.0, roll=0.0, assessment_ms=5,
    )
    liveness = LivenessResult(passed=True, score=0.91, is_live=True, verification_ms=10)
    search = SearchResult(
        top_match=SearchMatch("EMP001", 0.96, 1),
        matches=[SearchMatch("EMP001", 0.96, 1)],
        action=MatchAction.AUTO_ACCEPT, search_ms=3, index_size=1,
    )
    engine._quality_assessor.assess = MagicMock(return_value=quality)
    engine._liveness_detector.verify = MagicMock(return_value=liveness)
    engine._vector_search.search = MagicMock(return_value=search)
    engine._vector_search.add_embedding("EMP001", sample_embedding)

    frames = [sample_frame, sample_frame, sample_frame]
    engine.recognize_face(
        sample_frame, face, camera_id=2, liveness_frames=frames, require_active=True
    )

    _, kwargs = engine._liveness_detector.verify.call_args
    assert kwargs.get("require_active") is True
    assert kwargs.get("liveness_frames") == frames


def test_engine_status_reports_live_liveness_mode():
    cfg = EngineConfig()
    eng = RecognitionEngine(config=cfg)
    assert eng.get_engine_status()["liveness"]["live_mode"] == "passive_only"

    cfg.liveness.live_active_required = True
    assert eng.get_engine_status()["liveness"]["live_mode"] == "passive+active"

    cfg.liveness.enabled = False
    assert eng.get_engine_status()["liveness"]["live_mode"] == "disabled"


def test_detect_faces_returns_structured_payload(engine, sample_frame, make_face, monkeypatch):
    face = make_face()
    monkeypatch.setattr(
        engine._detector,
        "detect",
        lambda frame: DetectionResult([face], 320, 240, 8, "mock"),
    )

    import base64
    import io

    from PIL import Image

    pil = Image.fromarray(sample_frame[:, :, ::-1])
    buf = io.BytesIO()
    pil.save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    payload = engine.detect_faces(b64)

    assert payload["success"] is True
    assert payload["face_count"] == 1
    assert payload["faces"][0]["face_id"] == face.face_id
