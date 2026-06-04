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
   - Known historical overlaps to keep consolidated, not forked:
     `services/face_quality.py` ↔ `engine/quality_assessor.py`,
     `services/liveness.py` ↔ `engine/liveness_detector.py`.
     These differ by *purpose* (single-shot verification vs. per-frame stream
     gating); the shared model/inference code underneath them is the same and
     stays shared.

2. **Engine never imports route handlers.** It depends on services and models
   only. Routes may *control* the engine (start/stop/metrics) via the engine's
   public functions (`get_recognition_engine()`), never the reverse.

3. **Engine emits, never invalidates.** Side effects (attendance records,
   alerts) go through the same services the request path uses, and realtime
   notifications go through `app/realtime`. This keeps business rules in one
   place regardless of whether recognition came from an upload or a camera.
