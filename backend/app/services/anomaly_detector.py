"""AI-powered attendance anomaly detection (rules + Isolation Forest)."""

from __future__ import annotations

import time
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest

METHOD_MAP = {"face": 0, "rfid": 1, "manual": 2, None: -1}
SEVERITY_BY_TYPE = {
    "missing_check_out": "medium",
    "excessive_overtime": "high",
    "unusual_check_in_time": "medium",
    "weekend_work": "low",
    "short_work_day": "medium",
    "rapid_recheck": "high",
    "statistical_outlier": "medium",
    "absence_pattern": "high",
}


def _severity(anomaly_type: str, score: float) -> str:
    base = SEVERITY_BY_TYPE.get(anomaly_type, "medium")
    if score >= 0.85 and base != "low":
        return "critical" if base == "high" else "high"
    return base


def _rule_anomalies(record: dict, config: dict) -> list[dict]:
    found: list[dict] = []
    record_id = record.get("record_id")
    employee_id = record.get("employee_id")

    if record.get("check_in_at") and not record.get("check_out_at"):
        found.append(
            {
                "record_id": record_id,
                "employee_id": employee_id,
                "anomaly_type": "missing_check_out",
                "score": 0.9,
                "title": "Missing check-out",
                "description": "Employee checked in but has no check-out recorded for this day.",
                "evidence": {"work_date": record.get("work_date")},
            }
        )

    overtime = int(record.get("overtime_minutes") or 0)
    overtime_threshold = int(config.get("overtime_threshold_minutes", 600))
    if overtime >= overtime_threshold:
        found.append(
            {
                "record_id": record_id,
                "employee_id": employee_id,
                "anomaly_type": "excessive_overtime",
                "score": min(1.0, overtime / max(overtime_threshold, 1)),
                "title": "Excessive overtime",
                "description": f"Overtime of {overtime} minutes exceeds threshold ({overtime_threshold} min).",
                "evidence": {"overtime_minutes": overtime, "threshold": overtime_threshold},
            }
        )

    check_in_hour = record.get("check_in_hour")
    shift_start = record.get("shift_start_hour")
    deviation_limit = int(config.get("check_in_deviation_minutes", 120)) / 60
    if check_in_hour is not None and shift_start is not None:
        diff = abs(float(check_in_hour) - float(shift_start))
        if diff > deviation_limit:
            found.append(
                {
                    "record_id": record_id,
                    "employee_id": employee_id,
                    "anomaly_type": "unusual_check_in_time",
                    "score": min(1.0, diff / 4),
                    "title": "Unusual check-in time",
                    "description": (
                        f"Check-in at hour {check_in_hour:.1f} deviates "
                        f"{diff * 60:.0f} min from shift start ({shift_start:.1f})."
                    ),
                    "evidence": {
                        "check_in_hour": check_in_hour,
                        "shift_start_hour": shift_start,
                        "deviation_minutes": round(diff * 60),
                    },
                }
            )

    day_of_week = int(record.get("day_of_week") or 0)
    status = record.get("status")
    if day_of_week in (6, 7) and status not in ("on_leave", "holiday") and record.get("check_in_at"):
        found.append(
            {
                "record_id": record_id,
                "employee_id": employee_id,
                "anomaly_type": "weekend_work",
                "score": 0.7,
                "title": "Weekend check-in",
                "description": "Attendance recorded on a weekend without leave/holiday status.",
                "evidence": {"day_of_week": day_of_week, "status": status},
            }
        )

    worked = int(record.get("worked_minutes") or 0)
    if record.get("check_in_at") and record.get("check_out_at") and worked < 60:
        found.append(
            {
                "record_id": record_id,
                "employee_id": employee_id,
                "anomaly_type": "short_work_day",
                "score": 0.75,
                "title": "Unusually short work day",
                "description": f"Only {worked} minutes worked between check-in and check-out.",
                "evidence": {"worked_minutes": worked},
            }
        )

    rec_count = int(record.get("recognition_events_count") or 0)
    if rec_count >= 5:
        found.append(
            {
                "record_id": record_id,
                "employee_id": employee_id,
                "anomaly_type": "rapid_recheck",
                "score": min(1.0, rec_count / 10),
                "title": "High recognition frequency",
                "description": f"{rec_count} recognition events on this day — possible buddy punching or gate looping.",
                "evidence": {"recognition_events_count": rec_count},
            }
        )

    return found


def _feature_matrix(records: list[dict]) -> np.ndarray:
    rows = []
    for r in records:
        rows.append(
            [
                float(r.get("check_in_hour") or 12),
                float(r.get("worked_minutes") or 0) / 480,
                float(r.get("overtime_minutes") or 0) / 120,
                1.0 if r.get("status") == "late" else 0.0,
                float(r.get("day_of_week") or 3) / 7,
                float(METHOD_MAP.get(r.get("check_in_method"), -1) + 1) / 3,
            ]
        )
    return np.array(rows, dtype=np.float32)


def analyze_records(records: list[dict], config: dict | None = None) -> dict[str, Any]:
    start = time.perf_counter()
    config = config or {}
    anomalies: list[dict] = []

    for record in records:
        for item in _rule_anomalies(record, config):
            item["severity"] = _severity(item["anomaly_type"], float(item["score"]))
            anomalies.append(item)

    min_samples = int(config.get("ml_min_samples", 15))
    if len(records) >= min_samples:
        X = _feature_matrix(records)
        contamination = float(config.get("ml_contamination", 0.08))
        model = IsolationForest(
            n_estimators=100,
            contamination=min(contamination, 0.25),
            random_state=42,
        )
        predictions = model.fit_predict(X)
        scores = model.decision_function(X)

        for idx, (pred, score) in enumerate(zip(predictions, scores)):
            if pred != -1:
                continue
            record = records[idx]
            anomaly_score = float(min(1.0, max(0.0, -score)))
            anomalies.append(
                {
                    "record_id": record.get("record_id"),
                    "employee_id": record.get("employee_id"),
                    "anomaly_type": "statistical_outlier",
                    "score": round(anomaly_score, 4),
                    "severity": _severity("statistical_outlier", anomaly_score),
                    "title": "Statistical attendance outlier",
                    "description": "ML model flagged this record as an outlier vs peer attendance patterns.",
                    "evidence": {
                        "isolation_score": round(float(score), 4),
                        "features": {
                            "check_in_hour": record.get("check_in_hour"),
                            "worked_minutes": record.get("worked_minutes"),
                            "overtime_minutes": record.get("overtime_minutes"),
                        },
                    },
                }
            )

    employee_absences: dict[int, list[str]] = {}
    for record in records:
        emp = record.get("employee_id")
        if emp is None:
            continue
        employee_absences.setdefault(int(emp), []).append(record.get("status", ""))

    for employee_id, statuses in employee_absences.items():
        if len(statuses) < 5:
            continue
        absent_rate = statuses.count("absent") / len(statuses)
        if absent_rate >= 0.6:
            anomalies.append(
                {
                    "record_id": None,
                    "employee_id": employee_id,
                    "anomaly_type": "absence_pattern",
                    "score": round(absent_rate, 4),
                    "severity": _severity("absence_pattern", absent_rate),
                    "title": "Elevated absence pattern",
                    "description": f"Employee absent on {absent_rate * 100:.0f}% of days in analysis window.",
                    "evidence": {"absent_rate": round(absent_rate, 4), "days_analyzed": len(statuses)},
                }
            )

    processing_ms = int((time.perf_counter() - start) * 1000)

    return {
        "success": True,
        "anomalies": anomalies,
        "records_analyzed": len(records),
        "anomaly_count": len(anomalies),
        "processing_ms": processing_ms,
    }
