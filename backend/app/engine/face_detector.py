"""
Stage 2: Face Detection — Multi-face detection in frames.

Supports:
- Single and multiple face detection
- Crowded environments (100+ faces)
- Partial occlusion handling
- Various lighting conditions
- Minimum face size: 40x40 pixels
- Configurable confidence threshold
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.engine.config import engine_config

logger = logging.getLogger(__name__)


@dataclass
class DetectedFace:
    face_id: str
    bounding_box: dict[str, float]
    confidence: float
    landmarks: np.ndarray | None = None
    embedding: np.ndarray | None = None
    _raw_face: Any = field(default=None, repr=False)

    @property
    def bbox_xyxy(self) -> list[float]:
        bb = self.bounding_box
        return [bb["x"], bb["y"], bb["x"] + bb["width"], bb["y"] + bb["height"]]

    @property
    def area(self) -> float:
        return self.bounding_box["width"] * self.bounding_box["height"]

    def to_dict(self) -> dict:
        return {
            "face_id": self.face_id,
            "bounding_box": self.bounding_box,
            "confidence": round(self.confidence, 4),
        }


@dataclass
class DetectionResult:
    faces: list[DetectedFace]
    frame_width: int
    frame_height: int
    detection_ms: int
    model_used: str = "insightface"

    @property
    def face_count(self) -> int:
        return len(self.faces)

    def to_dict(self) -> dict:
        return {
            "faces": [f.to_dict() for f in self.faces],
            "face_count": self.face_count,
            "frame_width": self.frame_width,
            "frame_height": self.frame_height,
            "detection_ms": self.detection_ms,
            "model_used": self.model_used,
        }


class FaceDetector:
    """High-performance multi-face detector using InsightFace."""

    def __init__(self) -> None:
        self._app = None
        self._initialized = False
        self._face_counter = 0

    def _ensure_initialized(self) -> bool:
        if self._initialized:
            return self._app is not None

        self._initialized = True
        try:
            import os

            import onnxruntime as ort
            from insightface.app import FaceAnalysis
            from insightface.model_zoo import model_zoo

            cfg = engine_config.detection
            threads = cfg.intra_op_threads or max(1, (os.cpu_count() or 4) // 2)
            sess_options = ort.SessionOptions()
            sess_options.intra_op_num_threads = threads

            # FaceAnalysis only forwards providers/provider_options to
            # onnxruntime.InferenceSession, so the thread cap has to go in via
            # the session wrapper. Patched only around this construction so
            # other FaceAnalysis users keep default threading.
            orig_init = model_zoo.PickableInferenceSession.__init__

            def capped_init(session_self, model_path, **kwargs):
                kwargs.setdefault("sess_options", sess_options)
                orig_init(session_self, model_path, **kwargs)

            model_zoo.PickableInferenceSession.__init__ = capped_init
            try:
                app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
                app.prepare(ctx_id=0, det_size=cfg.det_size)
            finally:
                model_zoo.PickableInferenceSession.__init__ = orig_init

            self._app = app
            logger.info(
                "FaceDetector initialized with InsightFace buffalo_l (%d intra-op threads)",
                threads,
            )
            return True
        except Exception as e:
            logger.warning("InsightFace not available: %s — using mock detection", e)
            return False

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """Detect all faces in a frame."""
        t0 = time.perf_counter()
        h, w = frame.shape[:2]
        cfg = engine_config.detection

        if not self._ensure_initialized():
            detection_ms = int((time.perf_counter() - t0) * 1000)
            return DetectionResult(
                faces=[],
                frame_width=w,
                frame_height=h,
                detection_ms=detection_ms,
                model_used="none",
            )

        raw_faces = self._app.get(frame)
        faces: list[DetectedFace] = []

        for face in raw_faces:
            bbox = face.bbox
            face_w = float(bbox[2] - bbox[0])
            face_h = float(bbox[3] - bbox[1])

            if face_w < cfg.min_face_size or face_h < cfg.min_face_size:
                continue

            det_score = float(getattr(face, "det_score", 0.0))
            if det_score < cfg.confidence_threshold:
                continue

            self._face_counter += 1
            detected = DetectedFace(
                face_id=f"temp-{self._face_counter:06d}",
                bounding_box={
                    "x": float(bbox[0]),
                    "y": float(bbox[1]),
                    "width": face_w,
                    "height": face_h,
                },
                confidence=det_score,
                landmarks=np.array(face.kps, dtype=np.float32) if hasattr(face, "kps") else None,
                embedding=np.array(face.embedding, dtype=np.float32) if hasattr(face, "embedding") else None,
                _raw_face=face,
            )
            faces.append(detected)

            if len(faces) >= cfg.max_faces_per_frame:
                break

        faces.sort(key=lambda f: f.area, reverse=True)
        detection_ms = int((time.perf_counter() - t0) * 1000)

        return DetectionResult(
            faces=faces,
            frame_width=w,
            frame_height=h,
            detection_ms=detection_ms,
            model_used="insightface_buffalo_l",
        )

    def detect_largest(self, frame: np.ndarray) -> DetectedFace | None:
        """Detect and return only the largest face."""
        result = self.detect(frame)
        return result.faces[0] if result.faces else None


_detector: FaceDetector | None = None


def get_detector() -> FaceDetector:
    global _detector
    if _detector is None:
        _detector = FaceDetector()
    return _detector
