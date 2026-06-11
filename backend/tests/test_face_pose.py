"""Pose detection calibration tests using the canonical ArcFace 5-point
template — the frontal landmark geometry InsightFace kps follow. Guards
against threshold regressions that reject real frontal faces (the raw
nose-below-eyes pitch is ~0.57 eye-widths and a neutral mouth is ~0.83
eye-widths wide; naive zero-centered thresholds misclassify every face).
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from app.services.face_pose import (
    FRONT_YAW_TOLERANCE,
    analyze_face_metadata,
    pose_matches_expected,
)

# Canonical ArcFace alignment template (112x112): left eye, right eye,
# nose tip, left mouth corner, right mouth corner.
CANONICAL_KPS = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)
EYE_DIST = float(np.linalg.norm(CANONICAL_KPS[1] - CANONICAL_KPS[0]))


def make_face(kps: np.ndarray) -> SimpleNamespace:
    xs, ys = kps[:, 0], kps[:, 1]
    return SimpleNamespace(
        kps=kps,
        bbox=np.array([xs.min() - 15, ys.min() - 30, xs.max() + 15, ys.max() + 15]),
    )


def metadata_for(kps: np.ndarray) -> dict:
    return analyze_face_metadata(make_face(kps), img=None)


def shifted(nose_dx: float = 0.0, nose_dy: float = 0.0, mouth_dx: float = 0.0) -> np.ndarray:
    """Canonical landmarks with the nose moved (head turn/tilt) or the mouth
    widened (smile), expressed in eye-distance units."""
    kps = CANONICAL_KPS.copy()
    kps[2, 0] += nose_dx * EYE_DIST
    kps[2, 1] += nose_dy * EYE_DIST
    kps[3, 0] -= mouth_dx * EYE_DIST / 2
    kps[4, 0] += mouth_dx * EYE_DIST / 2
    return kps


class TestDetectedPose:
    def test_canonical_frontal_face_is_front(self):
        meta = metadata_for(CANONICAL_KPS)
        assert meta["detected_pose"] == "front"
        assert abs(meta["yaw"]) < 0.05
        assert abs(meta["pitch"]) < 0.05  # re-centered: 0 ≈ frontal

    def test_head_turns_detected(self):
        assert metadata_for(shifted(nose_dx=0.2))["detected_pose"] == "left"
        assert metadata_for(shifted(nose_dx=-0.2))["detected_pose"] == "right"

    def test_head_tilts_detected(self):
        assert metadata_for(shifted(nose_dy=-0.2))["detected_pose"] == "up"
        assert metadata_for(shifted(nose_dy=0.2))["detected_pose"] == "down"

    def test_wide_smile_detected(self):
        assert metadata_for(shifted(mouth_dx=0.14))["detected_pose"] == "smiling"

    def test_neutral_mouth_is_not_smiling(self):
        # A neutral mouth is already ~0.83 eye-widths wide; this must not be
        # misread as a smile (the original zero-centered bug).
        meta = metadata_for(CANONICAL_KPS)
        assert meta["smile_ratio"] > 0.7
        assert meta["detected_pose"] != "smiling"


class TestPoseMatchesExpected:
    def test_frontal_face_passes_front_slot(self):
        ok, reason = pose_matches_expected("front", metadata_for(CANONICAL_KPS))
        assert ok, reason

    def test_slightly_turned_face_still_passes_front_slot(self):
        # Inside the forgiving front window even though the detection bucket
        # already says "left".
        meta = metadata_for(shifted(nose_dx=FRONT_YAW_TOLERANCE - 0.02))
        assert meta["detected_pose"] == "left"
        ok, _ = pose_matches_expected("front", meta)
        assert ok

    def test_clearly_turned_face_fails_front_slot(self):
        ok, reason = pose_matches_expected("front", metadata_for(shifted(nose_dx=0.25)))
        assert not ok
        assert reason == "wrong_pose_expected_front_got_left"

    def test_directional_slots(self):
        assert pose_matches_expected("left", metadata_for(shifted(nose_dx=0.2)))[0]
        assert pose_matches_expected("right", metadata_for(shifted(nose_dx=-0.2)))[0]
        assert pose_matches_expected("up", metadata_for(shifted(nose_dy=-0.2)))[0]
        assert pose_matches_expected("down", metadata_for(shifted(nose_dy=0.2)))[0]

    def test_front_face_fails_directional_slots(self):
        ok, reason = pose_matches_expected("left", metadata_for(CANONICAL_KPS))
        assert not ok
        assert reason == "wrong_pose_expected_left_got_front"

    def test_expression_slots(self):
        smiling = metadata_for(shifted(mouth_dx=0.14))
        neutral = metadata_for(CANONICAL_KPS)
        assert pose_matches_expected("smiling", smiling)[0]
        assert not pose_matches_expected("smiling", neutral)[0]
        assert pose_matches_expected("neutral", neutral)[0]
        assert not pose_matches_expected("neutral", smiling)[0]

    def test_no_landmarks_passes(self):
        meta = analyze_face_metadata(SimpleNamespace(kps=None, bbox=None), img=None)
        ok, reason = pose_matches_expected("front", meta)
        assert ok and reason is None
