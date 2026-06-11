"""Shared face-image helpers.

Single home for the base64->BGR image decode and the mock-embedding fallback
that were previously copy-pasted into face_service, enrollment_service and the
recognition engine. Keep this module dependency-light (no insightface / no DB)
so any layer can import it without pulling in heavy or circular dependencies.
"""

from __future__ import annotations

import base64
import io

import cv2
import numpy as np
from PIL import Image

from app.core.config import settings


_face_app = None


def get_face_app():
    """Lazily build and cache the shared InsightFace recognition model (buffalo_l).

    One process-wide singleton shared by face_service and enrollment_service, so
    both honor ``RECOGNITION_DET_SIZE`` and only a single model is held in memory.
    Returns ``None`` when InsightFace is unavailable, which callers treat as
    "mock mode".
    """
    global _face_app
    if _face_app is not None:
        return _face_app

    try:
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        det = settings.recognition_det_size
        app.prepare(ctx_id=0, det_size=(det, det))
        _face_app = app
        return _face_app
    except Exception:
        return None


def decode_image(image_b64: str) -> np.ndarray | None:
    """Decode a base64 image (optionally a ``data:`` URI) to a BGR ndarray.

    Returns ``None`` on any decode error so callers can branch without a try.
    """
    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        data = base64.b64decode(image_b64)
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def mock_embedding(seed: str) -> np.ndarray:
    """Deterministic-per-seed unit embedding for mock mode (no InsightFace)."""
    rng = np.random.default_rng(abs(hash(seed)) % (2**32))
    vec = rng.standard_normal(settings.embedding_dim).astype(np.float32)
    return vec / np.linalg.norm(vec)
