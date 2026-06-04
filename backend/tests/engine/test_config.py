"""Tests for engine configuration."""

from app.engine.config import EngineConfig, engine_config


def test_engine_config_defaults():
    cfg = EngineConfig()
    assert cfg.stream.min_fps == 15
    assert cfg.stream.max_latency_ms == 500
    assert cfg.detection.min_face_size == 40
    assert cfg.detection.max_faces_per_frame == 100
    assert cfg.tracking.max_tracks == 200
    assert cfg.quality.min_quality_score == 0.70
    assert cfg.liveness.min_score == 0.85
    assert cfg.search.auto_accept_threshold == 0.90
    assert cfg.search.review_threshold == 0.80
    assert cfg.attendance.duplicate_window_seconds == 300
    assert cfg.performance.max_recognition_ms == 300


def test_engine_config_to_dict():
    data = engine_config.to_dict()
    assert "stream" in data
    assert "detection" in data
    assert "liveness" in data
    assert "scalability" in data
    assert data["scalability"]["max_employees"] == 100_000
