"""Passive anti-spoofing: MiniFASNet ONNX + texture/moiré heuristics."""

from __future__ import annotations

import hashlib
import logging
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from app.core.config import settings

from app.services.spoof_classifier import classify_spoof_type

logger = logging.getLogger(__name__)

_verifier: AntiSpoofVerifier | None = None


@dataclass
class AntiSpoofResult:
    passed: bool
    live_score: float
    model_score: float | None
    heuristic_score: float
    checks: dict[str, bool | float | str | None] = field(default_factory=dict)
    reason: str | None = None
    spoof_type: str | None = None


class AntiSpoofVerifier:
    """MiniFASNetV2 ONNX classifier (real vs print/screen spoof)."""

    def __init__(self) -> None:
        self.scale = settings.antispoof_crop_scale
        self.model_path = Path(settings.antispoof_model_path)
        self.session: ort.InferenceSession | None = None
        self.input_name = ""
        self.output_name = ""
        self.input_size = (80, 80)

        if settings.antispoof_enabled:
            self._ensure_model()
            if self.model_path.is_file() and self._verify_checksum(self.model_path):
                self._load_session()
            else:
                # Loud signal: the engine then runs on coarse heuristics only
                # (see verify()), which a sharp print/screen can defeat. The
                # health endpoint reports the degraded mode (antispoof_mode).
                logger.critical(
                    "Anti-spoof model unavailable or failed verification at %s; "
                    "liveness is running on heuristics only (degraded). Provide a "
                    "verified MiniFASNetV2.onnx or set ANTISPOOF_FAIL_WITHOUT_MODEL=true.",
                    self.model_path,
                )

    def _verify_checksum(self, path: Path) -> bool:
        """True if the file matches the pinned SHA-256 (or verification is off).

        The model is fetched over an unauthenticated URL and executed in-process,
        so an unverified file is a supply-chain risk. A mismatch is treated as
        "no model" (fail to the heuristic / fail-closed path) rather than loaded.
        """
        expected = (settings.antispoof_model_sha256 or "").strip().lower()
        if not expected:
            return True
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest == expected:
            return True
        logger.critical(
            "Anti-spoof model checksum mismatch at %s (expected %s, got %s); "
            "refusing to load a potentially tampered model.",
            path, expected, digest,
        )
        return False

    def _ensure_model(self) -> None:
        if self.model_path.is_file():
            return
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        url = settings.antispoof_model_url
        logger.info("Downloading anti-spoof model from %s", url)
        try:
            urllib.request.urlretrieve(url, self.model_path)
        except Exception as exc:
            logger.error("Failed to download anti-spoof model: %s", exc)
            return
        # Verify the freshly downloaded artifact before it is ever loaded; delete
        # it on mismatch so a bad download is not trusted now or on next boot.
        if not self._verify_checksum(self.model_path):
            try:
                self.model_path.unlink()
            except OSError:
                pass
            return
        logger.info("Anti-spoof model saved and verified at %s", self.model_path)

    def _load_session(self) -> None:
        self.session = ort.InferenceSession(
            str(self.model_path),
            providers=["CPUExecutionProvider"],
        )
        inp = self.session.get_inputs()[0]
        out = self.session.get_outputs()[0]
        self.input_name = inp.name
        self.output_name = out.name
        h, w = inp.shape[2], inp.shape[3]
        if isinstance(h, int) and isinstance(w, int):
            self.input_size = (w, h)

    @staticmethod
    def _xyxy_to_xywh(bbox: list[float]) -> list[int]:
        x1, y1, x2, y2 = bbox
        return [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]

    def _crop_face(self, image: np.ndarray, bbox_xywh: list[int]) -> np.ndarray:
        src_h, src_w = image.shape[:2]
        x, y, box_w, box_h = bbox_xywh
        scale = min((src_h - 1) / max(box_h, 1), (src_w - 1) / max(box_w, 1), self.scale)
        new_w = box_w * scale
        new_h = box_h * scale
        center_x = x + box_w / 2
        center_y = y + box_h / 2
        x1 = max(0, int(center_x - new_w / 2))
        y1 = max(0, int(center_y - new_h / 2))
        x2 = min(src_w - 1, int(center_x + new_w / 2))
        y2 = min(src_h - 1, int(center_y + new_h / 2))
        cropped = image[y1 : y2 + 1, x1 : x2 + 1]
        if cropped.size == 0:
            return np.zeros((self.input_size[1], self.input_size[0], 3), dtype=np.uint8)
        return cv2.resize(cropped, self.input_size)

    def _model_score(self, image: np.ndarray, bbox_xyxy: list[float]) -> float | None:
        if self.session is None:
            return None
        bbox_xywh = self._xyxy_to_xywh(bbox_xyxy)
        face = self._crop_face(image, bbox_xywh)
        tensor = face.astype(np.float32) * settings.antispoof_input_scale
        tensor = np.transpose(tensor, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0)
        outputs = self.session.run([self.output_name], {self.input_name: tensor})
        logits = outputs[0]
        exp = np.exp(logits - np.max(logits, axis=1, keepdims=True))
        probs = exp / exp.sum(axis=1, keepdims=True)
        # MiniFAS: index 1 = live/real
        return float(probs[0, 1])

    @staticmethod
    def _heuristic_score(image: np.ndarray, bbox_xyxy: list[float]) -> tuple[float, dict[str, float]]:
        """Texture, blur, and moiré checks on the face crop (screen/print detection)."""
        x1, y1, x2, y2 = [int(v) for v in bbox_xyxy]
        h, w = image.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return 0.0, {"blur": 0.0, "moire": 0.0, "saturation": 0.0}

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        blur_norm = min(1.0, blur / 120.0)

        f = np.fft.fft2(gray)
        mag = np.abs(np.fft.fftshift(f))
        ch, cw = mag.shape[0] // 2, mag.shape[1] // 2
        center = mag[ch - 8 : ch + 8, cw - 8 : cw + 8].sum()
        total = mag.sum() + 1e-6
        moire_ratio = float(center / total)
        moire_norm = 1.0 - min(1.0, max(0.0, (moire_ratio - 0.35) / 0.25))

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        sat_std = float(np.std(hsv[:, :, 1]))
        sat_norm = min(1.0, sat_std / 40.0)

        score = 0.4 * blur_norm + 0.35 * moire_norm + 0.25 * sat_norm
        return score, {"blur": blur_norm, "moire": moire_norm, "saturation": sat_norm}

    def verify(self, image: np.ndarray, bbox_xyxy: list[float]) -> AntiSpoofResult:
        model_score = self._model_score(image, bbox_xyxy)
        heuristic_score, heuristic_detail = self._heuristic_score(image, bbox_xyxy)

        checks: dict[str, bool | float] = {
            "heuristic_score": round(heuristic_score, 4),
            **{f"h_{k}": round(v, 4) for k, v in heuristic_detail.items()},
        }

        heuristic_ok = heuristic_score >= settings.antispoof_heuristic_threshold

        if model_score is not None:
            checks["model_score"] = round(model_score, 4)
            model_ok = model_score >= settings.antispoof_real_threshold
            checks["model_ok"] = model_ok
            checks["heuristic_ok"] = heuristic_ok

            if settings.antispoof_require_both:
                passed = model_ok and heuristic_ok
                live_score = min(model_score, heuristic_score)
                reason = None if passed else ("spoof_detected" if not model_ok else "heuristic_failed")
            else:
                live_score = 0.7 * model_score + 0.3 * heuristic_score
                passed = live_score >= settings.antispoof_combined_threshold
                reason = None if passed else "spoof_detected"
        else:
            checks["model_ok"] = None
            checks["heuristic_ok"] = heuristic_ok
            if settings.antispoof_fail_without_model:
                passed = False
                live_score = heuristic_score
                reason = "antispoof_model_unavailable"
            else:
                passed = heuristic_ok
                live_score = heuristic_score
                reason = None if passed else "heuristic_failed"

        return AntiSpoofResult(
            passed=passed,
            live_score=live_score,
            model_score=model_score,
            heuristic_score=heuristic_score,
            checks=checks,
            reason=reason,
            spoof_type=classify_spoof_type(
                image, bbox_xyxy, model_score, heuristic_detail, passed
            ),
        )


def get_antispoof_verifier() -> AntiSpoofVerifier:
    global _verifier
    if _verifier is None:
        _verifier = AntiSpoofVerifier()
    return _verifier
