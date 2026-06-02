"""FR-007: Face quality validation — blur, occlusion, single face."""

from __future__ import annotations

import cv2
import numpy as np

from app.core.config import settings


def _blur_score(gray_crop: np.ndarray) -> float:
    if gray_crop.size == 0:
        return 0.0
    variance = cv2.Laplacian(gray_crop, cv2.CV_64F).var()
    return float(min(1.0, variance / settings.quality_blur_variance_ref))


def _occlusion_score(face, img_shape: tuple[int, int, int]) -> float:
    """
    Estimate face visibility using landmarks when available.
    Low score suggests covered/partial face.
    """
    kps = getattr(face, "kps", None)
    if kps is None or len(kps) < 5:
        return 0.75

    h, w = img_shape[:2]
    pts = np.array(kps, dtype=np.float32)
    xs, ys = pts[:, 0], pts[:, 1]

    if np.any(xs < 0) or np.any(ys < 0) or np.any(xs >= w) or np.any(ys >= h):
        return 0.2

    left_eye, right_eye, nose, left_mouth, right_mouth = pts[:5]
    eye_dist = float(np.linalg.norm(right_eye - left_eye))
    mouth_dist = float(np.linalg.norm(right_mouth - left_mouth))
    nose_to_eyes = float(np.linalg.norm(nose - (left_eye + right_eye) / 2))

    if eye_dist < 10 or mouth_dist < 5 or nose_to_eyes < 5:
        return 0.25

    bb = face.bbox
    face_w = max(float(bb[2] - bb[0]), 1.0)
    ratio = eye_dist / face_w
    if ratio < 0.18 or ratio > 0.55:
        return 0.35

    return min(1.0, 0.5 + ratio)


def validate_face_image(img: np.ndarray, faces: list) -> dict:
    """
    Validate a single image for enrollment (FR-007).
    Returns accepted flag, reason, quality_score, and check details.
    """
    if img is None:
        return _reject("invalid_image", 0.0, {"face_count": 0})

    face_count = len(faces)
    if face_count == 0:
        return _reject("no_face", 0.0, {"face_count": 0})
    if face_count > 1:
        return _reject("multiple_faces", 0.0, {"face_count": face_count})

    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    det_score = float(getattr(face, "det_score", 0.0))

    x1, y1, x2, y2 = [int(v) for v in face.bbox]
    h, w = img.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    crop = img[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.size else np.array([])

    blur = _blur_score(gray)
    occlusion = _occlusion_score(face, img.shape)

    checks = {
        "face_count": 1,
        "det_score": round(det_score, 4),
        "blur_score": round(blur, 4),
        "occlusion_score": round(occlusion, 4),
    }

    if det_score < settings.quality_min_det_score:
        return _reject("low_detection_score", det_score, checks)

    if blur < settings.quality_min_blur_score:
        return _reject("blurry", blur, checks)

    if occlusion < settings.quality_min_occlusion_score:
        return _reject("covered_face", occlusion, checks)

    quality_score = round(0.4 * det_score + 0.35 * blur + 0.25 * occlusion, 4)
    if quality_score < settings.quality_min_overall_score:
        return _reject("low_quality", quality_score, checks)

    return {
        "accepted": True,
        "reason": None,
        "quality_score": quality_score,
        "checks": checks,
        "bbox": [float(v) for v in face.bbox],
    }


def _reject(reason: str, score: float, checks: dict) -> dict:
    return {
        "accepted": False,
        "reason": reason,
        "quality_score": round(float(score), 4),
        "checks": checks,
        "bbox": None,
    }
