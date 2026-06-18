"""
Unknown Person Detection — Alert generation for unrecognized faces.

Workflow:
  Face Detected → No Match Found → Save Snapshot → Generate Alert → Notify Security

Stored Data:
- Face snapshot
- Camera / location
- Timestamp
- Confidence score
"""

from __future__ import annotations

import base64
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.engine.config import engine_config

logger = logging.getLogger(__name__)


@dataclass
class UnknownPersonEvent:
    event_id: str
    camera_id: int | None
    location_id: int | None
    zone: str | None
    timestamp: datetime
    confidence_score: float
    snapshot_path: str | None = None
    snapshot_b64: str | None = None
    bbox: dict | None = None
    notified: bool = False
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "camera_id": self.camera_id,
            "location_id": self.location_id,
            "zone": self.zone,
            "timestamp": self.timestamp.isoformat(),
            "confidence_score": round(self.confidence_score, 4),
            "snapshot_path": self.snapshot_path,
            "bbox": self.bbox,
            "notified": self.notified,
        }


class UnknownPersonDetector:
    """Handles unknown face detection, snapshot storage, and alert generation."""

    def __init__(self, snapshot_dir: str = "data/snapshots/unknown") -> None:
        self._snapshot_dir = Path(snapshot_dir)
        self._snapshot_dir.mkdir(parents=True, exist_ok=True)
        self._cooldown_cache: dict[str, float] = {}
        self._events: list[UnknownPersonEvent] = []
        self._total_detections = 0
        self._alerts_generated = 0
        self._alert_callbacks: list[Any] = []

    @property
    def stats(self) -> dict:
        return {
            "total_detections": self._total_detections,
            "alerts_generated": self._alerts_generated,
            "recent_events": len(self._events),
        }

    def register_alert_callback(self, callback) -> None:
        self._alert_callbacks.append(callback)

    def process_unknown(
        self,
        frame: np.ndarray,
        *,
        camera_id: int | None = None,
        location_id: int | None = None,
        zone: str | None = None,
        confidence: float = 0.0,
        bbox: list[float] | None = None,
    ) -> UnknownPersonEvent | None:
        """Process an unknown face detection."""
        cfg = engine_config.unknown_person
        if not cfg.enabled:
            return None

        self._total_detections += 1

        cooldown_key = f"{camera_id}:{self._quantize_bbox(bbox)}"
        if self._is_on_cooldown(cooldown_key):
            return None

        self._set_cooldown(cooldown_key)

        now = datetime.now(timezone.utc)
        event_id = f"UNK-{int(now.timestamp() * 1000)}-{camera_id or 0}"

        snapshot_path = None
        snapshot_b64 = None
        if cfg.save_snapshot and frame is not None:
            snapshot_path = self._save_snapshot(frame, event_id, bbox)
            if bbox:
                x1, y1, x2, y2 = [int(v) for v in bbox]
                h, w = frame.shape[:2]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                crop = frame[y1:y2, x1:x2]
                if crop.size > 0:
                    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    if ok:
                        snapshot_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        event = UnknownPersonEvent(
            event_id=event_id,
            camera_id=camera_id,
            location_id=location_id,
            zone=zone,
            timestamp=now,
            confidence_score=confidence,
            snapshot_path=snapshot_path,
            snapshot_b64=snapshot_b64,
            bbox={"x": bbox[0], "y": bbox[1], "w": bbox[2] - bbox[0], "h": bbox[3] - bbox[1]} if bbox else None,
        )

        self._events.append(event)
        if len(self._events) > 1000:
            self._events = self._events[-500:]

        if cfg.generate_alert:
            self._generate_alert(event)

        return event

    def get_recent_events(self, limit: int = 50) -> list[UnknownPersonEvent]:
        return self._events[-limit:]

    def _save_snapshot(
        self, frame: np.ndarray, event_id: str, bbox: list[float] | None
    ) -> str | None:
        try:
            filename = f"{event_id}.jpg"
            filepath = self._snapshot_dir / filename

            if bbox:
                x1, y1, x2, y2 = [int(v) for v in bbox]
                h, w = frame.shape[:2]
                pad = 30
                x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
                x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
                crop = frame[y1:y2, x1:x2]
                cv2.imwrite(str(filepath), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
            else:
                cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

            return str(filepath)
        except Exception as e:
            logger.error("Failed to save unknown snapshot: %s", e)
            return None

    def _generate_alert(self, event: UnknownPersonEvent) -> None:
        self._alerts_generated += 1
        event.notified = True
        logger.warning(
            "ALERT: Unknown person detected at camera %s, zone %s",
            event.camera_id, event.zone,
        )
        for callback in self._alert_callbacks:
            try:
                callback(event)
            except Exception as e:
                logger.error("Alert callback failed: %s", e)

    def _is_on_cooldown(self, key: str) -> bool:
        last = self._cooldown_cache.get(key)
        if last is None:
            return False
        return (time.time() - last) < engine_config.unknown_person.alert_cooldown_seconds

    def _set_cooldown(self, key: str) -> None:
        self._cooldown_cache[key] = time.time()
        if len(self._cooldown_cache) > 10000:
            now = time.time()
            threshold = engine_config.unknown_person.alert_cooldown_seconds * 2
            self._cooldown_cache = {
                k: v for k, v in self._cooldown_cache.items()
                if now - v < threshold
            }

    def _quantize_bbox(self, bbox: list[float] | None) -> str:
        if not bbox:
            return "none"
        return f"{int(bbox[0] / 50)}_{int(bbox[1] / 50)}"


_detector: UnknownPersonDetector | None = None


def get_unknown_detector() -> UnknownPersonDetector:
    global _detector
    if _detector is None:
        _detector = UnknownPersonDetector()
    return _detector
