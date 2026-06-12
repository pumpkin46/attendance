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
    # Calibrated for ArcFace cosine similarity (genuine pairs ~0.4-0.7).
    assert cfg.search.auto_accept_threshold == 0.5
    assert cfg.search.review_threshold == 0.4
    assert cfg.attendance.duplicate_window_seconds == 300
    assert cfg.performance.max_recognition_ms == 300


def test_configure_from_settings_applies_overrides(monkeypatch):
    from app.engine.config import EngineConfig, configure_from_settings

    monkeypatch.setattr("app.core.config.settings.engine_auto_accept_threshold", 0.55)
    monkeypatch.setattr("app.core.config.settings.engine_review_threshold", 0.42)
    monkeypatch.setattr("app.core.config.settings.engine_liveness_threshold", 0.8)
    monkeypatch.setattr("app.core.config.settings.engine_duplicate_window_seconds", 120)

    cfg = configure_from_settings(EngineConfig())

    assert cfg.search.auto_accept_threshold == 0.55
    assert cfg.search.review_threshold == 0.42
    assert cfg.liveness.min_score == 0.8
    assert cfg.attendance.duplicate_window_seconds == 120


def test_engine_config_to_dict():
    data = engine_config.to_dict()
    assert "stream" in data
    assert "detection" in data
    assert "liveness" in data
    assert "scalability" in data
    assert data["scalability"]["max_employees"] == 100_000
