"""Pose, expression, and glasses hints from InsightFace 5-point landmarks."""

from __future__ import annotations

from typing import Any

import numpy as np

# Canonical enrollment pose slots (order used by guided UI)
ENROLLMENT_POSE_TYPES: tuple[str, ...] = (
    "front",
    "left",
    "right",
    "up",
    "down",
    "smiling",
    "neutral",
    "glasses",
    "without_glasses",
)

POSE_LABELS: dict[str, str] = {
    "front": "Front face",
    "left": "Turn left (show right cheek)",
    "right": "Turn right (show left cheek)",
    "up": "Look up slightly",
    "down": "Look down slightly",
    "smiling": "Smiling expression",
    "neutral": "Neutral expression",
    "glasses": "Wearing glasses",
    "without_glasses": "Without glasses",
}

# ── Calibration ──────────────────────────────────────────────────────────
# Raw landmark ratios are NOT centered at zero for a frontal face. On the
# canonical ArcFace 5-point template (the geometry InsightFace kps follow)
# the nose tip sits ~0.57 eye-widths BELOW the eye line and the mouth is
# ~0.83 eye-widths wide on a neutral face. Pitch is therefore re-centered by
# PITCH_FRONTAL_BASELINE so 0 ≈ canonical frontal, and the smile thresholds
# sit above the 0.83 neutral baseline.
PITCH_FRONTAL_BASELINE = 0.57

YAW_TURN_THRESHOLD = 0.14   # |yaw| at/beyond this = head turned left/right
PITCH_UP_THRESHOLD = -0.12  # re-centered pitch at/below this = looking up
PITCH_DOWN_THRESHOLD = 0.1  # re-centered pitch at/above this = looking down
SMILE_THRESHOLD = 0.92      # smile_ratio at/above this = smiling
SMILE_MIN_FOR_SMILING_SLOT = 0.90  # slight margin so a clear smile passes

# Acceptance window for the "front" slot — deliberately looser than the
# detection buckets above so a near-straight face still passes.
FRONT_YAW_TOLERANCE = 0.18
FRONT_PITCH_TOLERANCE = 0.16


def _landmarks(face) -> np.ndarray | None:
    kps = getattr(face, "kps", None)
    if kps is None or len(kps) < 5:
        return None
    return np.array(kps, dtype=np.float32)


def _angles_and_expression(pts: np.ndarray) -> dict[str, float]:
    left_eye, right_eye, nose, left_mouth, right_mouth = pts[:5]
    eye_center = (left_eye + right_eye) / 2.0
    eye_dist = max(float(np.linalg.norm(right_eye - left_eye)), 1.0)
    mouth_center = (left_mouth + right_mouth) / 2.0
    mouth_width = float(np.linalg.norm(right_mouth - left_mouth))

    yaw = float((nose[0] - eye_center[0]) / eye_dist)
    # Re-centered so 0 ≈ frontal; negative = looking up, positive = down.
    pitch = float((nose[1] - eye_center[1]) / eye_dist - PITCH_FRONTAL_BASELINE)
    smile_ratio = mouth_width / eye_dist
    mouth_lift = float((eye_center[1] - mouth_center[1]) / eye_dist)

    return {
        "yaw": round(yaw, 4),
        "pitch": round(pitch, 4),
        "smile_ratio": round(smile_ratio, 4),
        "mouth_lift": round(mouth_lift, 4),
    }


def _detected_pose(metrics: dict[str, float]) -> str:
    yaw = metrics["yaw"]
    pitch = metrics["pitch"]
    smile = metrics["smile_ratio"]

    # Head orientation first: turning the head shrinks the projected eye
    # distance, which inflates smile_ratio and would misread turns as smiles.
    if yaw <= -YAW_TURN_THRESHOLD:
        return "right"
    if yaw >= YAW_TURN_THRESHOLD:
        return "left"
    if pitch <= PITCH_UP_THRESHOLD:
        return "up"
    if pitch >= PITCH_DOWN_THRESHOLD:
        return "down"
    if smile >= SMILE_THRESHOLD:
        return "smiling"
    if abs(yaw) < 0.10 and abs(pitch) < 0.10:
        return "front"
    return "neutral"


def _edge_density(gray: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> float | None:
    """Fraction of Canny edge pixels in a clamped patch; None if degenerate."""
    import cv2

    h, w = gray.shape[:2]
    xa, ya = max(0, int(x1)), max(0, int(y1))
    xb, yb = min(w, int(x2)), min(h, int(y2))
    patch = gray[ya:yb, xa:xb]
    if patch.size < 16:
        return None
    edges = cv2.Canny(patch, 60, 140)
    return float(np.mean(edges > 0))


# Glasses evidence thresholds (edge density in face-scaled rim bands, judged
# against a smooth-cheek control patch). Between the two bounds the heuristic
# answers None = "cannot verify", which pose_matches_expected treats as a
# pass — only confident verdicts can reject a capture.
GLASSES_RIM_MIN_DENSITY = 0.04
GLASSES_RIM_VS_CHEEK = 1.8
NO_GLASSES_MAX_DENSITY = 0.025
NO_GLASSES_VS_CHEEK = 1.1


def _glasses_hint(face, img: np.ndarray | None) -> bool | None:
    """Three-way glasses hint from frame-rim edge evidence.

    Samples bands where rims actually sit — below each eye (lower rim) and
    across the nose bridge — all scaled by eye distance so face size in frame
    doesn't dilute the signal, and compares against a smooth-cheek control
    patch to cancel lighting/texture/JPEG noise. Returns None when the
    evidence is ambiguous (or landmarks/image are unavailable).
    """
    pts = _landmarks(face)
    if pts is None or img is None:
        return None

    left_eye, right_eye = pts[0], pts[1]
    d = float(np.linalg.norm(right_eye - left_eye))
    if d < 16:  # face too small to judge rim edges
        return None

    import cv2

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    rim_scores: list[float] = []
    cheek_scores: list[float] = []
    for cx, cy in (left_eye, right_eye):
        # Band just below the eye where a lower rim crosses; bare skin otherwise.
        s = _edge_density(gray, cx - 0.35 * d, cy + 0.15 * d, cx + 0.35 * d, cy + 0.45 * d)
        if s is not None:
            rim_scores.append(s)
        # Smooth-cheek control further down the face.
        c = _edge_density(gray, cx - 0.20 * d, cy + 0.55 * d, cx + 0.20 * d, cy + 0.85 * d)
        if c is not None:
            cheek_scores.append(c)

    # Bridge of the frame across the nose, between the eyes.
    mid = (left_eye + right_eye) / 2.0
    b = _edge_density(gray, mid[0] - 0.25 * d, mid[1] - 0.10 * d, mid[0] + 0.25 * d, mid[1] + 0.25 * d)
    if b is not None:
        rim_scores.append(b)

    if not rim_scores or not cheek_scores:
        return None

    rim = float(np.mean(rim_scores))
    cheek = float(np.mean(cheek_scores))
    if rim >= max(GLASSES_RIM_MIN_DENSITY, GLASSES_RIM_VS_CHEEK * cheek):
        return True
    if rim <= max(NO_GLASSES_MAX_DENSITY, NO_GLASSES_VS_CHEEK * cheek):
        return False
    return None


def analyze_face_metadata(face, img: np.ndarray | None = None) -> dict[str, Any]:
    pts = _landmarks(face)
    if pts is None:
        return {
            "detected_pose": None,
            "yaw": None,
            "pitch": None,
            "smile_ratio": None,
            "glasses_detected": None,
        }

    metrics = _angles_and_expression(pts)
    glasses = _glasses_hint(face, img)
    bb = face.bbox
    face_w = max(float(bb[2] - bb[0]), 1.0)
    face_h = max(float(bb[3] - bb[1]), 1.0)

    return {
        "detected_pose": _detected_pose(metrics),
        "yaw": metrics["yaw"],
        "pitch": metrics["pitch"],
        "smile_ratio": metrics["smile_ratio"],
        "mouth_lift": metrics["mouth_lift"],
        "glasses_detected": glasses,
        "face_bbox": [float(v) for v in bb],
        "face_width_px": round(face_w, 1),
        "face_height_px": round(face_h, 1),
    }


def pose_matches_expected(expected: str, metadata: dict[str, Any]) -> tuple[bool, str | None]:
    """Return whether captured image matches the guided pose slot."""
    detected = metadata.get("detected_pose")
    if detected is None:
        return True, None  # cannot verify without landmarks

    if expected in ("glasses", "without_glasses"):
        glasses = metadata.get("glasses_detected")
        if glasses is None:
            return True, None
        if expected == "glasses" and not glasses:
            return False, "glasses_not_detected"
        if expected == "without_glasses" and glasses:
            return False, "glasses_detected"
        return True, None

    if expected == "smiling":
        if metadata.get("smile_ratio", 0) < SMILE_MIN_FOR_SMILING_SLOT:
            return False, "not_smiling"
        return True, None

    if expected == "neutral":
        if metadata.get("smile_ratio", 0) >= SMILE_THRESHOLD:
            return False, "not_neutral"
        return True, None

    if expected == "front":
        # Judge head orientation directly with a forgiving window instead of
        # the tighter detection buckets; expression is irrelevant here.
        yaw = metadata.get("yaw")
        pitch = metadata.get("pitch")
        if yaw is not None and pitch is not None:
            if abs(yaw) <= FRONT_YAW_TOLERANCE and abs(pitch) <= FRONT_PITCH_TOLERANCE:
                return True, None
            return False, f"wrong_pose_expected_front_got_{detected}"
        if detected in ("front", "neutral"):
            return True, None
        return False, f"wrong_pose_expected_front_got_{detected}"

    compatible = {
        "left": {"left"},
        "right": {"right"},
        "up": {"up"},
        "down": {"down"},
    }
    allowed = compatible.get(expected, {expected})
    if detected in allowed:
        return True, None
    return False, f"wrong_pose_expected_{expected}_got_{detected}"
