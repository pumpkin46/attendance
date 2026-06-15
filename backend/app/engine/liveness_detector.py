"""
Stage 5: Liveness Detection — Anti-spoofing verification.

Passive Liveness (no user interaction):
- Detect printed photos
- Detect screen replays
- Detect video replays
- Detect synthetic faces

Active Liveness (request user action):
- Blink
- Smile
- Turn head left/right
- Nod

AI-Based Anti-Spoofing:
- Deepfake video detection
- Face swap detection
- AI-generated face detection

Liveness Score >= 0.85 required for attendance creation.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum

import cv2
import numpy as np

from app.engine.config import engine_config
from app.engine.face_detector import DetectedFace
from app.services import face_metrics

logger = logging.getLogger(__name__)


class SpoofType(Enum):
    PRINTED_PHOTO = "printed_photo"
    SCREEN_REPLAY = "screen_replay"
    VIDEO_REPLAY = "video_replay"
    SYNTHETIC_FACE = "synthetic_face"
    DEEPFAKE = "deepfake"
    FACE_SWAP = "face_swap"
    AI_GENERATED = "ai_generated"


# Anti-spoof model (services.antispoof) reports the attack type as a string;
# map it onto this module's SpoofType enum for LivenessResult.
_SPOOF_TYPE_MAP = {
    "printed_photo": SpoofType.PRINTED_PHOTO,
    "mobile_screen": SpoofType.SCREEN_REPLAY,
    "video_replay": SpoofType.VIDEO_REPLAY,
    "deepfake": SpoofType.DEEPFAKE,
}


class LivenessAction(Enum):
    BLINK = "blink"
    SMILE = "smile"
    TURN_LEFT = "turn_left"
    TURN_RIGHT = "turn_right"
    NOD = "nod"


@dataclass
class LivenessResult:
    passed: bool
    score: float
    is_live: bool
    spoof_type: SpoofType | None = None
    passive_score: float = 0.0
    active_score: float = 0.0
    checks: dict = field(default_factory=dict)
    reason: str | None = None
    verification_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "score": round(self.score, 4),
            "is_live": self.is_live,
            "spoof_type": self.spoof_type.value if self.spoof_type else None,
            "passive_score": round(self.passive_score, 4),
            "active_score": round(self.active_score, 4),
            "checks": self.checks,
            "reason": self.reason,
            "verification_ms": self.verification_ms,
        }


class LivenessDetector:
    """Live-camera liveness detector.

    Passive anti-spoofing delegates to the real MiniFASNetV2 ONNX model
    (``services.antispoof.AntiSpoofVerifier``) — the same singleton the kiosk
    and enrollment paths use — which fuses the CNN live-probability with
    texture/moiré/saturation heuristics under its own ``ANTISPOOF_*``
    thresholds. If that model is unavailable, ``_passive_check`` falls back to
    the classical heuristic below so the stage still functions (coarsely).

    The active check (blink / head movement on a frame sequence) is heuristic
    and only runs when a frame sequence is supplied; ``LivenessConfig.min_score``
    (ENGINE_LIVENESS_THRESHOLD) governs that active gate and the heuristic
    fallback. The passive pass/fail decision is owned by the anti-spoof model's
    thresholds, not by min_score.
    """

    def __init__(self) -> None:
        # Real passive anti-spoof model (MiniFASNetV2 ONNX), resolved lazily on
        # first frame so importing this module never triggers a model load.
        self._antispoof = None

    def verify(
        self,
        frame: np.ndarray,
        face: DetectedFace,
        *,
        liveness_frames: list[np.ndarray] | None = None,
        require_active: bool = False,
    ) -> LivenessResult:
        """Run full liveness pipeline on a detected face."""
        t0 = time.perf_counter()
        cfg = engine_config.liveness

        if not cfg.enabled:
            return LivenessResult(
                passed=True, score=1.0, is_live=True,
                checks={"liveness_disabled": True},
                verification_ms=int((time.perf_counter() - t0) * 1000),
            )

        checks: dict = {"methods": []}
        passive_score = 1.0
        passive_passed = True
        active_score = 1.0

        if cfg.passive_enabled:
            passive_result = self._passive_check(frame, face)
            passive_score = passive_result["score"]
            # The anti-spoof model owns the passive pass/fail decision via its
            # own thresholds; fall back to min_score only when no decision is
            # reported (heuristic-only path).
            passive_passed = passive_result.get("passed")
            if passive_passed is None:
                passive_passed = passive_score >= cfg.min_score
            checks["passive"] = passive_result
            checks["methods"].append("passive_antispoof")

            if not passive_passed:
                return LivenessResult(
                    passed=False, score=passive_score, is_live=False,
                    spoof_type=passive_result.get("spoof_type"),
                    passive_score=passive_score,
                    checks=checks,
                    reason=passive_result.get("reason", "spoof_detected"),
                    verification_ms=int((time.perf_counter() - t0) * 1000),
                )

        if cfg.active_enabled and liveness_frames:
            active_result = self._active_check(liveness_frames, face)
            active_score = active_result["score"]
            checks["active"] = active_result
            checks["methods"].append("active_liveness")

            if require_active and active_score < cfg.min_score:
                return LivenessResult(
                    passed=False, score=active_score, is_live=False,
                    passive_score=passive_score, active_score=active_score,
                    checks=checks,
                    reason=active_result.get("reason", "active_liveness_failed"),
                    verification_ms=int((time.perf_counter() - t0) * 1000),
                )

        # Passive (and active, when required) gates already early-returned on
        # failure above, so reaching here means the passive decision passed.
        final_score = passive_score
        passed = passive_passed
        if liveness_frames:
            final_score = (passive_score * 0.6 + active_score * 0.4)
            passed = passive_passed and final_score >= cfg.min_score
        verification_ms = int((time.perf_counter() - t0) * 1000)

        return LivenessResult(
            passed=passed,
            score=final_score,
            is_live=passed,
            passive_score=passive_score,
            active_score=active_score,
            checks=checks,
            reason=None if passed else "below_threshold",
            verification_ms=verification_ms,
        )

    def _get_antispoof(self):
        """Lazily resolve the shared MiniFASNetV2 anti-spoof verifier."""
        if self._antispoof is None:
            from app.services.antispoof import get_antispoof_verifier

            self._antispoof = get_antispoof_verifier()
        return self._antispoof

    def _passive_check(self, frame: np.ndarray, face: DetectedFace) -> dict:
        """Passive anti-spoofing via the real MiniFASNetV2 model.

        Delegates to services.antispoof (CNN live-probability fused with
        texture/moiré/saturation heuristics). Falls back to the classical
        heuristic only if the verifier raises (e.g. model file unavailable).
        """
        try:
            result = self._get_antispoof().verify(frame, list(face.bbox_xyxy))
            spoof_type = _SPOOF_TYPE_MAP.get(result.spoof_type) if result.spoof_type else None
            reason = None
            if not result.passed:
                reason = result.reason or "spoof_detected"
                if spoof_type:
                    reason = f"{reason}:{spoof_type.value}"
            return {
                "score": float(result.live_score),
                "passed": bool(result.passed),
                "model_score": result.model_score,
                "heuristic_score": result.heuristic_score,
                "spoof_type": spoof_type,
                "reason": reason,
                "engine": "minifasnet_onnx" if result.model_score is not None else "heuristic_only",
                "checks": result.checks,
            }
        except Exception as e:  # defensive: never let anti-spoof break recognition
            logger.warning("Anti-spoof model unavailable (%s); using heuristic fallback", e)
            return self._heuristic_passive_check(frame, face)

    def _heuristic_passive_check(self, frame: np.ndarray, face: DetectedFace) -> dict:
        """Fallback passive check: classical texture / moiré / color heuristics."""
        bbox = face.bbox_xyxy
        x1, y1, x2, y2 = [int(v) for v in bbox]
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return {"score": 0.0, "passed": False, "reason": "empty_crop"}

        texture_score = self._texture_analysis(crop)
        moire_score = self._moire_detection(crop)
        color_score = self._color_consistency(crop)

        score = 0.4 * texture_score + 0.35 * moire_score + 0.25 * color_score
        passed = score >= engine_config.liveness.min_score

        spoof_type = None
        reason = None
        if not passed:
            spoof_type = self._classify_spoof(texture_score, moire_score, color_score)
            reason = f"spoof_detected:{spoof_type.value}" if spoof_type else "spoof_detected"

        return {
            "score": score,
            "passed": passed,
            "texture_score": texture_score,
            "moire_score": moire_score,
            "color_score": color_score,
            "spoof_type": spoof_type,
            "reason": reason,
        }

    def _active_check(self, frames: list[np.ndarray], face: DetectedFace) -> dict:
        """Active liveness: blink + head movement detection."""
        if len(frames) < 3:
            return {"score": 0.0, "reason": "insufficient_frames"}

        blink_detected = self._detect_blink(frames)
        head_movement = self._detect_head_movement(frames)

        score = 0.5
        if blink_detected:
            score += 0.25
        if head_movement:
            score += 0.25

        return {
            "score": score,
            "blink_detected": blink_detected,
            "head_movement_detected": head_movement,
            "frames_analyzed": len(frames),
        }

    def _texture_analysis(self, crop: np.ndarray) -> float:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        return face_metrics.blur_score(gray, 120.0)

    def _moire_detection(self, crop: np.ndarray) -> float:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        f = np.fft.fft2(gray.astype(np.float32))
        mag = np.abs(np.fft.fftshift(f))
        ch, cw = mag.shape[0] // 2, mag.shape[1] // 2
        center_region = mag[max(0, ch - 8):ch + 8, max(0, cw - 8):cw + 8]
        center_energy = center_region.sum()
        total_energy = mag.sum() + 1e-6
        ratio = float(center_energy / total_energy)
        return 1.0 - min(1.0, max(0.0, (ratio - 0.35) / 0.25))

    def _color_consistency(self, crop: np.ndarray) -> float:
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        sat_std = float(np.std(hsv[:, :, 1]))
        return min(1.0, sat_std / 40.0)

    def _classify_spoof(
        self, texture: float, moire: float, color: float
    ) -> SpoofType | None:
        if moire < 0.4:
            return SpoofType.SCREEN_REPLAY
        if texture < 0.3:
            return SpoofType.PRINTED_PHOTO
        if color < 0.3:
            return SpoofType.VIDEO_REPLAY
        return SpoofType.SYNTHETIC_FACE

    def _detect_blink(self, frames: list[np.ndarray]) -> bool:
        """Simple blink detection via eye region variance changes."""
        if len(frames) < 5:
            return False
        variances = []
        for frame in frames[-10:]:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            eye_region = gray[h // 4: h // 2, w // 4: 3 * w // 4]
            if eye_region.size > 0:
                variances.append(float(cv2.Laplacian(eye_region, cv2.CV_64F).var()))

        if len(variances) < 3:
            return False

        peak = max(variances)
        if peak < 10:
            return False

        for i in range(1, len(variances) - 1):
            if variances[i] / max(variances[i - 1], 1e-6) < 0.65:
                if variances[i + 1] > variances[i] * 1.1:
                    return True
        return False

    def _detect_head_movement(self, frames: list[np.ndarray]) -> bool:
        """Detect head movement via frame differencing."""
        if len(frames) < 3:
            return False

        diffs = []
        for i in range(1, min(len(frames), 10)):
            prev_gray = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
            curr_gray = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
            if prev_gray.shape != curr_gray.shape:
                continue
            diff = cv2.absdiff(prev_gray, curr_gray)
            diffs.append(float(np.mean(diff)))

        if not diffs:
            return False

        return max(diffs) - min(diffs) > 5.0


_detector: LivenessDetector | None = None


def get_liveness_detector() -> LivenessDetector:
    global _detector
    if _detector is None:
        _detector = LivenessDetector()
    return _detector
