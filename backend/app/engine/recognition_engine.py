"""
AI Recognition Engine — Main orchestrator for the 9-stage pipeline.

Pipeline:
  Video Acquisition → Face Detection → Face Tracking → Quality Assessment
  → Liveness Detection → Embedding Generation → Vector Search
  → Identity Verification → Attendance Event Creation

Handles:
- Real-time multi-camera processing
- High-density crowd detection (100+ faces)
- Unknown person detection & alerting
- Access control integration
- Performance monitoring
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from app.engine.attendance_generator import (
    AttendanceEvent,
    AttendanceEventType,
    get_attendance_generator,
)
from app.engine.config import EngineConfig, engine_config
from app.engine.embedding_generator import get_embedding_generator
from app.engine.face_detector import DetectedFace, get_detector
from app.engine.face_tracker import get_tracker
from app.engine.identity_verifier import (
    VerificationContext,
    get_identity_verifier,
)
from app.engine.liveness_detector import get_liveness_detector
from app.engine.metrics import get_metrics
from app.engine.quality_assessor import get_quality_assessor
from app.engine.stream_manager import get_stream_manager
from app.engine.unknown_detector import get_unknown_detector
from app.engine.vector_search import MatchAction, get_vector_search
from app.services.face_image_processor import enhance_low_light
from app.services.face_utils import decode_image

logger = logging.getLogger(__name__)

# Pipeline reasons that mean a presentation attack / failed liveness, used to
# colour a live face box red. Mirrors the frontend's SPOOF_REASONS so the
# overlay and the kiosk agree on what counts as a spoof.
_SPOOF_REASONS = frozenset({
    "spoof_detected",
    "liveness_failed",
    "heuristic_failed",
    "blink_not_detected",
    "head_movement_not_detected",
    "active_liveness_failed",
    "antispoof_model_unavailable",
})

# A track whose last sighting is older than this is treated as gone, so the
# overlay drops its box instead of showing a stale rectangle once the person
# leaves view or frames stop flowing.
_DETECTION_STALE_SECONDS = 1.5


@dataclass
class RecognitionResult:
    success: bool
    employee_id: str | None = None
    employee_name: str | None = None
    confidence: float = 0.0
    matched: bool = False
    liveness_passed: bool = False
    liveness_score: float = 0.0
    quality_score: float = 0.0
    verification_level: str | None = None
    event_type: str | None = None
    attendance_event: AttendanceEvent | None = None
    is_unknown: bool = False
    track_id: int | None = None
    camera_id: int | None = None
    pipeline_stages: list[dict] = field(default_factory=list)
    processing_ms: int = 0
    reason: str | None = None
    sla: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "employee_id": self.employee_id,
            "employee_name": self.employee_name,
            "confidence": round(self.confidence, 4),
            "matched": self.matched,
            "liveness_passed": self.liveness_passed,
            "liveness_score": round(self.liveness_score, 4),
            "quality_score": round(self.quality_score, 4),
            "verification_level": self.verification_level,
            "event_type": self.event_type,
            "is_unknown": self.is_unknown,
            "track_id": self.track_id,
            "camera_id": self.camera_id,
            "pipeline": self.pipeline_stages,
            "processing_ms": self.processing_ms,
            "reason": self.reason,
            "sla": self.sla,
        }


class RecognitionEngine:
    """
    The core AI Recognition Engine that processes video frames through
    the full 9-stage pipeline and generates attendance events.
    """

    def __init__(self, config: EngineConfig | None = None) -> None:
        self._config = config or engine_config
        self._stream_manager = get_stream_manager()
        self._detector = get_detector()
        self._tracker = get_tracker()
        self._quality_assessor = get_quality_assessor()
        self._liveness_detector = get_liveness_detector()
        self._embedding_generator = get_embedding_generator()
        self._vector_search = get_vector_search()
        self._identity_verifier = get_identity_verifier()
        self._attendance_generator = get_attendance_generator()
        self._unknown_detector = get_unknown_detector()
        self._metrics = get_metrics()
        self._running = False
        self._process_task: asyncio.Task | None = None
        # Live-video backpressure: when this many recognitions are in flight,
        # further faces are dropped (not queued) — the tracker keeps
        # needs_recognition set, so they retry on a later frame.
        self._max_concurrent_recognitions = 2
        self._inflight_recognitions = 0
        self._recognition_tasks: set[asyncio.Task] = set()
        # Recent frames per (camera_id, track_id) for the optional temporal
        # liveness check. Only populated when liveness.live_active_required is on
        # (default off), and pruned to the live track set each frame so it never
        # grows unbounded.
        self._frame_buffers: dict[tuple[int, int], deque] = {}

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start the recognition engine and begin processing streams."""
        self._running = True
        self._stream_manager.register_callback(self._process_frame)
        await self._stream_manager.start()
        logger.info("Recognition Engine started")

    async def stop(self) -> None:
        """Stop the engine and all stream processing."""
        self._running = False
        await self._stream_manager.stop()
        logger.info("Recognition Engine stopped")

    def _prepare_frame(self, frame: np.ndarray) -> np.ndarray:
        """Adaptively brighten a dark frame before detection.

        Applied once at every entry point so the SAME enhanced frame feeds
        detection + the ArcFace embedding (both produced by one InsightFace
        ``app.get`` call) and the downstream quality gate + liveness. Enhancing
        only inside detection would leave the quality gate rejecting the dark
        original as ``underexposed``; enhancing only here would never reach the
        embedding. A no-op for well-lit frames (see ``enhance_low_light``).
        """
        enh = self._config.enhancement
        if not enh.low_light_enabled:
            return frame
        return enhance_low_light(
            frame,
            target_luminance=enh.target_luminance,
            max_gain=enh.max_gain,
            clahe_clip_limit=enh.clahe_clip_limit,
        )

    async def _process_frame(
        self, camera_id: int, frame: np.ndarray, timestamp: float
    ) -> None:
        """Process a single frame through the full pipeline."""
        try:
            # Brighten dark frames once, off the event loop, then reuse the same
            # enhanced frame for detection AND the per-face recognition below.
            frame = await asyncio.to_thread(self._prepare_frame, frame)
            detection = await asyncio.to_thread(self._detector.detect, frame)
            self._metrics.record_detection(detection.face_count)
            self._metrics.record_pipeline_stage(
                "face_detection", detection.detection_ms
            )

            if detection.face_count == 0:
                return

            track_results = self._tracker.update(camera_id, detection.faces)

            buffer_active = (
                self._config.liveness.live_active_required
                and self._config.liveness.active_enabled
            )
            if buffer_active:
                self._buffer_frames(camera_id, track_results, frame)

            for face, track_info in track_results:
                if not track_info.needs_recognition:
                    continue
                if self._inflight_recognitions >= self._max_concurrent_recognitions:
                    continue

                liveness_frames = None
                if buffer_active:
                    buf = self._frame_buffers.get((camera_id, track_info.track_id))
                    liveness_frames = list(buf) if buf else None

                self._inflight_recognitions += 1
                task = asyncio.create_task(
                    self._recognize_tracked_face(
                        frame, face, track_info.track_id, camera_id, timestamp,
                        liveness_frames=liveness_frames,
                    )
                )
                self._recognition_tasks.add(task)
                task.add_done_callback(self._recognition_tasks.discard)

        except Exception as e:
            logger.error("Frame processing error on camera %d: %s", camera_id, e)

    def _buffer_frames(self, camera_id: int, track_results, frame: np.ndarray) -> None:
        """Append the current frame to each live track's ring buffer.

        Only called when temporal liveness is enabled. Buffers are pruned to the
        set of tracks present this frame so they never accumulate for tracks the
        tracker has dropped.
        """
        maxlen = self._config.liveness.live_frame_buffer
        live_keys = set()
        for _face, track_info in track_results:
            key = (camera_id, track_info.track_id)
            live_keys.add(key)
            buf = self._frame_buffers.get(key)
            if buf is None or buf.maxlen != maxlen:
                buf = deque(maxlen=maxlen)
                self._frame_buffers[key] = buf
            buf.append(frame)
        for key in [k for k in self._frame_buffers if k[0] == camera_id and k not in live_keys]:
            del self._frame_buffers[key]

    async def _recognize_tracked_face(
        self,
        frame: np.ndarray,
        face: DetectedFace,
        track_id: int,
        camera_id: int,
        timestamp: float,
        liveness_frames: list[np.ndarray] | None = None,
    ) -> None:
        """Run the full recognition pipeline on a tracked face."""
        try:
            # The registered stream carries the camera's configured direction,
            # location and zone (hydrated from the cameras table), so entry/exit
            # cameras emit correctly-typed CHECK_IN/CHECK_OUT events instead of
            # every live event defaulting to CHECK_IN.
            stream = self._stream_manager.get_stream(camera_id)
            result = await asyncio.to_thread(
                self.recognize_face,
                frame,
                face,
                camera_id=camera_id,
                location_id=stream.location_id if stream else None,
                zone=stream.zone if stream else None,
                direction=stream.direction if stream else None,
                liveness_frames=liveness_frames,
                require_active=self._config.liveness.live_active_required,
            )

            self._tracker.mark_recognized(
                camera_id, track_id,
                result.employee_id, result.confidence,
                liveness_passed=result.liveness_passed,
                reason=result.reason,
            )

            if result.matched:
                self._metrics.record_recognition(True)
            elif result.is_unknown:
                self._metrics.record_recognition(False)

        except Exception as e:
            logger.error("Recognition error for track %d: %s", track_id, e)
        finally:
            self._inflight_recognitions -= 1

    def recognize_face(
        self,
        frame: np.ndarray,
        face: DetectedFace,
        *,
        camera_id: int | None = None,
        location_id: int | None = None,
        zone: str | None = None,
        direction: str | None = None,
        rfid_employee_id: str | None = None,
        liveness_frames: list[np.ndarray] | None = None,
        require_active: bool = False,
        enqueue: bool = True,
    ) -> RecognitionResult:
        """Run full recognition pipeline on a single detected face.

        enqueue=False (API-initiated calls only) keeps the generated event
        out of the background consumer's queue; the API handler persists it
        inline. The live tracked path always queues (enqueue=True).
        """
        wall_start = time.perf_counter()
        pipeline: list[dict] = []

        # Stage 4: Quality Assessment
        t0 = time.perf_counter()
        quality = self._quality_assessor.assess(frame, face)
        quality_ms = int((time.perf_counter() - t0) * 1000)
        pipeline.append({
            "stage": "quality_assessment",
            "duration_ms": quality_ms,
            "accepted": quality.accepted,
            "score": quality.quality_score,
        })
        self._metrics.record_pipeline_stage("quality_assessment", quality_ms)

        if not quality.accepted:
            self._metrics.record_quality_rejected()
            return RecognitionResult(
                success=True,
                quality_score=quality.quality_score,
                pipeline_stages=pipeline,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                reason=quality.rejection_reason,
            )

        # Stage 5: Liveness Detection
        t1 = time.perf_counter()
        liveness = self._liveness_detector.verify(
            frame, face, liveness_frames=liveness_frames, require_active=require_active
        )
        liveness_ms = int((time.perf_counter() - t1) * 1000)
        pipeline.append({
            "stage": "liveness_detection",
            "duration_ms": liveness_ms,
            "passed": liveness.passed,
            "score": liveness.score,
        })
        self._metrics.record_pipeline_stage("liveness_detection", liveness_ms)
        self._metrics.record_liveness(liveness.passed)

        if not liveness.passed and self._config.liveness.enabled:
            return RecognitionResult(
                success=True,
                liveness_passed=False,
                liveness_score=liveness.score,
                quality_score=quality.quality_score,
                pipeline_stages=pipeline,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                reason=liveness.reason or "liveness_failed",
            )

        # Stage 6: Embedding Generation
        t2 = time.perf_counter()
        emb_result = self._embedding_generator.generate(face)
        embedding_ms = int((time.perf_counter() - t2) * 1000)
        pipeline.append({
            "stage": "embedding_generation",
            "duration_ms": embedding_ms,
            "dimension": emb_result.dimension if emb_result else 0,
        })
        self._metrics.record_pipeline_stage("embedding_generation", embedding_ms)

        if emb_result is None:
            return RecognitionResult(
                success=True,
                liveness_passed=liveness.passed,
                liveness_score=liveness.score,
                quality_score=quality.quality_score,
                pipeline_stages=pipeline,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                reason="embedding_failed",
            )

        # Stage 7: Vector Search
        t3 = time.perf_counter()
        search_result = self._vector_search.search(emb_result.embedding)
        search_ms = int((time.perf_counter() - t3) * 1000)
        pipeline.append({
            "stage": "vector_search",
            "duration_ms": search_ms,
            "action": search_result.action.value,
            "confidence": search_result.confidence,
        })
        self._metrics.record_pipeline_stage("vector_search", search_ms)

        # Stage 8: Identity Verification
        t4 = time.perf_counter()
        context = VerificationContext(
            face_match=search_result,
            liveness=liveness,
            rfid_match=rfid_employee_id is not None,
            rfid_employee_id=rfid_employee_id,
            location_match=location_id is not None,
            location_id=location_id,
            camera_direction=direction,
        )
        verification = self._identity_verifier.verify(context)
        verify_ms = int((time.perf_counter() - t4) * 1000)
        pipeline.append({
            "stage": "identity_verification",
            "duration_ms": verify_ms,
            "verified": verification.verified,
            "level": verification.level.value,
        })
        self._metrics.record_pipeline_stage("identity_verification", verify_ms)

        # Stage 9: Attendance Event or Unknown Person
        t5 = time.perf_counter()
        attendance_event = None

        if verification.verified and verification.employee_id:
            attendance_event = self._attendance_generator.generate_event(
                employee_id=verification.employee_id,
                camera_id=camera_id,
                event_type=AttendanceEventType.CHECK_IN,
                confidence=verification.confidence,
                liveness_score=liveness.score,
                location_id=location_id,
                zone=zone,
                direction=direction,
                verification_level=verification.level.value,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                enqueue=enqueue,
            )
            if attendance_event:
                self._metrics.record_attendance_event()
            else:
                self._metrics.record_duplicate_prevented()

        elif search_result.action == MatchAction.UNKNOWN:
            self._unknown_detector.process_unknown(
                frame,
                camera_id=camera_id,
                location_id=location_id,
                zone=zone,
                confidence=search_result.confidence,
                bbox=face.bbox_xyxy,
            )
        elif search_result.action == MatchAction.REVIEW:
            # Borderline match (review band): below auto-accept but above the
            # unknown floor. We do not auto-write attendance, but log it rather
            # than dropping it silently so a miscalibrated threshold is visible
            # in the logs/metrics instead of looking like a clean non-match.
            logger.info(
                "Review-band match on camera %s: employee %s @ conf=%.3f "
                "(between review %.2f and auto-accept %.2f)",
                camera_id,
                search_result.employee_id,
                search_result.confidence,
                self._config.search.review_threshold,
                self._config.search.auto_accept_threshold,
            )
            self._metrics.record_recognition(False)

        event_ms = int((time.perf_counter() - t5) * 1000)
        pipeline.append({
            "stage": "event_creation",
            "duration_ms": event_ms,
            "event_generated": attendance_event is not None,
        })
        self._metrics.record_pipeline_stage("event_creation", event_ms)

        total_ms = int((time.perf_counter() - wall_start) * 1000)
        perf = self._config.performance

        return RecognitionResult(
            success=True,
            employee_id=verification.employee_id,
            confidence=verification.confidence,
            matched=verification.verified,
            liveness_passed=liveness.passed,
            liveness_score=liveness.score,
            quality_score=quality.quality_score,
            verification_level=verification.level.value,
            event_type=attendance_event.event_type.value if attendance_event else None,
            attendance_event=attendance_event,
            is_unknown=search_result.action == MatchAction.UNKNOWN,
            camera_id=camera_id,
            pipeline_stages=pipeline,
            processing_ms=total_ms,
            reason=verification.reason,
            sla={
                "recognition_target_ms": perf.max_recognition_ms,
                "liveness_target_ms": perf.max_liveness_ms,
                "total_target_ms": perf.max_recognition_ms + perf.max_liveness_ms,
                "recognition_met": (total_ms - liveness_ms) <= perf.max_recognition_ms,
                "liveness_met": liveness_ms <= perf.max_liveness_ms,
                "total_met": total_ms <= perf.max_recognition_ms + perf.max_liveness_ms,
            },
        )

    def recognize_image(
        self,
        image_b64: str,
        *,
        camera_id: int | None = None,
        location_id: int | None = None,
        zone: str | None = None,
        direction: str | None = None,
        rfid_employee_id: str | None = None,
        liveness_frames_b64: list[str] | None = None,
        enqueue: bool = True,
    ) -> RecognitionResult:
        """Recognize from a base64-encoded image (for API calls and photo uploads)."""
        wall_start = time.perf_counter()
        pipeline: list[dict] = []

        # Stage 1: Decode image
        t0 = time.perf_counter()
        frame = decode_image(image_b64)
        decode_ms = int((time.perf_counter() - t0) * 1000)
        pipeline.append({"stage": "video_acquisition", "duration_ms": decode_ms})

        if frame is None:
            return RecognitionResult(
                success=False,
                pipeline_stages=pipeline,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                reason="invalid_image",
            )

        # Brighten dark frames before detection so the same enhanced frame is
        # used by detection, embedding, the quality gate and liveness.
        frame = self._prepare_frame(frame)

        # Stage 2: Face Detection
        t1 = time.perf_counter()
        detection = self._detector.detect(frame)
        detection_ms = int((time.perf_counter() - t1) * 1000)
        pipeline.append({
            "stage": "face_detection",
            "duration_ms": detection_ms,
            "face_count": detection.face_count,
        })
        self._metrics.record_detection(detection.face_count)
        self._metrics.record_pipeline_stage("face_detection", detection_ms)

        if detection.face_count == 0:
            return RecognitionResult(
                success=True,
                pipeline_stages=pipeline,
                processing_ms=int((time.perf_counter() - wall_start) * 1000),
                reason="no_face_detected",
            )

        face = detection.faces[0]

        # Stage 3: Track assignment
        t2 = time.perf_counter()
        track_results = self._tracker.update(camera_id or 0, [face])
        track_ms = int((time.perf_counter() - t2) * 1000)
        track_id = track_results[0][1].track_id if track_results else None
        pipeline.append({"stage": "face_tracking", "duration_ms": track_ms, "track_id": track_id})
        self._metrics.record_pipeline_stage("face_tracking", track_ms)

        # Decode liveness frames if provided
        liveness_frames = None
        if liveness_frames_b64:
            liveness_frames = [
                f for f in (decode_image(fb) for fb in liveness_frames_b64) if f is not None
            ]

        result = self.recognize_face(
            frame, face,
            camera_id=camera_id,
            location_id=location_id,
            zone=zone,
            direction=direction,
            rfid_employee_id=rfid_employee_id,
            liveness_frames=liveness_frames,
            enqueue=enqueue,
        )

        result.track_id = track_id
        result.pipeline_stages = pipeline + result.pipeline_stages
        result.processing_ms = int((time.perf_counter() - wall_start) * 1000)
        return result

    def recognize_stream(
        self,
        stream_url: str,
        *,
        camera_id: int | None = None,
        location_id: int | None = None,
        zone: str | None = None,
        direction: str | None = None,
        enqueue: bool = True,
    ) -> RecognitionResult:
        """Capture a frame from a stream and run recognition."""
        capture = self._stream_manager.capture_frame(stream_url)
        if not capture["success"]:
            return RecognitionResult(
                success=False,
                reason=capture.get("error", "stream_capture_failed"),
                processing_ms=capture.get("processing_ms", 0),
            )

        frame = self._prepare_frame(capture["frame"])
        detection = self._detector.detect(frame)
        if detection.face_count == 0:
            return RecognitionResult(
                success=True,
                reason="no_face_detected",
                processing_ms=capture["processing_ms"],
            )

        face = detection.faces[0]
        return self.recognize_face(
            frame, face,
            camera_id=camera_id,
            location_id=location_id,
            zone=zone,
            direction=direction,
            enqueue=enqueue,
        )

    def detect_faces(self, image_b64: str) -> dict:
        """Detect faces without full recognition (for real-time overlay)."""
        frame = decode_image(image_b64)
        if frame is None:
            return {"success": False, "faces": [], "face_count": 0}

        frame = self._prepare_frame(frame)
        result = self._detector.detect(frame)
        return {
            "success": True,
            "faces": [f.to_dict() for f in result.faces],
            "face_count": result.face_count,
            "detection_ms": result.detection_ms,
            "frame_width": result.frame_width,
            "frame_height": result.frame_height,
        }

    def get_camera_detections(self, camera_id: int) -> dict:
        """Live per-face detection snapshot for one camera (for the UI overlay).

        Reads the tracker — the merge point where the asynchronous recognition
        results land — together with the stream's current frame resolution, and
        returns each on-screen face as a box normalised to [0, 1] plus a derived
        display status. ``employee_id`` is the raw FAISS identity; the API layer
        resolves it to a tenant-gated name before it reaches the browser.

        Pure in-memory reads with no awaits, so it stays atomic against the
        engine's own coroutines on the event loop — call it directly, never via
        a worker thread (which could iterate the tracks dict mid-mutation).
        """
        stream = self._stream_manager.get_stream(camera_id)
        width, height = (stream.health.resolution if stream else (0, 0)) or (0, 0)
        now = time.time()
        faces: list[dict] = []
        for track in self._tracker.get_camera_tracks(camera_id).values():
            if now - track.last_seen > _DETECTION_STALE_SECONDS:
                continue
            if track.employee_id is not None:
                status = "recognized"
            elif track.reason in _SPOOF_REASONS:
                status = "spoof"
            elif track.is_unknown:
                status = "unknown"
            else:
                status = "detecting"
            x1, y1, x2, y2 = track.bbox
            if width and height:
                bbox = [
                    max(0.0, min(1.0, x1 / width)),
                    max(0.0, min(1.0, y1 / height)),
                    max(0.0, min(1.0, x2 / width)),
                    max(0.0, min(1.0, y2 / height)),
                ]
            else:
                bbox = [0.0, 0.0, 0.0, 0.0]
            faces.append({
                "track_id": track.track_id,
                "bbox": [round(v, 4) for v in bbox],
                "status": status,
                "employee_id": track.employee_id,
                "confidence": round(track.confidence, 4) if track.employee_id else None,
                "liveness_passed": track.liveness_passed,
                "reason": track.reason if status in ("unknown", "spoof") else None,
            })
        return {
            "camera_id": camera_id,
            "running": self._running,
            "frame_width": width,
            "frame_height": height,
            "faces": faces,
        }

    def get_engine_status(self) -> dict:
        lcfg = self._config.liveness
        # Make the live-path liveness posture explicit so operators do not
        # assume temporal/replay protection that is not actually enforced.
        if not lcfg.enabled:
            live_mode = "disabled"
        elif lcfg.live_active_required and lcfg.active_enabled:
            live_mode = "passive+active"
        else:
            live_mode = "passive_only"
        return {
            "running": self._running,
            "streams": self._stream_manager.get_all_status(),
            "tracking": self._tracker.get_stats(),
            "search_index": self._vector_search.get_stats(),
            "attendance": self._attendance_generator.stats,
            "unknown_persons": self._unknown_detector.stats,
            "metrics": self._metrics.get_performance_summary(),
            "sla_compliance": self._metrics.get_sla_compliance(),
            "liveness": {
                "enabled": lcfg.enabled,
                "live_mode": live_mode,
                "passive_enabled": lcfg.passive_enabled,
                "active_enabled": lcfg.active_enabled,
                "live_active_required": lcfg.live_active_required,
            },
        }


_engine: RecognitionEngine | None = None


def get_recognition_engine() -> RecognitionEngine:
    global _engine
    if _engine is None:
        _engine = RecognitionEngine()
    return _engine
