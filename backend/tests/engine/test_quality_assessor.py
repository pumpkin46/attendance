"""Tests for face quality assessment."""

import numpy as np

from app.engine.config import engine_config
from app.engine.quality_assessor import QualityAssessor


def test_accepts_high_quality_face(sample_frame, make_face, sample_embedding):
    assessor = QualityAssessor()
    face = make_face(confidence=0.98, embedding=sample_embedding)

    result = assessor.assess(sample_frame, face)

    assert result.accepted is True
    assert result.quality_score >= engine_config.quality.min_quality_score
    assert result.angle_valid is True
    assert result.rejection_reason is None


def test_rejects_blurry_face(sample_frame, make_face):
    assessor = QualityAssessor()
    face = make_face(confidence=0.98)

    blurry = np.zeros_like(sample_frame)
    result = assessor.assess(blurry, face)

    assert result.accepted is False
    assert result.rejection_reason == "blurry"


def test_rejects_small_face_resolution(sample_frame, make_face):
    assessor = QualityAssessor()
    face = make_face(width=20.0, height=20.0, confidence=0.98)

    result = assessor.assess(sample_frame, face)

    assert result.accepted is False
    assert result.rejection_reason in ("low_resolution", "blurry", "low_quality", "occluded")


def test_rejects_extreme_yaw(sample_frame, make_face):
    assessor = QualityAssessor()
    engine_config.quality.min_blur_score = 0.0
    landmarks = np.array(
        [
            [120, 80],
            [180, 80],
            [250, 120],
            [130, 150],
            [170, 150],
        ],
        dtype=np.float32,
    )
    face = make_face(confidence=0.98, landmarks=landmarks)

    result = assessor.assess(sample_frame, face)

    assert result.accepted is False
    assert result.rejection_reason == "extreme_angle"


def test_quality_result_to_dict(sample_frame, make_face, sample_embedding):
    assessor = QualityAssessor()
    face = make_face(confidence=0.98, embedding=sample_embedding)
    payload = assessor.assess(sample_frame, face).to_dict()

    assert "quality_score" in payload
    assert "blur_score" in payload
    assert "pose" in payload
    assert payload["assessment_ms"] >= 0
