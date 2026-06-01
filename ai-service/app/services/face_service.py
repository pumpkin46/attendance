import base64
import io
import time

import cv2
import numpy as np
from PIL import Image

from app.core.config import settings
from app.services.faiss_index import FaissIndex
from app.services.liveness import verify_liveness

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


def _bbox_from_face(face) -> list[float]:
    bb = face.bbox
    return [float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])]


def _analyze_image(image_b64: str, employee_id: str | None = None):
    """
    Returns (image, embedding, det_score, face_count, insightface_ok, bbox_xyxy).
    """
    img = _decode_image(image_b64)
    if img is None:
        return None, None, 0.0, 0, False, None

    app = _get_face_app()
    if app is None:
        seed = employee_id or str(hash(image_b64) % 100000)
        return img, _mock_embedding(seed), 0.85, 1, False, None

    faces = app.get(img)
    if not faces:
        return img, None, 0.0, 0, True, None

    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    quality = float(getattr(face, "det_score", 0.9))
    embedding = np.array(face.embedding, dtype=np.float32)
    return img, embedding, quality, len(faces), True, _bbox_from_face(face)


def _liveness_payload(result) -> dict:
    return {
        "liveness_passed": result.passed,
        "liveness_score": round(result.score, 4),
        "face_count": result.face_count,
        "liveness_reason": result.reason,
        "liveness_checks": result.checks,
    }


def enroll(employee_id: str, image_b64: str) -> dict:
    start = time.perf_counter()
    img, embedding, det_score, face_count, insightface_ok, bbox = _analyze_image(
        image_b64, employee_id
    )

    if embedding is None:
        detail = "No face detected" if face_count == 0 else "Multiple faces detected — use a single-person photo"
        return {"success": False, "error": detail}

    if settings.liveness_enabled and settings.antispoof_block_enrollment:
        liveness = verify_liveness(img, bbox, face_count, det_score, insightface_ok)
        if not liveness.passed:
            processing_ms = int((time.perf_counter() - start) * 1000)
            return {
                "success": False,
                "error": f"Enrollment blocked: {liveness.reason or 'liveness_failed'}",
                "processing_ms": processing_ms,
                **_liveness_payload(liveness),
            }

    idx = get_index().add(employee_id, embedding)
    processing_ms = int((time.perf_counter() - start) * 1000)

    return {
        "success": True,
        "employee_id": employee_id,
        "faiss_id": str(idx),
        "quality_score": det_score,
        "processing_ms": processing_ms,
    }


def identify(image_b64: str, require_liveness: bool = True) -> dict:
    start = time.perf_counter()
    img, embedding, det_score, face_count, insightface_ok, bbox = _analyze_image(image_b64)

    liveness = verify_liveness(img, bbox, face_count, det_score, insightface_ok)
    liveness_block = require_liveness and settings.liveness_enabled and not liveness.passed

    if liveness_block:
        processing_ms = int((time.perf_counter() - start) * 1000)
        return {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "processing_ms": processing_ms,
            **_liveness_payload(liveness),
        }

    processing_ms = int((time.perf_counter() - start) * 1000)

    if embedding is None:
        return {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "processing_ms": processing_ms,
            **_liveness_payload(liveness),
        }

    employee_id, confidence = get_index().search(embedding)
    threshold = settings.recognition_threshold

    if confidence < threshold:
        employee_id = None

    return {
        "success": True,
        "employee_id": employee_id,
        "confidence": confidence,
        "processing_ms": processing_ms,
        **_liveness_payload(liveness),
    }


def delete_employee(employee_id: str) -> dict:
    get_index().remove_employee(employee_id)
    return {"success": True, "employee_id": employee_id}


def detect_faces(image_b64: str) -> dict:
    """Fast face detection only (no FAISS / liveness) for real-time overlay."""
    start = time.perf_counter()
    img = _decode_image(image_b64)
    if img is None:
        return {
            "success": True,
            "faces": [],
            "face_count": 0,
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    h, w = img.shape[:2]
    app = _get_face_app()
    if app is None:
        return {
            "success": True,
            "faces": [],
            "face_count": 0,
            "processing_ms": int((time.perf_counter() - start) * 1000),
            "image_width": w,
            "image_height": h,
        }

    faces = app.get(img)
    boxes = [
        {
            "bbox": _bbox_from_face(f),
            "det_score": float(getattr(f, "det_score", 0.9)),
        }
        for f in faces
    ]
    processing_ms = int((time.perf_counter() - start) * 1000)

    return {
        "success": True,
        "faces": boxes,
        "face_count": len(boxes),
        "processing_ms": processing_ms,
        "image_width": w,
        "image_height": h,
    }
