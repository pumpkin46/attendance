"""Unit tests for the rule + Isolation Forest attendance anomaly detector."""

from __future__ import annotations

from app.services.anomaly_detector import analyze_records


def _record(**overrides) -> dict:
    """A clean weekday record that triggers no rules."""
    base = {
        "record_id": 1,
        "employee_id": 10,
        "work_date": "2026-06-01",
        "check_in_at": "2026-06-01 09:00:00",
        "check_out_at": "2026-06-01 17:30:00",
        "check_in_hour": 9.0,
        "shift_start_hour": 9.0,
        "worked_minutes": 480,
        "overtime_minutes": 0,
        "status": "present",
        "check_in_method": "face",
        "day_of_week": 1,
        "recognition_events_count": 0,
    }
    base.update(overrides)
    return base


def _types(result: dict) -> set[str]:
    return {a["anomaly_type"] for a in result["anomalies"]}


def test_empty_input():
    result = analyze_records([])
    assert result["anomalies"] == []
    assert result["records_analyzed"] == 0
    assert result["anomaly_count"] == 0


def test_clean_record_has_no_anomalies():
    result = analyze_records([_record()])
    assert result["anomalies"] == []
    assert result["records_analyzed"] == 1


def test_missing_check_out():
    result = analyze_records([_record(check_out_at=None)])
    assert "missing_check_out" in _types(result)
    item = result["anomalies"][0]
    assert item["employee_id"] == 10
    assert item["record_id"] == 1
    assert item["severity"] == "high"  # base medium escalated by score 0.9


def test_excessive_overtime_uses_config_threshold():
    record = _record(overtime_minutes=400)
    assert "excessive_overtime" not in _types(analyze_records([record]))

    config = {"overtime_threshold_minutes": 300}
    result = analyze_records([record], config)
    assert "excessive_overtime" in _types(result)


def test_unusual_check_in_time_deviation():
    # 3h after shift start with a 2h allowed deviation.
    result = analyze_records([_record(check_in_hour=12.0, shift_start_hour=9.0)])
    assert "unusual_check_in_time" in _types(result)

    # Within the allowed deviation: no anomaly.
    result = analyze_records([_record(check_in_hour=10.0, shift_start_hour=9.0)])
    assert "unusual_check_in_time" not in _types(result)


def test_weekend_work_flagged_unless_on_leave():
    assert "weekend_work" in _types(analyze_records([_record(day_of_week=6)]))
    assert "weekend_work" not in _types(
        analyze_records([_record(day_of_week=6, status="on_leave")])
    )


def test_short_work_day_requires_both_punches():
    assert "short_work_day" in _types(analyze_records([_record(worked_minutes=30)]))
    assert "short_work_day" not in _types(
        analyze_records([_record(worked_minutes=30, check_out_at=None)])
    )


def test_rapid_recheck_threshold():
    assert "rapid_recheck" not in _types(
        analyze_records([_record(recognition_events_count=4)])
    )
    result = analyze_records([_record(recognition_events_count=8)])
    assert "rapid_recheck" in _types(result)
    item = next(a for a in result["anomalies"] if a["anomaly_type"] == "rapid_recheck")
    assert item["score"] == 0.8


def test_absence_pattern_needs_five_days_and_60_percent():
    absent = [_record(record_id=i, work_date=f"2026-06-0{i}", status="absent",
                      check_in_at=None, check_out_at=None) for i in range(1, 5)]
    # Only 4 days: below the minimum window.
    assert "absence_pattern" not in _types(analyze_records(absent))

    absent.append(_record(record_id=5, work_date="2026-06-05", status="absent",
                          check_in_at=None, check_out_at=None))
    result = analyze_records(absent)
    assert "absence_pattern" in _types(result)
    item = next(a for a in result["anomalies"] if a["anomaly_type"] == "absence_pattern")
    assert item["record_id"] is None
    assert item["score"] == 1.0
    assert item["severity"] == "critical"  # high base escalated at score >= 0.85


def test_statistical_outlier_requires_min_samples():
    # 14 normal records: below the default 15-sample minimum, ML pass skipped.
    records = [_record(record_id=i, employee_id=i) for i in range(14)]
    assert "statistical_outlier" not in _types(analyze_records(records))

    # 30 tightly clustered records plus one extreme outlier.
    records = [_record(record_id=i, employee_id=i) for i in range(30)]
    records.append(
        _record(
            record_id=99,
            employee_id=99,
            check_in_hour=3.0,
            worked_minutes=1100,
            overtime_minutes=600,
            check_in_method=None,
            day_of_week=7,
        )
    )
    result = analyze_records(records)
    outliers = [a for a in result["anomalies"] if a["anomaly_type"] == "statistical_outlier"]
    assert any(a["record_id"] == 99 for a in outliers)
    for a in outliers:
        assert 0.0 <= a["score"] <= 1.0


def test_every_anomaly_carries_severity_and_evidence():
    result = analyze_records(
        [_record(check_out_at=None, day_of_week=7, recognition_events_count=9)]
    )
    assert result["anomaly_count"] == len(result["anomalies"]) >= 3
    for a in result["anomalies"]:
        assert a["severity"] in ("low", "medium", "high", "critical")
        assert isinstance(a["evidence"], dict)
