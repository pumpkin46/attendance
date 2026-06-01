import base64
import io
import time
import uuid

import cv2
import numpy as np
from PIL import Image

from app.core.config import settings
from app.services.faiss_index import FaissIndex
from app.services.liveness import check_liveness

_index: FaissIndex | None = None
_face_app = None


def get_index() -> FaissIndex:
    global _index
    if _index is None:
        _index = FaissIndex()
    return _index


def _get_face_app():
    global _face_app
    if _face_app is not None:
        return _face_app

    try:
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=(640, 640))
        _face_app = app
        return _face_app
    except Exception:
        return None


def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        data = base64.b64decode(image_b64)
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _mock_embedding(seed: str) -> np.ndarray:
    rng = np.random.default_rng(abs(hash(seed)) % (2**32))
    vec = rng.standard_normal(settings.embedding_dim).astype(np.float32)
    return vec / np.linalg.norm(vec)


def extract_embedding(image_b64: str, employee_id: str | None = None) -> tuple[np.ndarray | None, float]:
    img = _decode_image(image_b64)
    if img is None:
        return None, 0.0

    app = _get_face_app()
    if app is None:
        seed = employee_id or str(hash(image_b64) % 100000)
        return _mock_embedding(seed), 0.85

    faces = app.get(img)
    if not faces:
        return None, 0.0

    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    quality = float(getattr(face, "det_score", 0.9))
    return np.array(face.embedding, dtype=np.float32), quality


def enroll(employee_id: str, image_b64: str) -> dict:
    start = time.perf_counter()
    embedding, quality = extract_embedding(image_b64, employee_id)

    if embedding is None:
        return {"success": False, "error": "No face detected"}

    idx = get_index().add(employee_id, embedding)
    processing_ms = int((time.perf_counter() - start) * 1000)

    return {
        "success": True,
        "employee_id": employee_id,
        "faiss_id": str(idx),
        "quality_score": quality,
        "processing_ms": processing_ms,
    }


def identify(image_b64: str, require_liveness: bool = True) -> dict:
    start = time.perf_counter()

    liveness_passed, _ = check_liveness(image_b64)
    if require_liveness and not liveness_passed:
        processing_ms = int((time.perf_counter() - start) * 1000)
        return {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "liveness_passed": False,
            "processing_ms": processing_ms,
        }

    embedding, _ = extract_embedding(image_b64)
    processing_ms = int((time.perf_counter() - start) * 1000)

    if embedding is None:
        return {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "liveness_passed": liveness_passed,
            "processing_ms": processing_ms,
        }

    employee_id, confidence = get_index().search(embedding)
    threshold = settings.recognition_threshold

    if confidence < threshold:
        employee_id = None

    return {
        "success": True,
        "employee_id": employee_id,
        "confidence": confidence,
        "liveness_passed": liveness_passed,
        "processing_ms": processing_ms,
    }


def delete_employee(employee_id: str) -> dict:
    get_index().remove_employee(employee_id)
    return {"success": True, "employee_id": employee_id}
