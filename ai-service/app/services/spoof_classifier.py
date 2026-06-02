"""FR-017: Classify spoof attack type from passive anti-spoof signals."""

from __future__ import annotations

import cv2
import numpy as np


def _border_artifact_score(image: np.ndarray, bbox_xyxy: list[float]) -> float:
    """Higher score suggests deepfake / compositing artifacts at face boundary."""
    x1, y1, x2, y2 = [int(v) for v in bbox_xyxy]
    h, w = image.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w - 1, x2), min(h - 1, y2)
    if x2 <= x1 or y2 <= y1:
        return 0.0

    pad = max(2, int(min(x2 - x1, y2 - y1) * 0.08))
    outer = image[max(0, y1 - pad) : min(h, y2 + pad), max(0, x1 - pad) : min(w, x2 + pad)]
    inner = image[y1:y2, x1:x2]
    if outer.size == 0 or inner.size == 0:
        return 0.0

    inner_mean = inner.reshape(-1, 3).mean(axis=0)
    ring_mask = np.ones(outer.shape[:2], dtype=bool)
    iy1, iy2 = y1 - max(0, y1 - pad), y2 - max(0, y1 - pad)
    ix1, ix2 = x1 - max(0, x1 - pad), x2 - max(0, x1 - pad)
    if 0 <= iy1 < ring_mask.shape[0] and 0 <= ix1 < ring_mask.shape[1]:
        ring_mask[iy1:iy2, ix1:ix2] = False

    ring_pixels = outer[ring_mask]
    if len(ring_pixels) == 0:
        return 0.0

    ring_mean = ring_pixels.mean(axis=0)
    diff = float(np.linalg.norm(inner_mean - ring_mean))
    return min(1.0, diff / 80.0)


def classify_spoof_type(
    image: np.ndarray,
    bbox_xyxy: list[float],
    model_score: float | None,
    heuristic_detail: dict[str, float],
    passed: bool,
) -> str | None:
    """
    Map failed (or borderline) checks to attack categories:
    print, screen, video, deepfake.
    """
    if passed:
        return None

    blur = heuristic_detail.get("blur", 0.0)
    moire = heuristic_detail.get("moire", 0.0)
    saturation = heuristic_detail.get("saturation", 0.0)
    artifact = _border_artifact_score(image, bbox_xyxy)

    if artifact >= 0.55 and (model_score is None or model_score < 0.55):
        return "deepfake"

    if moire < 0.35 and blur < 0.3:
        return "printed_photo"

    if moire >= 0.35 or saturation < 0.25:
        return "mobile_screen"

    if model_score is not None and model_score < 0.4 and blur >= 0.35:
        return "video_replay"

    if model_score is not None and model_score < 0.5:
        return "mobile_screen"

    return "spoof_unknown"
