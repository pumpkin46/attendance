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
