"""
Real-time recognition pipeline:

Video Stream → Face Detection → Face Tracking → Face Quality → Liveness
→ Embedding → Vector Search → Identity Match
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from app.core.config import settings
from app.services.face_quality import validate_face_image
from app.services.face_service import (
    _analyze_image,
    _decode_image,
    _get_faces,
    _liveness_payload,
    get_index,
)
from app.services.face_tracking import assign_track
from app.services.liveness import verify_liveness


def _stage(name: str, started: float, extra: dict | None = None) -> dict:
    ms = int((time.perf_counter() - started) * 1000)
    out: dict[str, Any] = {"stage": name, "duration_ms": ms, "status": "ok"}
    if extra:
        out.update(extra)
    return out


def _fail(
    pipeline: list[dict],
    stage: str,
    reason: str,
    *,
    liveness: Any = None,
    total_ms: int = 0,
) -> dict:
    payload: dict[str, Any] = {
        "success": True,
        "employee_id": None,
        "confidence": 0.0,
        "matched": False,
        "reason": reason,
        "pipeline": pipeline,
        "processing_ms": total_ms,
        "recognition_ms": total_ms,
        "liveness_ms": sum(s.get("duration_ms", 0) for s in pipeline if s.get("stage") == "liveness_detection"),
    }
    if liveness is not None:
        payload.update(_liveness_payload(liveness))
    return payload


def recognize(
    image_b64: str,
    *,
    require_liveness: bool = True,
    liveness_frames: list[str] | None = None,
    session_id: str | None = None,
    source: str | None = None,
) -> dict:
    wall_start = time.perf_counter()
    pipeline: list[dict] = []

    # 1. Video stream / frame decode
    t0 = time.perf_counter()
    img = _decode_image(image_b64)
    if img is None:
        pipeline.append(_stage("video_stream", t0, {"status": "failed", "reason": "invalid_image"}))
        total = int((time.perf_counter() - wall_start) * 1000)
        return _fail(pipeline, "video_stream", "invalid_image", total_ms=total)

    h, w = img.shape[:2]
    pipeline.append(
        _stage("video_stream", t0, {"width": w, "height": h, "source": source})
    )

    # 2. Face detection
    t1 = time.perf_counter()
    app, faces = _get_faces(img)
    insightface_ok = app is not None
    face_count = len(faces)
    pipeline.append(
        _stage(
            "face_detection",
            t1,
            {"face_count": face_count, "insightface": insightface_ok},
        )
    )

    if not insightface_ok:
        img2, embedding, det_score, fc, _, bbox = _analyze_image(image_b64)
        liveness = verify_liveness(img2, bbox, fc, det_score, False, liveness_frames)
        employee_id, confidence = (None, 0.0)
        if embedding is not None:
            employee_id, confidence = get_index().search(embedding)
            if confidence < settings.recognition_threshold:
                employee_id = None
        total = int((time.perf_counter() - wall_start) * 1000)
        pipeline.append(_stage("embedding_generation", t1, {"mode": "mock"}))
        pipeline.append(_stage("vector_search", t1, {"mode": "mock"}))
        pipeline.append(
            _stage(
                "identity_match",
                t1,
                {"employee_id": employee_id, "confidence": round(confidence, 4)},
            )
        )
        return {
            "success": True,
            "employee_id": employee_id,
            "confidence": confidence,
            "matched": employee_id is not None,
            "pipeline": pipeline,
            "processing_ms": total,
            "recognition_ms": total,
            "liveness_ms": 0,
            "source": source,
            **_liveness_payload(liveness),
        }

    if face_count == 0:
        total = int((time.perf_counter() - wall_start) * 1000)
        return _fail(pipeline, "face_detection", "no_face", total_ms=total)

    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    bbox = [float(v) for v in face.bbox]
    det_score = float(getattr(face, "det_score", 0.0))

    # 3. Face tracking
    t2 = time.perf_counter()
    track_info = assign_track(session_id, bbox)
    pipeline.append(_stage("face_tracking", t2, track_info))

    # 4. Face quality check — advisory by default (see recognition_require_quality).
    # The score is recorded for telemetry, but a soft/dim frame still proceeds to
    # matching so genuine faces are recognized rather than rejected as "blurry".
    # Enrollment keeps its own strict validation independently.
    t3 = time.perf_counter()
    quality = validate_face_image(img, faces)
    pipeline.append(
        _stage(
            "face_quality_check",
            t3,
            {
                "accepted": quality["accepted"],
                "quality_score": quality.get("quality_score"),
                "reason": quality.get("reason"),
                "enforced": settings.recognition_require_quality,
            },
        )
    )
    if settings.recognition_require_quality and not quality["accepted"]:
        total = int((time.perf_counter() - wall_start) * 1000)
        return _fail(
            pipeline,
            "face_quality_check",
            quality.get("reason") or "low_quality",
            total_ms=total,
        )

    # 5. Liveness detection
    t4 = time.perf_counter()
    liveness = verify_liveness(
        img, bbox, face_count, det_score, insightface_ok, liveness_frames
    )
    pipeline.append(
        _stage(
            "liveness_detection",
            t4,
            {
                "passed": liveness.passed,
                "score": round(liveness.score, 4),
                "reason": liveness.reason,
            },
        )
    )
    liveness_ms = int((time.perf_counter() - t4) * 1000)

    if require_liveness and settings.liveness_enabled and not liveness.passed:
        total = int((time.perf_counter() - wall_start) * 1000)
        return _fail(
            pipeline,
            "liveness_detection",
            liveness.reason or "liveness_failed",
            liveness=liveness,
            total_ms=total,
        )

    # 6. Embedding generation
    t5 = time.perf_counter()
    embedding = np.array(face.embedding, dtype=np.float32)
    pipeline.append(
        _stage("embedding_generation", t5, {"dim": int(embedding.shape[0])})
    )

    # 7. Vector search
    t6 = time.perf_counter()
    employee_id, confidence = get_index().search(embedding)
    pipeline.append(
        _stage(
            "vector_search",
            t6,
            {"top_confidence": round(float(confidence), 4)},
        )
    )

    # 8. Identity match (threshold)
    t7 = time.perf_counter()
    threshold = settings.recognition_threshold
    matched = confidence >= threshold and employee_id is not None
    if not matched:
        employee_id = None
    pipeline.append(
        _stage(
            "identity_match",
            t7,
            {
                "threshold": threshold,
                "matched": matched,
                "employee_id": employee_id,
            },
        )
    )

    recognition_ms = sum(
        s["duration_ms"]
        for s in pipeline
        if s.get("stage")
        not in ("video_stream", "liveness_detection")
    )
    total = int((time.perf_counter() - wall_start) * 1000)

    return {
        "success": True,
        "employee_id": employee_id,
        "confidence": float(confidence),
        "matched": matched,
        "quality_score": quality.get("quality_score"),
        "track_id": track_info.get("track_id"),
        "face_count": face_count,
        "bbox": bbox,
        "pipeline": pipeline,
        "processing_ms": total,
        "recognition_ms": recognition_ms,
        "liveness_ms": liveness_ms,
        "source": source,
        "sla": {
            "recognition_target_ms": settings.recognition_sla_ms,
            "liveness_target_ms": settings.liveness_sla_ms,
            "recognition_met": recognition_ms <= settings.recognition_sla_ms,
            "liveness_met": liveness_ms <= settings.liveness_sla_ms,
            "total_met": total <= settings.recognition_sla_ms + settings.liveness_sla_ms,
        },
        **_liveness_payload(liveness),
    }
