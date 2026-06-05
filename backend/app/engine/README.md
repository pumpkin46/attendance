# Recognition Engine — boundary with `app/services` and `app/features`

This package is a **long-running, per-camera streaming pipeline**. It is *not*
the request path. Keep the two worlds distinct:

| Concern | Lives in | Lifecycle | Example |
|---------|----------|-----------|---------|
| Request-scoped recognition (one image → one result) | `app/features/*/service.py` (and shared `app/services/*`) | per HTTP request | `POST /recognition/identify` → `recognition` service |
| Continuous stream processing (camera frames → tracks → attendance) | `app/engine/*` | started/stopped with the app lifespan | `recognition_engine.start()` |

## Rules

1. **No duplication of primitives.** Face detection, embedding extraction, and
   FAISS search are implemented **once** and imported by both worlds. The engine
   may wrap them with stream-specific concerns (tracking, batching, throttling),
   but must not reimplement the underlying model calls.
   - **Quality scoring** (`services/face_quality.py` ↔ `engine/quality_assessor.py`):
     the low-level CV math — blur, brightness, resolution, occlusion — lives once
     in `services/face_metrics.py` and is imported by both. Each caller passes its
     own reference constants and strictness (single-shot enrollment is stricter;
     per-frame gating is faster/looser), so tuning stays per-purpose while the
     math stays shared. The two files keep only their own orchestration:
     thresholds, score weights, rejection reasons, and result shapes.
   - **Liveness** (`services/liveness.py` ↔ `engine/liveness_detector.py`) is
     **intentionally two different algorithms, not a shared fork.** The service
     path runs the real MiniFASNet ONNX anti-spoof model (`services/antispoof.py`)
     plus active-liveness frame checks. The engine path runs a deliberately
     lightweight CV heuristic (texture/moiré/colour, blink + head-movement) sized
     for per-frame throughput and does **not** load the ONNX model. The only
     shared primitive is the Laplacian blur score (via `face_metrics.blur_score`).
     If the engine ever needs model-grade passive liveness, it should call
     `get_antispoof_verifier()` rather than re-deriving it.

2. **Engine never imports route handlers.** It depends on services and models
   only. Routes may *control* the engine (start/stop/metrics) via the engine's
   public functions (`get_recognition_engine()`), never the reverse.

3. **Engine emits, never invalidates.** Side effects (attendance records,
   alerts) go through the same services the request path uses, and realtime
   notifications go through `app/realtime`. This keeps business rules in one
   place regardless of whether recognition came from an upload or a camera.
