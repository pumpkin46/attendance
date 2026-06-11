import base64
import io
import time

import cv2
import numpy as np
from PIL import Image

from app.core.config import settings
from app.services.face_pose import ENROLLMENT_POSE_TYPES
from app.services.face_quality import validate_face_image
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
        det = settings.recognition_det_size
        app.prepare(ctx_id=0, det_size=(det, det))
        _face_app = app
        return _face_app
    except Exception:
        return None


_detection_app = None


def _get_detection_app():
    """Detection-only FaceAnalysis (bbox + 5 keypoints, no recognition embedding).

    Active liveness needs only landmarks per frame, so loading just the detector
    avoids running the expensive 512-d recognition model on every buffered frame —
    the dominant cost when a kiosk submits a multi-frame liveness sequence. Falls
    back to the full app, then to mock mode, if the slim load is unsupported.
    """
    global _detection_app
    if _detection_app is not None:
        return _detection_app

    try:
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(
            name="buffalo_l",
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection"],
        )
        # Smaller detector input: liveness only needs rough keypoints from a close
        # kiosk face, and 320×320 detection is several times faster than 640×640.
        app.prepare(ctx_id=0, det_size=(320, 320))
        _detection_app = app
        return _detection_app
    except Exception:
        return _get_face_app()


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
        "spoof_type": getattr(result, "spoof_type", None),
    }


def _get_faces(img: np.ndarray):
    app = _get_face_app()
    if app is None:
        return None, []
    return app, app.get(img)


def _required_poses() -> list[str]:
    raw = settings.enrollment_structured_poses.strip()
    if not raw:
        return list(ENROLLMENT_POSE_TYPES)
    return [p.strip() for p in raw.split(",") if p.strip()]


def _enrollment_score(accepted: list[dict], required_count: int) -> float:
    if not accepted:
        return 0.0
    completeness = len(accepted) / max(required_count, 1)
    avg_quality = sum(a.get("quality_score", 0) for a in accepted) / len(accepted)
    return round(min(1.0, 0.55 * completeness + 0.45 * avg_quality), 4)


def validate_image(image_b64: str, expected_pose: str | None = None) -> dict:
    """FR-007: Validate single image quality without storing."""
    start = time.perf_counter()
    img = _decode_image(image_b64)
    if img is None:
        return {
            "accepted": False,
            "reason": "invalid_image",
            "quality_score": 0.0,
            "checks": {},
            "face_metadata": None,
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    _, faces = _get_faces(img)
    if not faces and _get_face_app() is None:
        return {
            "accepted": True,
            "reason": None,
            "quality_score": 0.85,
            "checks": {"mode": "mock"},
            "face_metadata": {"detected_pose": expected_pose, "mode": "mock"},
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    result = validate_face_image(img, faces, expected_pose=expected_pose)
    result["face_metadata"] = result.get("face_metadata") or result.get("checks", {}).get(
        "face_metadata"
    )
    result["processing_ms"] = int((time.perf_counter() - start) * 1000)
    return result


def enroll_structured(employee_id: str, poses: dict[str, str]) -> dict:
    """
    Register one embedding per required pose slot (front, left, right, …).
    Each value is a base64 image keyed by pose type.
    """
    start = time.perf_counter()
    required = _required_poses()
    missing = [p for p in required if p not in poses or not poses[p]]
    if missing:
        return {
            "success": False,
            "error": f"Missing required poses: {', '.join(missing)}",
            "missing_poses": missing,
        }

    accepted: list[dict] = []
    rejected: list[dict] = []
    embeddings: list[np.ndarray] = []

    for pose_type in required:
        image_b64 = poses[pose_type]
        img = _decode_image(image_b64)
        app, faces = _get_faces(img) if img is not None else (None, [])

        if app is None and img is not None:
            seed = f"{employee_id}-{pose_type}"
            validation = {
                "accepted": True,
                "reason": None,
                "quality_score": 0.85,
                "checks": {"mode": "mock"},
                "face_metadata": {"pose_type": pose_type, "mode": "mock"},
            }
            embeddings.append(_mock_embedding(seed))
            accepted.append({"pose_type": pose_type, **validation})
            continue

        validation = (
            validate_face_image(img, faces, expected_pose=pose_type)
            if img is not None
            else {
                "accepted": False,
                "reason": "invalid_image",
                "quality_score": 0.0,
                "checks": {},
            }
        )

        if not validation["accepted"]:
            rejected.append({"pose_type": pose_type, **validation})
            continue

        if settings.liveness_enabled and settings.antispoof_block_enrollment and faces:
            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            bbox = _bbox_from_face(face)
            det = float(getattr(face, "det_score", 0.9))
            liveness = verify_liveness(img, bbox, len(faces), det, True)
            if not liveness.passed:
                rejected.append({
                    "pose_type": pose_type,
                    "accepted": False,
                    "reason": liveness.reason or "liveness_failed",
                    "quality_score": validation["quality_score"],
                    "checks": validation.get("checks", {}),
                })
                continue

        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        emb = np.array(face.embedding, dtype=np.float32)
        embeddings.append(emb)
        meta = validation.get("face_metadata") or {}
        meta["pose_type"] = pose_type
        accepted.append({
            "pose_type": pose_type,
            "quality_score": validation["quality_score"],
            "checks": validation.get("checks", {}),
            "face_metadata": meta,
            "embedding_dim": int(emb.shape[0]),
        })

    if rejected:
        return {
            "success": False,
            "error": f"{len(rejected)} pose(s) failed validation",
            "rejected": rejected,
            "accepted_count": len(accepted),
            "rejected_count": len(rejected),
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    faiss_ids = get_index().add_batch(employee_id, embeddings)
    processing_ms = int((time.perf_counter() - start) * 1000)
    avg_quality = sum(a["quality_score"] for a in accepted) / len(accepted)
    enrollment_score = _enrollment_score(accepted, len(required))

    return {
        "success": True,
        "employee_id": employee_id,
        "embeddings_stored": len(faiss_ids),
        "faiss_ids": [str(i) for i in faiss_ids],
        "average_quality_score": round(avg_quality, 4),
        "enrollment_score": enrollment_score,
        "accepted": accepted,
        "required_poses": required,
        "processing_ms": processing_ms,
    }


def enroll_batch(employee_id: str, images_b64: list[str]) -> dict:
    """FR-006: Register face from 10–50 validated images, store multiple embeddings."""
    start = time.perf_counter()
    min_n = settings.enrollment_min_images
    max_n = settings.enrollment_max_images

    if len(images_b64) < min_n:
        return {
            "success": False,
            "error": f"Minimum {min_n} images required, got {len(images_b64)}",
        }
    if len(images_b64) > max_n:
        return {
            "success": False,
            "error": f"Maximum {max_n} images allowed, got {len(images_b64)}",
        }

    accepted: list[dict] = []
    rejected: list[dict] = []
    embeddings: list[np.ndarray] = []

    for i, image_b64 in enumerate(images_b64):
        img = _decode_image(image_b64)
        app, faces = _get_faces(img) if img is not None else (None, [])

        if app is None and img is not None:
            seed = f"{employee_id}-{i}"
            validation = {
                "accepted": True,
                "reason": None,
                "quality_score": 0.85,
                "checks": {"mode": "mock"},
            }
            embeddings.append(_mock_embedding(seed))
            accepted.append({"index": i, **validation})
            continue

        validation = validate_face_image(img, faces) if img is not None else {
            "accepted": False,
            "reason": "invalid_image",
            "quality_score": 0.0,
            "checks": {},
        }

        if not validation["accepted"]:
            rejected.append({"index": i, **validation})
            continue

        if settings.liveness_enabled and settings.antispoof_block_enrollment and faces:
            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            bbox = _bbox_from_face(face)
            det = float(getattr(face, "det_score", 0.9))
            liveness = verify_liveness(img, bbox, len(faces), det, True)
            if not liveness.passed:
                rejected.append({
                    "index": i,
                    "accepted": False,
                    "reason": liveness.reason or "liveness_failed",
                    "quality_score": validation["quality_score"],
                    "checks": validation.get("checks", {}),
                })
                continue

        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        emb = np.array(face.embedding, dtype=np.float32)
        embeddings.append(emb)
        accepted.append({"index": i, **validation})

    if rejected:
        return {
            "success": False,
            "error": f"{len(rejected)} image(s) failed quality validation",
            "accepted_count": len(accepted),
            "rejected_count": len(rejected),
            "rejected": rejected,
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    if len(accepted) < min_n:
        return {
            "success": False,
            "error": f"Only {len(accepted)} valid images; minimum {min_n} required",
            "accepted_count": len(accepted),
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    faiss_ids = get_index().add_batch(employee_id, embeddings)
    processing_ms = int((time.perf_counter() - start) * 1000)
    avg_quality = sum(a["quality_score"] for a in accepted) / len(accepted)

    return {
        "success": True,
        "employee_id": employee_id,
        "embeddings_stored": len(faiss_ids),
        "faiss_ids": [str(i) for i in faiss_ids],
        "average_quality_score": round(avg_quality, 4),
        "accepted": accepted,
        "processing_ms": processing_ms,
    }


def enroll_simple(employee_id: str, images_b64: list[str]) -> dict:
    """Lenient face registration for the quick "register by camera" flow.

    Stores one embedding per image that contains exactly one detectable face.
    Unlike enroll_batch / enroll_structured, this applies NO blur, resolution,
    pose, or quality-score gating — only face presence — so ordinary webcam
    shots register without fighting the strict guided pipeline. Accepts one or
    more images; succeeds as long as at least one usable face is captured.
    """
    start = time.perf_counter()
    if not images_b64:
        return {"success": False, "error": "No images provided"}

    accepted: list[dict] = []
    rejected: list[dict] = []
    embeddings: list[np.ndarray] = []

    for i, image_b64 in enumerate(images_b64):
        _, embedding, det_score, face_count, _, _ = _analyze_image(
            image_b64, f"{employee_id}-{i}"
        )
        if embedding is None or face_count == 0:
            rejected.append({"index": i, "reason": "no_face"})
            continue
        if face_count > 1:
            rejected.append({"index": i, "reason": "multiple_faces"})
            continue
        embeddings.append(embedding)
        accepted.append({"index": i, "quality_score": round(float(det_score), 4)})

    if not embeddings:
        return {
            "success": False,
            "error": "No face detected — make sure one face is clearly visible.",
            "accepted_count": 0,
            "rejected_count": len(rejected),
            "rejected": rejected,
            "processing_ms": int((time.perf_counter() - start) * 1000),
        }

    faiss_ids = get_index().add_batch(employee_id, embeddings)
    avg_quality = sum(a["quality_score"] for a in accepted) / len(accepted)
    return {
        "success": True,
        "employee_id": employee_id,
        "embeddings_stored": len(faiss_ids),
        "faiss_ids": [str(i) for i in faiss_ids],
        "average_quality_score": round(avg_quality, 4),
        "accepted": accepted,
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "rejected": rejected,
        "processing_ms": int((time.perf_counter() - start) * 1000),
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


def recognize(
    image_b64: str,
    require_liveness: bool = True,
    liveness_frames: list[str] | None = None,
    session_id: str | None = None,
    source: str | None = None,
) -> dict:
    """Full recognition pipeline with per-stage timings."""
    from app.services.recognition_pipeline import recognize as run_pipeline

    return run_pipeline(
        image_b64,
        require_liveness=require_liveness,
        liveness_frames=liveness_frames,
        session_id=session_id,
        source=source,
    )


def identify(
    image_b64: str,
    require_liveness: bool = True,
    liveness_frames: list[str] | None = None,
    session_id: str | None = None,
    source: str | None = None,
) -> dict:
    """Backward-compatible identify — uses recognition pipeline."""
    result = recognize(
        image_b64,
        require_liveness=require_liveness,
        liveness_frames=liveness_frames,
        session_id=session_id,
        source=source,
    )
    reason = result.get("reason")
    return {
        "success": result.get("success", True),
        "employee_id": result.get("employee_id"),
        "confidence": result.get("confidence", 0.0),
        "processing_ms": result.get("processing_ms", 0),
        "recognition_ms": result.get("recognition_ms"),
        "liveness_ms": result.get("liveness_ms"),
        "reason": reason,
        "quality_score": result.get("quality_score"),
        "track_id": result.get("track_id"),
        "pipeline": result.get("pipeline"),
        "sla": result.get("sla"),
        "liveness_passed": result.get("liveness_passed"),
        "liveness_score": result.get("liveness_score"),
        "liveness_reason": result.get("liveness_reason"),
        "liveness_checks": result.get("liveness_checks"),
        "spoof_type": result.get("spoof_type"),
        "face_count": result.get("face_count"),
    }


def delete_employee(employee_id: str) -> dict:
    get_index().remove_employee(employee_id)
    return {"success": True, "employee_id": employee_id}


def verify_liveness_sequence(frames_b64: list[str]) -> dict:
    """Standalone FR-018 active liveness check."""
    from app.services.active_liveness import verify_active_liveness

    start = time.perf_counter()
    result = verify_active_liveness(frames_b64)
    processing_ms = int((time.perf_counter() - start) * 1000)

    return {
        "success": True,
        "passed": result.passed,
        "score": round(result.score, 4),
        "blink_detected": result.blink_detected,
        "head_movement_detected": result.head_movement_detected,
        "frame_count": result.frame_count,
        "reason": result.reason,
        "checks": result.checks,
        "processing_ms": processing_ms,
    }


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


def export_embeddings() -> dict:
    idx = get_index()
    bundle = idx.export_bundle()
    return {"success": True, **bundle}


def import_embeddings(index_b64: str, metadata: dict) -> dict:
    global _index
    idx = get_index()
    idx.import_bundle(index_b64, metadata)
    _index = idx
    return {
        "success": True,
        "embedding_count": idx.count(),
        "version": idx.version_hash(),
    }


def reload_embeddings() -> dict:
    global _index
    _index = None
    idx = get_index()
    return {
        "success": True,
        "embedding_count": idx.count(),
        "version": idx.version_hash(),
    }
