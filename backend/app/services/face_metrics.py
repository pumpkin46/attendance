"""Shared low-level face-image scoring primitives.

Pure functions over numpy arrays and 5-point landmarks, used by *both* the
request-scoped quality path ([`services.face_quality`]) and the streaming
pipeline ([`engine.quality_assessor`], [`engine.liveness_detector`]). Each
caller supplies its own reference constants and strictness so the two worlds
keep their distinct tuning — only the underlying math lives here, once.

See [`engine/README.md`](../engine/README.md) for the engine/services boundary.
"""

from __future__ import annotations

import cv2
import numpy as np


def blur_score(gray: np.ndarray, variance_ref: float) -> float:
    """Laplacian-variance sharpness, normalized to 0..1 against ``variance_ref``."""
    if gray.size == 0:
        return 0.0
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    return float(min(1.0, variance / variance_ref))


def brightness_score(gray: np.ndarray, *, clamp_extreme: bool = False) -> float:
    """Mean-luminance score; maps 40–180 mean luminance to 0..1.

    When ``clamp_extreme`` is set, very dark/bright crops (mean < 40 or > 220)
    are scored by distance from a 130 mid-grey instead of clipping to 0 — the
    per-frame pipeline distinguishes over- from under-exposure this way, while
    the single-shot enrollment path leaves them clipped.
    """
    if gray.size == 0:
        return 0.0
    mean = float(np.mean(gray))
    if clamp_extreme and (mean < 40 or mean > 220):
        return max(0.0, 1.0 - abs(mean - 130) / 130.0)
    return float(np.clip((mean - 40.0) / 140.0, 0.0, 1.0))


def resolution_score(face_min_dim: float, min_face_pixels: float) -> float:
    """Smaller face dimension normalized against the minimum acceptable size."""
    return float(min(1.0, face_min_dim / min_face_pixels))


def occlusion_score(
    landmarks: np.ndarray | None,
    face_width: float,
    img_shape: tuple[int, ...],
    *,
    strict: bool = False,
) -> float:
    """Estimate face visibility from 5-point landmarks; lower = more occluded.

    ``strict`` adds mouth-width and nose-position gates (used by the single-shot
    enrollment path); the per-frame pipeline gates on eye distance only.
    """
    if landmarks is None or len(landmarks) < 5:
        return 0.75

    pts = np.asarray(landmarks, dtype=np.float32)
    xs, ys = pts[:, 0], pts[:, 1]
    h, w = img_shape[:2]
    if np.any(xs < 0) or np.any(ys < 0) or np.any(xs >= w) or np.any(ys >= h):
        return 0.2

    left_eye, right_eye, nose, left_mouth, right_mouth = pts[:5]
    eye_dist = float(np.linalg.norm(right_eye - left_eye))
    if eye_dist < 10:
        return 0.25

    if strict:
        mouth_dist = float(np.linalg.norm(right_mouth - left_mouth))
        nose_to_eyes = float(np.linalg.norm(nose - (left_eye + right_eye) / 2))
        if mouth_dist < 5 or nose_to_eyes < 5:
            return 0.25

    ratio = eye_dist / max(face_width, 1.0)
    if ratio < 0.18 or ratio > 0.55:
        return 0.35

    return float(min(1.0, 0.5 + ratio))
