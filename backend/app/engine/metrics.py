"""
Monitoring & Observability — Engine performance metrics.

Tracks:
- Detected/Recognized/Unknown faces
- Recognition accuracy, false positives/negatives
- GPU/CPU/Memory usage
- Camera status, FPS, stream latency
- Pipeline stage timings

Alerts:
- Camera offline
- Recognition failure
- High GPU/CPU usage
- High latency
- Model failure
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class AlertSeverity(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertType(Enum):
    CAMERA_OFFLINE = "camera_offline"
    RECOGNITION_FAILURE = "recognition_failure"
    HIGH_GPU_USAGE = "high_gpu_usage"
    HIGH_CPU_USAGE = "high_cpu_usage"
    HIGH_LATENCY = "high_latency"
    MODEL_FAILURE = "model_failure"
    STREAM_DEGRADED = "stream_degraded"
    UNKNOWN_PERSON_SPIKE = "unknown_person_spike"


@dataclass
class EngineAlert:
    alert_type: AlertType
    severity: AlertSeverity
    message: str
    timestamp: datetime
    camera_id: int | None = None
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "alert_type": self.alert_type.value,
            "severity": self.severity.value,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "camera_id": self.camera_id,
            "meta": self.meta,
        }


@dataclass
class PipelineMetrics:
    stage: str
    duration_ms: int
    success: bool
    timestamp: float = field(default_factory=time.time)


@dataclass
class RecognitionMetrics:
    total_detections: int = 0
    total_recognized: int = 0
    total_unknown: int = 0
    total_liveness_passed: int = 0
    total_liveness_failed: int = 0
    total_quality_rejected: int = 0
    total_attendance_events: int = 0
    total_duplicates_prevented: int = 0
    # Ground-truth-labeled outcomes (from review feedback or offline
    # evaluation runs) — the only way accuracy/FPR/FNR can be measured.
    true_accepts: int = 0
    false_accepts: int = 0
    false_rejects: int = 0
    true_rejects: int = 0

    @property
    def recognition_rate(self) -> float:
        if self.total_detections == 0:
            return 0.0
        return self.total_recognized / self.total_detections

    @property
    def unknown_rate(self) -> float:
        if self.total_detections == 0:
            return 0.0
        return self.total_unknown / self.total_detections

    @property
    def labeled_total(self) -> int:
        return (
            self.true_accepts
            + self.false_accepts
            + self.false_rejects
            + self.true_rejects
        )

    @property
    def measured_accuracy(self) -> float | None:
        """Correct decisions over all labeled attempts; None until labeled."""
        total = self.labeled_total
        if total == 0:
            return None
        return (self.true_accepts + self.true_rejects) / total

    @property
    def false_positive_rate(self) -> float | None:
        """False accepts over attempts that should have been rejected."""
        impostor_attempts = self.false_accepts + self.true_rejects
        if impostor_attempts == 0:
            return None
        return self.false_accepts / impostor_attempts

    @property
    def false_negative_rate(self) -> float | None:
        """False rejects over attempts that should have been accepted."""
        genuine_attempts = self.false_rejects + self.true_accepts
        if genuine_attempts == 0:
            return None
        return self.false_rejects / genuine_attempts

    def to_dict(self) -> dict:
        accuracy = self.measured_accuracy
        fpr = self.false_positive_rate
        fnr = self.false_negative_rate
        return {
            "total_detections": self.total_detections,
            "total_recognized": self.total_recognized,
            "total_unknown": self.total_unknown,
            "total_liveness_passed": self.total_liveness_passed,
            "total_liveness_failed": self.total_liveness_failed,
            "total_quality_rejected": self.total_quality_rejected,
            "total_attendance_events": self.total_attendance_events,
            "total_duplicates_prevented": self.total_duplicates_prevented,
            "recognition_rate": round(self.recognition_rate, 4),
            "unknown_rate": round(self.unknown_rate, 4),
            "true_accepts": self.true_accepts,
            "false_accepts": self.false_accepts,
            "false_rejects": self.false_rejects,
            "true_rejects": self.true_rejects,
            "labeled_total": self.labeled_total,
            "measured_accuracy": round(accuracy, 4) if accuracy is not None else None,
            "false_positive_rate": round(fpr, 4) if fpr is not None else None,
            "false_negative_rate": round(fnr, 4) if fnr is not None else None,
        }


# Valid ground-truth labels for record_match_outcome()
MATCH_OUTCOMES = ("true_accept", "false_accept", "false_reject", "true_reject")


class EngineMetricsCollector:
    """Centralized metrics collector for the recognition engine."""

    def __init__(self, history_size: int = 10000) -> None:
        self._recognition = RecognitionMetrics()
        self._pipeline_history: deque[PipelineMetrics] = deque(maxlen=history_size)
        self._alerts: deque[EngineAlert] = deque(maxlen=1000)
        self._alert_callbacks: list[Any] = []
        self._camera_fps: dict[int, float] = {}
        self._camera_latency: dict[int, int] = {}
        self._stage_timings: dict[str, deque] = {}
        self._started_at = datetime.now(timezone.utc)

    @property
    def recognition(self) -> RecognitionMetrics:
        return self._recognition

    def register_alert_callback(self, callback) -> None:
        self._alert_callbacks.append(callback)

    def record_detection(self, face_count: int) -> None:
        self._recognition.total_detections += face_count

    def record_recognition(self, matched: bool) -> None:
        if matched:
            self._recognition.total_recognized += 1
        else:
            self._recognition.total_unknown += 1

    def record_liveness(self, passed: bool) -> None:
        if passed:
            self._recognition.total_liveness_passed += 1
        else:
            self._recognition.total_liveness_failed += 1

    def record_quality_rejected(self) -> None:
        self._recognition.total_quality_rejected += 1

    def record_attendance_event(self) -> None:
        self._recognition.total_attendance_events += 1

    def record_duplicate_prevented(self) -> None:
        self._recognition.total_duplicates_prevented += 1

    def record_match_outcome(self, outcome: str) -> None:
        """Record a ground-truth-labeled match outcome.

        Fed by review feedback on recognition events and by offline evaluation
        runs; these labeled outcomes are what measured accuracy / false
        positive rate / false negative rate are computed from.
        """
        if outcome == "true_accept":
            self._recognition.true_accepts += 1
        elif outcome == "false_accept":
            self._recognition.false_accepts += 1
        elif outcome == "false_reject":
            self._recognition.false_rejects += 1
        elif outcome == "true_reject":
            self._recognition.true_rejects += 1
        else:
            raise ValueError(
                f"Unknown match outcome {outcome!r}; expected one of {MATCH_OUTCOMES}"
            )

    def record_pipeline_stage(self, stage: str, duration_ms: int, success: bool = True) -> None:
        metric = PipelineMetrics(stage=stage, duration_ms=duration_ms, success=success)
        self._pipeline_history.append(metric)

        if stage not in self._stage_timings:
            self._stage_timings[stage] = deque(maxlen=1000)
        self._stage_timings[stage].append(duration_ms)

    def record_camera_health(self, camera_id: int, fps: float, latency_ms: int) -> None:
        self._camera_fps[camera_id] = fps
        self._camera_latency[camera_id] = latency_ms

        if latency_ms > 500:
            self._emit_alert(
                AlertType.HIGH_LATENCY,
                AlertSeverity.WARNING,
                f"Camera {camera_id} latency: {latency_ms}ms",
                camera_id=camera_id,
            )

    def record_camera_offline(self, camera_id: int) -> None:
        self._emit_alert(
            AlertType.CAMERA_OFFLINE,
            AlertSeverity.CRITICAL,
            f"Camera {camera_id} is offline",
            camera_id=camera_id,
        )

    def get_stage_averages(self) -> dict[str, float]:
        averages = {}
        for stage, timings in self._stage_timings.items():
            if timings:
                averages[stage] = sum(timings) / len(timings)
        return averages

    def get_performance_summary(self) -> dict:
        stage_avgs = self.get_stage_averages()
        total_pipeline_ms = sum(stage_avgs.values())

        return {
            "uptime_seconds": (datetime.now(timezone.utc) - self._started_at).total_seconds(),
            "recognition_metrics": self._recognition.to_dict(),
            "pipeline_performance": {
                "stage_averages_ms": {k: round(v, 1) for k, v in stage_avgs.items()},
                "total_pipeline_avg_ms": round(total_pipeline_ms, 1),
            },
            "camera_health": {
                "cameras_reporting": len(self._camera_fps),
                "avg_fps": round(
                    sum(self._camera_fps.values()) / max(len(self._camera_fps), 1), 2
                ),
                "avg_latency_ms": round(
                    sum(self._camera_latency.values()) / max(len(self._camera_latency), 1), 1
                ),
            },
            "alerts": {
                "total": len(self._alerts),
                "recent": [a.to_dict() for a in list(self._alerts)[-10:]],
            },
            "accuracy_compliance": self.get_accuracy_compliance(),
        }

    def get_accuracy_compliance(self) -> dict:
        """Measured accuracy/FPR/FNR vs the required performance targets.

        ``met`` is None for a metric until at least one labeled outcome of the
        relevant kind exists (targets cannot be verified without ground truth).
        """
        from app.engine.config import engine_config
        perf = engine_config.performance
        rec = self._recognition

        def _entry(target: float, measured: float | None, lower_is_better: bool) -> dict:
            met: bool | None = None
            if measured is not None:
                met = measured <= target if lower_is_better else measured >= target
            return {
                "target": target,
                "measured": round(measured, 6) if measured is not None else None,
                "met": met,
            }

        return {
            "labeled_samples": rec.labeled_total,
            "recognition_accuracy": _entry(
                perf.target_accuracy, rec.measured_accuracy, lower_is_better=False
            ),
            "false_positive_rate": _entry(
                perf.max_false_positive_rate, rec.false_positive_rate, lower_is_better=True
            ),
            "false_negative_rate": _entry(
                perf.max_false_negative_rate, rec.false_negative_rate, lower_is_better=True
            ),
        }

    def get_sla_compliance(self) -> dict:
        from app.engine.config import engine_config
        perf = engine_config.performance
        avgs = self.get_stage_averages()
        # Recognition time excludes the liveness stage — it has its own SLA
        # (mirrors the per-result calculation in RecognitionEngine).
        recognition_ms = sum(
            v for k, v in avgs.items() if k != "liveness_detection"
        )

        return {
            "face_detection": {
                "target_ms": perf.max_detection_ms,
                "actual_ms": round(avgs.get("face_detection", 0), 1),
                "met": avgs.get("face_detection", 0) <= perf.max_detection_ms,
            },
            "embedding_generation": {
                "target_ms": perf.max_embedding_ms,
                "actual_ms": round(avgs.get("embedding_generation", 0), 1),
                "met": avgs.get("embedding_generation", 0) <= perf.max_embedding_ms,
            },
            "vector_search": {
                "target_ms": perf.max_search_ms,
                "actual_ms": round(avgs.get("vector_search", 0), 1),
                "met": avgs.get("vector_search", 0) <= perf.max_search_ms,
            },
            "total_recognition": {
                "target_ms": perf.max_recognition_ms,
                "actual_ms": round(recognition_ms, 1),
                "met": recognition_ms <= perf.max_recognition_ms,
            },
            "liveness_verification": {
                "target_ms": perf.max_liveness_ms,
                "actual_ms": round(avgs.get("liveness_detection", 0), 1),
                "met": avgs.get("liveness_detection", 0) <= perf.max_liveness_ms,
            },
        }

    def _emit_alert(
        self,
        alert_type: AlertType,
        severity: AlertSeverity,
        message: str,
        camera_id: int | None = None,
        meta: dict | None = None,
    ) -> None:
        alert = EngineAlert(
            alert_type=alert_type,
            severity=severity,
            message=message,
            timestamp=datetime.now(timezone.utc),
            camera_id=camera_id,
            meta=meta or {},
        )
        self._alerts.append(alert)
        logger.warning("Engine alert: [%s] %s", severity.value, message)

        for callback in self._alert_callbacks:
            try:
                callback(alert)
            except Exception as e:
                logger.error("Alert callback failed: %s", e)


_metrics: EngineMetricsCollector | None = None


def get_metrics() -> EngineMetricsCollector:
    global _metrics
    if _metrics is None:
        _metrics = EngineMetricsCollector()
    return _metrics
