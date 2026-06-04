"""Tests for unknown person detection."""

from app.engine.config import engine_config
from app.engine.unknown_detector import UnknownPersonDetector


def test_process_unknown_saves_event(tmp_path, sample_frame):
    detector = UnknownPersonDetector(snapshot_dir=str(tmp_path))
    engine_config.unknown_person.enabled = True
    engine_config.unknown_person.alert_cooldown_seconds = 0

    event = detector.process_unknown(
        sample_frame,
        camera_id=5,
        location_id=2,
        zone="Lobby",
        confidence=0.12,
        bbox=[100.0, 60.0, 220.0, 180.0],
    )

    assert event is not None
    assert event.camera_id == 5
    assert event.zone == "Lobby"
    assert event.snapshot_path is not None
    assert event.notified is True
    assert detector.stats["total_detections"] == 1
    assert detector.stats["alerts_generated"] == 1


def test_cooldown_prevents_duplicate_alerts(tmp_path, sample_frame):
    detector = UnknownPersonDetector(snapshot_dir=str(tmp_path))
    engine_config.unknown_person.enabled = True
    engine_config.unknown_person.alert_cooldown_seconds = 300

    first = detector.process_unknown(
        sample_frame,
        camera_id=5,
        bbox=[100.0, 60.0, 220.0, 180.0],
    )
    second = detector.process_unknown(
        sample_frame,
        camera_id=5,
        bbox=[100.0, 60.0, 220.0, 180.0],
    )

    assert first is not None
    assert second is None
    assert detector.stats["total_detections"] == 2
    assert detector.stats["alerts_generated"] == 1


def test_disabled_returns_none(tmp_path, sample_frame):
    detector = UnknownPersonDetector(snapshot_dir=str(tmp_path))
    engine_config.unknown_person.enabled = False

    event = detector.process_unknown(sample_frame, camera_id=1)
    assert event is None


def test_alert_callback_invoked(tmp_path, sample_frame):
    detector = UnknownPersonDetector(snapshot_dir=str(tmp_path))
    engine_config.unknown_person.enabled = True
    engine_config.unknown_person.alert_cooldown_seconds = 0

    seen = []

    def callback(event):
        seen.append(event.event_id)

    detector.register_alert_callback(callback)
    event = detector.process_unknown(sample_frame, camera_id=1, bbox=[10, 10, 110, 110])

    assert event is not None
    assert seen == [event.event_id]


def test_get_recent_events(tmp_path, sample_frame):
    detector = UnknownPersonDetector(snapshot_dir=str(tmp_path))
    engine_config.unknown_person.enabled = True
    engine_config.unknown_person.alert_cooldown_seconds = 0

    detector.process_unknown(sample_frame, camera_id=1, bbox=[10, 10, 110, 110])
    detector.process_unknown(sample_frame, camera_id=2, bbox=[120, 10, 220, 110])

    events = detector.get_recent_events(limit=10)
    assert len(events) == 2
