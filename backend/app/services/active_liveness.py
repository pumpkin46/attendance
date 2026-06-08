"""FR-018: Active liveness — blink detection and head movement across a frame sequence."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from app.core.config import settings


@dataclass
class FrameMetrics:
    eye_variance: float
    yaw_proxy: float
    pitch_proxy: float
    det_score: float
    face_count: int


@dataclass
class ActiveLivenessResult:
    passed: bool
    score: float
    blink_detected: bool
    head_movement_detected: bool
    frame_count: int
    checks: dict = field(default_factory=dict)
    reason: str | None = None


def _extract_metrics(image_b64: str) -> FrameMetrics | None:
    from app.services.face_service import _decode_image, _get_detection_app

    img = _decode_image(image_b64)
    if img is None:
        return None

    # Detection-only: we just need the 5 keypoints per frame, not embeddings.
    app = _get_detection_app()
    if app is None:
        return FrameMetrics(eye_variance=100.0, yaw_proxy=0.0, pitch_proxy=0.0, det_score=0.9, face_count=1)

    faces = app.get(img)
    if len(faces) != 1:
        return FrameMetrics(eye_variance=0.0, yaw_proxy=0.0, pitch_proxy=0.0, det_score=0.0, face_count=len(faces))

    face = faces[0]
    kps = np.asarray(face.kps, dtype=np.float32)
    det_score = float(getattr(face, "det_score", 0.9))

    le, re, nose, lm, rm = kps
    eye_span = float(np.linalg.norm(re - le)) + 1e-6
    patch = max(8, int(eye_span * 0.18))

    def eye_patch_var(center: np.ndarray) -> float:
        cx, cy = int(center[0]), int(center[1])
        y1, y2 = max(0, cy - patch), min(img.shape[0], cy + patch)
        x1, x2 = max(0, cx - patch), min(img.shape[1], cx + patch)
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            return 0.0
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    eye_var = (eye_patch_var(le) + eye_patch_var(re)) / 2.0

    eye_mid = (le + re) / 2.0
    mouth_mid = (lm + rm) / 2.0
    yaw_proxy = float((nose[0] - eye_mid[0]) / eye_span)
    pitch_proxy = float((nose[1] - eye_mid[1]) / (np.linalg.norm(mouth_mid - eye_mid) + 1e-6))

    return FrameMetrics(
        eye_variance=eye_var,
        yaw_proxy=yaw_proxy,
        pitch_proxy=pitch_proxy,
        det_score=det_score,
        face_count=1,
    )


def _detect_blink(eye_variances: list[float]) -> bool:
    if len(eye_variances) < 3:
        return False

    peak = max(eye_variances)
    if peak < 10:
        return False

    drop_ratio = settings.active_liveness_blink_variance_drop
    for i in range(1, len(eye_variances) - 1):
        prev_v = eye_variances[i - 1]
        curr_v = eye_variances[i]
        next_v = eye_variances[i + 1]
        if prev_v > 0 and curr_v / prev_v <= (1.0 - drop_ratio) and next_v > curr_v * 1.15:
            return True
        if curr_v / peak <= (1.0 - drop_ratio) and next_v > curr_v * 1.1:
            return True

    return False


def _detect_head_movement(yaws: list[float], pitches: list[float]) -> bool:
    if len(yaws) < 2:
        return False

    yaw_range = max(yaws) - min(yaws)
    pitch_range = max(pitches) - min(pitches)
    min_yaw = settings.active_liveness_head_yaw_range
    min_pitch = settings.active_liveness_head_pitch_range

    return yaw_range >= min_yaw or pitch_range >= min_pitch


def verify_active_liveness(frames_b64: list[str]) -> ActiveLivenessResult:
    """
    Analyze a short webcam sequence for blink and head movement (FR-018).
    Blocks video replay attacks that pass single-frame passive checks (FR-017).
    """
    min_frames = settings.active_liveness_min_frames
    max_frames = settings.active_liveness_max_frames

    checks: dict = {
        "method": "active",
        "frames_received": len(frames_b64),
        "min_frames_required": min_frames,
    }

    if not settings.active_liveness_enabled:
        return ActiveLivenessResult(
            passed=True,
            score=1.0,
            blink_detected=False,
            head_movement_detected=False,
            frame_count=len(frames_b64),
            checks={**checks, "active_liveness_disabled": True},
        )

    if len(frames_b64) < min_frames:
        return ActiveLivenessResult(
            passed=False,
            score=0.0,
            blink_detected=False,
            head_movement_detected=False,
            frame_count=len(frames_b64),
            checks=checks,
            reason="insufficient_frames",
        )

    sample = frames_b64[-max_frames:]
    metrics_list: list[FrameMetrics] = []

    for frame in sample:
        m = _extract_metrics(frame)
        if m is None:
            continue
        if m.face_count != 1:
            return ActiveLivenessResult(
                passed=False,
                score=0.0,
                blink_detected=False,
                head_movement_detected=False,
                frame_count=len(sample),
                checks={**checks, "face_count": m.face_count},
                reason="multiple_or_no_face",
            )
        metrics_list.append(m)

    if len(metrics_list) < min_frames:
        return ActiveLivenessResult(
            passed=False,
            score=0.0,
            blink_detected=False,
            head_movement_detected=False,
            frame_count=len(metrics_list),
            checks=checks,
            reason="insufficient_valid_frames",
        )

    eye_vars = [m.eye_variance for m in metrics_list]
    yaws = [m.yaw_proxy for m in metrics_list]
    pitches = [m.pitch_proxy for m in metrics_list]

    blink = _detect_blink(eye_vars)
    head_move = _detect_head_movement(yaws, pitches)

    checks.update(
        {
            "blink_detected": blink,
            "head_movement_detected": head_move,
            "eye_variance_range": round(max(eye_vars) - min(eye_vars), 2),
            "yaw_range": round(max(yaws) - min(yaws), 4),
            "pitch_range": round(max(pitches) - min(pitches), 4),
            "frames_analyzed": len(metrics_list),
        }
    )

    require_blink = settings.active_liveness_require_blink
    require_head = settings.active_liveness_require_head_movement

    if require_blink and not blink:
        return ActiveLivenessResult(
            passed=False,
            score=0.3,
            blink_detected=False,
            head_movement_detected=head_move,
            frame_count=len(metrics_list),
            checks=checks,
            reason="blink_not_detected",
        )

    if require_head and not head_move:
        return ActiveLivenessResult(
            passed=False,
            score=0.4,
            blink_detected=blink,
            head_movement_detected=False,
            frame_count=len(metrics_list),
            checks=checks,
            reason="head_movement_not_detected",
        )

    score = 0.5
    if blink:
        score += 0.25
    if head_move:
        score += 0.25

    return ActiveLivenessResult(
        passed=True,
        score=min(1.0, score),
        blink_detected=blink,
        head_movement_detected=head_move,
        frame_count=len(metrics_list),
        checks=checks,
    )
