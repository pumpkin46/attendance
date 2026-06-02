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
    pitch = float((nose[1] - eye_center[1]) / eye_dist)
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

    if smile >= 0.72:
        return "smiling"
    if yaw <= -0.14:
        return "right"
    if yaw >= 0.14:
        return "left"
    if pitch <= -0.10:
        return "up"
    if pitch >= 0.12:
        return "down"
    if abs(yaw) < 0.08 and abs(pitch) < 0.08:
        return "front"
    return "neutral"


def _glasses_hint(face, img: np.ndarray | None) -> bool | None:
    """Weak heuristic on eye regions; None when landmarks unavailable."""
    pts = _landmarks(face)
    if pts is None or img is None:
        return None

    left_eye, right_eye = pts[0], pts[1]
    import cv2

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scores: list[float] = []
    for eye in (left_eye, right_eye):
        cx, cy = int(eye[0]), int(eye[1])
        r = max(int(w * 0.04), 8)
        x1, y1 = max(0, cx - r), max(0, cy - r)
        x2, y2 = min(w, cx + r), min(h, cy + r)
        patch = gray[y1:y2, x1:x2]
        if patch.size < 16:
            continue
        edges = cv2.Canny(patch, 50, 150)
        scores.append(float(np.mean(edges > 0)))

    if not scores:
        return None
    return float(np.mean(scores)) > 0.12


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
        if metadata.get("smile_ratio", 0) < 0.65:
            return False, "not_smiling"
        return True, None

    if expected == "neutral":
        if metadata.get("smile_ratio", 1) >= 0.72:
            return False, "not_neutral"
        return True, None

    compatible = {
        "front": {"front", "neutral"},
        "left": {"left"},
        "right": {"right"},
        "up": {"up"},
        "down": {"down"},
    }
    allowed = compatible.get(expected, {expected})
    if detected in allowed:
        return True, None
    return False, f"wrong_pose_expected_{expected}_got_{detected}"
