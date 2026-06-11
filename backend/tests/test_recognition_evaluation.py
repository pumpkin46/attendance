"""Tests for the offline recognition accuracy evaluation harness."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest

import app.services.face_service as face_service
import app.services.recognition_evaluation as evaluation
from app.engine.metrics import EngineMetricsCollector


# ── classify_outcome ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "expected,predicted,outcome",
    [
        ("7", "7", "true_accept"),
        ("7", None, "false_reject"),
        ("7", "9", "misidentified"),
        (None, "9", "false_accept"),
        (None, None, "true_reject"),
    ],
)
def test_classify_outcome(expected, predicted, outcome):
    assert evaluation.classify_outcome(expected, predicted) == outcome


# ── evaluate ─────────────────────────────────────────────────────────────────


def _fake_identify(responses: dict[str, str | None]):
    """Build an identify stub keyed by probe image content."""

    def identify(image_b64, require_liveness=True, **kwargs):
        return {
            "success": True,
            "employee_id": responses.get(image_b64),
            "confidence": 0.9,
            "processing_ms": 120,
            "recognition_ms": 90,
            "liveness_ms": 30,
        }

    return identify


def test_evaluate_perfect_run(monkeypatch):
    responses = {"img-a": "1", "img-b": "2", "img-c": None}
    monkeypatch.setattr(face_service, "identify", _fake_identify(responses))

    report = evaluation.evaluate(
        [
            {"image": "img-a", "employee_id": "1"},
            {"image": "img-b", "employee_id": "2"},
            {"image": "img-c", "employee_id": None},
        ],
        record_metrics=False,
    )

    assert report["total_samples"] == 3
    assert report["genuine_samples"] == 2
    assert report["impostor_samples"] == 1
    assert report["true_accepts"] == 2
    assert report["true_rejects"] == 1
    assert report["accuracy"] == 1.0
    assert report["false_negative_rate"] == 0.0
    assert report["avg_recognition_ms"] == 90.0
    assert report["avg_liveness_ms"] == 30.0

    by_metric = {c["metric"]: c for c in report["compliance"]}
    assert by_metric["recognition_accuracy"]["met"] is True
    assert by_metric["false_negative_rate"]["met"] is True
    assert by_metric["recognition_time_ms"]["met"] is True
    assert by_metric["liveness_verification_ms"]["met"] is True


def test_evaluate_classifies_failures(monkeypatch):
    responses = {
        "genuine-missed": None,  # false reject
        "genuine-wrong": "99",  # misidentified
        "impostor-accepted": "5",  # false accept
        "impostor-rejected": None,  # true reject
    }
    monkeypatch.setattr(face_service, "identify", _fake_identify(responses))

    report = evaluation.evaluate(
        [
            {"image": "genuine-missed", "employee_id": "1"},
            {"image": "genuine-wrong", "employee_id": "2"},
            {"image": "impostor-accepted", "employee_id": None},
            {"image": "impostor-rejected", "employee_id": None},
        ],
        record_metrics=False,
    )

    assert report["false_rejects"] == 1
    assert report["misidentified"] == 1
    assert report["false_accepts"] == 1
    assert report["true_rejects"] == 1
    assert report["accuracy"] == 0.25  # only the true reject was correct
    outcomes = [s["outcome"] for s in report["samples"]]
    assert outcomes == [
        "false_reject", "misidentified", "false_accept", "true_reject",
    ]

    by_metric = {c["metric"]: c for c in report["compliance"]}
    assert by_metric["recognition_accuracy"]["met"] is False
    assert by_metric["false_positive_rate"]["met"] is False


def test_evaluate_feeds_metrics_collector(monkeypatch):
    responses = {"img-a": "1", "img-b": "99", "img-c": None}
    monkeypatch.setattr(face_service, "identify", _fake_identify(responses))
    collector = EngineMetricsCollector()
    monkeypatch.setattr(evaluation, "get_metrics", lambda: collector)

    evaluation.evaluate(
        [
            {"image": "img-a", "employee_id": "1"},   # true accept
            {"image": "img-b", "employee_id": "2"},   # misidentified -> false accept
            {"image": "img-c", "employee_id": None},  # true reject
        ],
        record_metrics=True,
    )

    rec = collector.recognition
    assert rec.true_accepts == 1
    assert rec.false_accepts == 1
    assert rec.true_rejects == 1
    assert rec.labeled_total == 3


def test_requirements_compliance_unmeasured_is_null():
    rows = evaluation.requirements_compliance(
        accuracy=None,
        false_positive_rate=None,
        false_negative_rate=None,
        recognition_ms=None,
        liveness_ms=None,
    )
    assert len(rows) == 5
    assert all(r["measured"] is None and r["met"] is None for r in rows)
