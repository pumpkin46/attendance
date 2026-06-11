"""FR-007: Face quality validation — blur, occlusion, single face."""

from __future__ import annotations

import cv2
import numpy as np

from app.core.config import settings
from app.services.face_metrics import (
    blur_score,
    brightness_score,
    occlusion_score,
    resolution_score,
)
from app.services.face_pose import analyze_face_metadata, pose_matches_expected


def _skin_region_gray(img: np.ndarray, face) -> np.ndarray | None:
    """Gray crop of the inner face (around the 5 landmarks, eyes→chin).

    Brightness is judged here rather than on the full detection box: the box
    includes hair and background, whose darkness drags the mean luminance
    below the threshold even when the skin itself is well lit.
    """
    kps = getattr(face, "kps", None)
    if kps is None or len(kps) < 5:
        return None
    pts = np.asarray(kps, dtype=np.float32)
    eye_dist = float(np.linalg.norm(pts[1] - pts[0]))
    if eye_dist < 8:
        return None
    h, w = img.shape[:2]
    x1 = max(0, int(pts[:, 0].min() - 0.25 * eye_dist))
    x2 = min(w, int(pts[:, 0].max() + 0.25 * eye_dist))
    y1 = max(0, int(pts[:, 1].min() - 0.25 * eye_dist))
    y2 = min(h, int(pts[:, 1].max() + 0.30 * eye_dist))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    return cv2.cvtColor(img[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)


def validate_face_image(
    img: np.ndarray,
    faces: list,
    expected_pose: str | None = None,
) -> dict:
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

    face_w = float(face.bbox[2] - face.bbox[0])
    face_h = float(face.bbox[3] - face.bbox[1])
    blur = blur_score(gray, settings.quality_blur_variance_ref)
    # Judge brightness on the inner skin region when landmarks allow — the
    # full detection box includes hair/background that bias the mean dark.
    skin_gray = _skin_region_gray(img, face)
    brightness = brightness_score(skin_gray if skin_gray is not None else gray)
    occlusion = occlusion_score(getattr(face, "kps", None), face_w, img.shape, strict=True)
    resolution = resolution_score(min(face_w, face_h), settings.quality_min_face_pixels)

    checks = {
        "face_count": 1,
        "det_score": round(det_score, 4),
        "blur_score": round(blur, 4),
        "brightness_score": round(brightness, 4),
        "occlusion_score": round(occlusion, 4),
        "resolution_score": round(resolution, 4),
        "image_width": img.shape[1],
        "image_height": img.shape[0],
    }

    if det_score < settings.quality_min_det_score:
        return _reject("low_detection_score", det_score, checks)

    if blur < settings.quality_min_blur_score:
        return _reject("blurry", blur, checks)

    if brightness < settings.quality_min_brightness_score:
        return _reject("too_dark", brightness, checks)

    if resolution < settings.quality_min_resolution_score:
        return _reject("low_resolution", resolution, checks)

    if occlusion < settings.quality_min_occlusion_score:
        return _reject("occluded_face", occlusion, checks)

    quality_score = round(
        0.30 * det_score
        + 0.25 * blur
        + 0.15 * brightness
        + 0.15 * resolution
        + 0.15 * occlusion,
        4,
    )
    if quality_score < settings.quality_min_overall_score:
        return _reject("low_quality", quality_score, checks)

    metadata = analyze_face_metadata(face, img)
    checks["face_metadata"] = metadata

    if expected_pose:
        ok, pose_reason = pose_matches_expected(expected_pose, metadata)
        if not ok:
            return _reject(pose_reason or "wrong_pose", quality_score, checks)

    return {
        "accepted": True,
        "reason": None,
        "quality_score": quality_score,
        "checks": checks,
        "bbox": [float(v) for v in face.bbox],
        "face_metadata": metadata,
    }


def _reject(reason: str, score: float, checks: dict) -> dict:
    return {
        "accepted": False,
        "reason": reason,
        "quality_score": round(float(score), 4),
        "checks": checks,
        "bbox": None,
    }
