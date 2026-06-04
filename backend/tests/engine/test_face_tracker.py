"""Tests for multi-camera face tracking."""

import time

from app.engine.config import engine_config
from app.engine.face_tracker import FaceTrack, MultiCameraTracker


def test_compute_iou_identical_boxes():
    box = [10.0, 10.0, 110.0, 110.0]
    assert MultiCameraTracker._compute_iou(box, box) == 1.0


def test_compute_iou_no_overlap():
    a = [0.0, 0.0, 50.0, 50.0]
    b = [100.0, 100.0, 150.0, 150.0]
    assert MultiCameraTracker._compute_iou(a, b) == 0.0


def test_new_track_created_for_first_detection(make_face):
    tracker = MultiCameraTracker()
    face = make_face()

    results = tracker.update(camera_id=1, faces=[face])

    assert len(results) == 1
    _, track_info = results[0]
    assert track_info.is_new_track is True
    assert track_info.track_hits == 1
    assert track_info.needs_recognition is False
    assert tracker.total_active_tracks == 1


def test_same_bbox_reuses_track_id(make_face):
    tracker = MultiCameraTracker()
    face = make_face()

    first = tracker.update(camera_id=1, faces=[face])[0][1]
    engine_config.tracking.min_hits_for_recognition = 1

    second = tracker.update(camera_id=1, faces=[face])[0][1]

    assert first.track_id == second.track_id
    assert second.is_new_track is False
    assert second.track_hits == 2


def test_mark_recognized_applies_cooldown(make_face):
    tracker = MultiCameraTracker()
    engine_config.tracking.min_hits_for_recognition = 1
    engine_config.tracking.cooldown_seconds = 60.0

    face = make_face()
    track_id = tracker.update(camera_id=1, faces=[face])[0][1].track_id
    tracker.mark_recognized(1, track_id, "EMP001", 0.95)

    track = tracker.get_track(1, track_id)
    assert track is not None
    assert track.employee_id == "EMP001"
    assert track.needs_recognition is False


def test_needs_recognition_after_cooldown(make_face):
    tracker = MultiCameraTracker()
    engine_config.tracking.min_hits_for_recognition = 1
    engine_config.tracking.cooldown_seconds = 0.01

    face = make_face()
    track_id = tracker.update(camera_id=1, faces=[face])[0][1].track_id
    tracker.mark_recognized(1, track_id, "EMP001", 0.95)

    time.sleep(0.02)
    track = tracker.get_track(1, track_id)
    assert track is not None
    assert track.needs_recognition is True


def test_prune_removes_stale_tracks(make_face):
    tracker = MultiCameraTracker()
    engine_config.tracking.max_age_seconds = 0.01
    face = make_face()

    tracker.update(camera_id=1, faces=[face])
    time.sleep(0.02)
    tracker.update(camera_id=1, faces=[])

    assert tracker.total_active_tracks == 0


def test_face_track_stats(make_face):
    tracker = MultiCameraTracker()
    engine_config.tracking.min_hits_for_recognition = 1

    face = make_face()
    track_id = tracker.update(camera_id=1, faces=[face])[0][1].track_id
    tracker.mark_recognized(1, track_id, "EMP001", 0.92)

    stats = tracker.get_stats()
    assert stats["total_tracks"] == 1
    assert stats["recognized_tracks"] == 1
    assert stats["cameras_tracking"] == 1
