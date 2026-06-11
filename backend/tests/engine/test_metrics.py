"""Tests for engine metrics collector."""

from app.engine.metrics import AlertSeverity, AlertType, EngineMetricsCollector


def test_record_recognition_metrics():
    metrics = EngineMetricsCollector()

    metrics.record_detection(3)
    metrics.record_recognition(True)
    metrics.record_recognition(False)
    metrics.record_liveness(True)
    metrics.record_quality_rejected()
    metrics.record_attendance_event()

    data = metrics.recognition.to_dict()
    assert data["total_detections"] == 3
    assert data["total_recognized"] == 1
    assert data["total_unknown"] == 1
    assert data["total_liveness_passed"] == 1
    assert data["total_quality_rejected"] == 1
    assert data["total_attendance_events"] == 1


def test_stage_averages():
    metrics = EngineMetricsCollector()
    metrics.record_pipeline_stage("face_detection", 40)
    metrics.record_pipeline_stage("face_detection", 60)
    metrics.record_pipeline_stage("vector_search", 10)

    averages = metrics.get_stage_averages()
    assert averages["face_detection"] == 50.0
    assert averages["vector_search"] == 10.0


def test_sla_compliance():
    metrics = EngineMetricsCollector()
    metrics.record_pipeline_stage("face_detection", 50)
    metrics.record_pipeline_stage("embedding_generation", 20)
    metrics.record_pipeline_stage("vector_search", 10)
    metrics.record_pipeline_stage("liveness_detection", 100)

    sla = metrics.get_sla_compliance()
    assert sla["face_detection"]["met"] is True
    assert sla["vector_search"]["met"] is True
    assert sla["liveness_verification"]["met"] is True


def test_high_latency_alert():
    metrics = EngineMetricsCollector()
    alerts = []

    metrics.register_alert_callback(lambda alert: alerts.append(alert))
    metrics.record_camera_health(camera_id=7, fps=25.0, latency_ms=800)

    assert len(alerts) == 1
    assert alerts[0].alert_type == AlertType.HIGH_LATENCY
    assert alerts[0].severity == AlertSeverity.WARNING
    assert alerts[0].camera_id == 7


def test_performance_summary_structure():
    metrics = EngineMetricsCollector()
    metrics.record_detection(1)
    metrics.record_camera_health(camera_id=1, fps=20.0, latency_ms=100)

    summary = metrics.get_performance_summary()
    assert "recognition_metrics" in summary
    assert "pipeline_performance" in summary
    assert "camera_health" in summary
    assert "alerts" in summary
    assert "accuracy_compliance" in summary


def test_accuracy_metrics_none_without_ground_truth():
    metrics = EngineMetricsCollector()
    rec = metrics.recognition

    assert rec.measured_accuracy is None
    assert rec.false_positive_rate is None
    assert rec.false_negative_rate is None

    compliance = metrics.get_accuracy_compliance()
    assert compliance["labeled_samples"] == 0
    assert compliance["recognition_accuracy"]["met"] is None
    assert compliance["false_positive_rate"]["met"] is None
    assert compliance["false_negative_rate"]["met"] is None


def test_record_match_outcomes_compute_rates():
    metrics = EngineMetricsCollector()
    for _ in range(98):
        metrics.record_match_outcome("true_accept")
    metrics.record_match_outcome("false_reject")
    metrics.record_match_outcome("false_accept")
    for _ in range(100):
        metrics.record_match_outcome("true_reject")

    rec = metrics.recognition
    assert rec.labeled_total == 200
    assert rec.measured_accuracy == (98 + 100) / 200
    assert rec.false_positive_rate == 1 / 101  # FA / (FA + TR)
    assert rec.false_negative_rate == 1 / 99  # FR / (FR + TA)

    data = rec.to_dict()
    assert data["true_accepts"] == 98
    assert data["labeled_total"] == 200
    assert data["measured_accuracy"] == round(198 / 200, 4)


def test_record_match_outcome_rejects_unknown_label():
    metrics = EngineMetricsCollector()
    import pytest

    with pytest.raises(ValueError):
        metrics.record_match_outcome("maybe")


def test_accuracy_compliance_targets():
    metrics = EngineMetricsCollector()
    # 100% accuracy, zero FPR/FNR -> all requirements met
    for _ in range(50):
        metrics.record_match_outcome("true_accept")
    for _ in range(50):
        metrics.record_match_outcome("true_reject")

    compliance = metrics.get_accuracy_compliance()
    assert compliance["recognition_accuracy"]["met"] is True
    assert compliance["false_positive_rate"]["met"] is True
    assert compliance["false_negative_rate"]["met"] is True


def test_sla_total_recognition_excludes_liveness():
    metrics = EngineMetricsCollector()
    metrics.record_pipeline_stage("face_detection", 100)
    metrics.record_pipeline_stage("embedding_generation", 50)
    metrics.record_pipeline_stage("vector_search", 20)
    metrics.record_pipeline_stage("liveness_detection", 400)

    sla = metrics.get_sla_compliance()
    # 170ms of recognition work; the 400ms liveness stage has its own SLA
    assert sla["total_recognition"]["actual_ms"] == 170.0
    assert sla["total_recognition"]["met"] is True
    assert sla["liveness_verification"]["actual_ms"] == 400.0
