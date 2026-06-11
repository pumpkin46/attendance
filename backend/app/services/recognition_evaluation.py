"""Offline recognition accuracy evaluation harness.

Measures the required recognition performance metrics against the live
pipeline and index using ground-truth-labeled probe images:

    Recognition Accuracy   >= settings.target_accuracy        (0.99)
    False Positive Rate    <  settings.max_false_positive_rate (0.001)
    False Negative Rate    <  settings.max_false_negative_rate (0.01)
    Recognition Time       <  settings.recognition_sla_ms      (300 ms)
    Liveness Verification  <  settings.liveness_sla_ms         (500 ms)

Each sample is {"image": <base64>, "employee_id": <expected id or None>}.
Genuine probes (expected id set) measure accuracy and false rejects; impostor
probes (expected id None, i.e. a person who is NOT enrolled) measure false
accepts. A genuine probe matched to the wrong identity is counted as
"misidentified" and treated as a false accept.

Labeled outcomes are also fed into the engine metrics collector (unless
record_metrics=False) so the live accuracy-compliance report reflects them.
"""

from __future__ import annotations

import logging
import time

from app.core.config import settings
from app.engine.metrics import get_metrics
from app.services import face_service

logger = logging.getLogger(__name__)

# Outcome labels per probe
TRUE_ACCEPT = "true_accept"
FALSE_REJECT = "false_reject"
MISIDENTIFIED = "misidentified"
FALSE_ACCEPT = "false_accept"
TRUE_REJECT = "true_reject"


def classify_outcome(expected_id: str | None, predicted_id: str | None) -> str:
    """Classify one labeled identification attempt."""
    if expected_id is not None:
        if predicted_id is None:
            return FALSE_REJECT
        if str(predicted_id) == str(expected_id):
            return TRUE_ACCEPT
        return MISIDENTIFIED
    return FALSE_ACCEPT if predicted_id is not None else TRUE_REJECT


def requirements_compliance(
    *,
    accuracy: float | None,
    false_positive_rate: float | None,
    false_negative_rate: float | None,
    recognition_ms: float | None,
    liveness_ms: float | None,
) -> list[dict]:
    """Build the required-metrics table (target vs measured vs met).

    ``met`` is None when a metric has not been measured yet.
    """

    def entry(
        metric: str,
        requirement: str,
        target: float,
        measured: float | None,
        lower_is_better: bool,
    ) -> dict:
        met: bool | None = None
        if measured is not None:
            met = measured <= target if lower_is_better else measured >= target
        return {
            "metric": metric,
            "requirement": requirement,
            "target": target,
            "measured": round(measured, 6) if measured is not None else None,
            "met": met,
        }

    return [
        entry(
            "recognition_accuracy", ">= 99%",
            settings.target_accuracy, accuracy, lower_is_better=False,
        ),
        entry(
            "false_positive_rate", "< 0.1%",
            settings.max_false_positive_rate, false_positive_rate, lower_is_better=True,
        ),
        entry(
            "false_negative_rate", "< 1%",
            settings.max_false_negative_rate, false_negative_rate, lower_is_better=True,
        ),
        entry(
            "recognition_time_ms", "< 300ms",
            float(settings.recognition_sla_ms), recognition_ms, lower_is_better=True,
        ),
        entry(
            "liveness_verification_ms", "< 500ms",
            float(settings.liveness_sla_ms), liveness_ms, lower_is_better=True,
        ),
    ]


def evaluate(
    samples: list[dict],
    *,
    require_liveness: bool = False,
    record_metrics: bool = True,
) -> dict:
    """Run labeled probes through the identify pipeline and score the results."""
    start = time.perf_counter()

    counts = {
        TRUE_ACCEPT: 0,
        FALSE_REJECT: 0,
        MISIDENTIFIED: 0,
        FALSE_ACCEPT: 0,
        TRUE_REJECT: 0,
    }
    per_sample: list[dict] = []
    processing_times: list[int] = []
    recognition_times: list[int] = []
    liveness_times: list[int] = []
    collector = get_metrics() if record_metrics else None

    for i, sample in enumerate(samples):
        expected_id = sample.get("employee_id")
        expected_id = str(expected_id) if expected_id is not None else None

        result = face_service.identify(
            sample["image"], require_liveness=require_liveness
        )
        predicted_id = result.get("employee_id")
        predicted_id = str(predicted_id) if predicted_id is not None else None

        outcome = classify_outcome(expected_id, predicted_id)
        counts[outcome] += 1

        if collector is not None:
            # Misidentification is an acceptance of the wrong identity.
            label = FALSE_ACCEPT if outcome == MISIDENTIFIED else outcome
            collector.record_match_outcome(label)

        if result.get("processing_ms") is not None:
            processing_times.append(int(result["processing_ms"]))
        if result.get("recognition_ms") is not None:
            recognition_times.append(int(result["recognition_ms"]))
        if result.get("liveness_ms") is not None:
            liveness_times.append(int(result["liveness_ms"]))

        per_sample.append({
            "index": i,
            "expected_employee_id": expected_id,
            "predicted_employee_id": predicted_id,
            "confidence": result.get("confidence"),
            "outcome": outcome,
            "reason": result.get("reason"),
            "processing_ms": result.get("processing_ms"),
        })

    total = len(samples)
    genuine = counts[TRUE_ACCEPT] + counts[FALSE_REJECT] + counts[MISIDENTIFIED]
    impostor = counts[FALSE_ACCEPT] + counts[TRUE_REJECT]
    wrong_accepts = counts[FALSE_ACCEPT] + counts[MISIDENTIFIED]

    accuracy = (
        (counts[TRUE_ACCEPT] + counts[TRUE_REJECT]) / total if total else None
    )
    # FPR: wrong accepts over attempts that should not have produced that
    # identity (impostor probes + misidentified genuine probes).
    fpr_denominator = impostor + counts[MISIDENTIFIED]
    false_positive_rate = (
        wrong_accepts / fpr_denominator if fpr_denominator else None
    )
    false_negative_rate = counts[FALSE_REJECT] / genuine if genuine else None

    avg_recognition_ms = (
        sum(recognition_times) / len(recognition_times) if recognition_times else None
    )
    avg_liveness_ms = (
        sum(liveness_times) / len(liveness_times) if liveness_times else None
    )

    return {
        "total_samples": total,
        "genuine_samples": genuine,
        "impostor_samples": impostor,
        "true_accepts": counts[TRUE_ACCEPT],
        "false_rejects": counts[FALSE_REJECT],
        "misidentified": counts[MISIDENTIFIED],
        "false_accepts": counts[FALSE_ACCEPT],
        "true_rejects": counts[TRUE_REJECT],
        "accuracy": round(accuracy, 6) if accuracy is not None else None,
        "false_positive_rate": (
            round(false_positive_rate, 6) if false_positive_rate is not None else None
        ),
        "false_negative_rate": (
            round(false_negative_rate, 6) if false_negative_rate is not None else None
        ),
        "avg_processing_ms": (
            round(sum(processing_times) / len(processing_times), 1)
            if processing_times else None
        ),
        "max_processing_ms": max(processing_times) if processing_times else None,
        "avg_recognition_ms": (
            round(avg_recognition_ms, 1) if avg_recognition_ms is not None else None
        ),
        "avg_liveness_ms": (
            round(avg_liveness_ms, 1) if avg_liveness_ms is not None else None
        ),
        "compliance": requirements_compliance(
            accuracy=accuracy,
            false_positive_rate=false_positive_rate,
            false_negative_rate=false_negative_rate,
            recognition_ms=avg_recognition_ms,
            liveness_ms=avg_liveness_ms,
        ),
        "samples": per_sample,
        "evaluation_ms": int((time.perf_counter() - start) * 1000),
    }
