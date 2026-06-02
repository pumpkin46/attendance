<?php

return [
    'duplicate_window_seconds' => (int) env('FACE_DUPLICATE_WINDOW_SECONDS', 60),
    'rfid_duplicate_window_seconds' => (int) env('RFID_DUPLICATE_WINDOW_SECONDS', 60),
    'rfid_reader_offline_seconds' => (int) env('RFID_READER_OFFLINE_SECONDS', 300),
    'edge_offline_seconds' => (int) env('EDGE_DEVICE_OFFLINE_SECONDS', 300),
    'edge_sync_interval_seconds' => (int) env('EDGE_SYNC_INTERVAL_SECONDS', 300),
    'anomaly_detection_enabled' => filter_var(env('ANOMALY_DETECTION_ENABLED', true), FILTER_VALIDATE_BOOL),
    'anomaly_lookback_days' => (int) env('ANOMALY_LOOKBACK_DAYS', 30),
    'anomaly_overtime_minutes' => (int) env('ANOMALY_OVERTIME_MINUTES', 600),
    'anomaly_check_in_deviation_minutes' => (int) env('ANOMALY_CHECKIN_DEVIATION_MINUTES', 120),
    'anomaly_ml_min_samples' => (int) env('ANOMALY_ML_MIN_SAMPLES', 15),
    'anomaly_ml_contamination' => (float) env('ANOMALY_ML_CONTAMINATION', 0.08),
    'overtime_threshold_minutes' => (int) env('ATTENDANCE_OVERTIME_THRESHOLD_MINUTES', 480),
    'default_grace_minutes' => 15,
    'unknown_person_alert' => filter_var(env('UNKNOWN_PERSON_ALERT', true), FILTER_VALIDATE_BOOL),
    'unknown_snapshot_enabled' => filter_var(env('UNKNOWN_SNAPSHOT_ENABLED', true), FILTER_VALIDATE_BOOL),
    'unknown_notify_admins' => filter_var(env('UNKNOWN_NOTIFY_ADMINS', true), FILTER_VALIDATE_BOOL),
    'unknown_alert_cooldown_seconds' => (int) env('UNKNOWN_ALERT_COOLDOWN_SECONDS', 300),
    'unknown_snapshot_retention_days' => (int) env('UNKNOWN_SNAPSHOT_RETENTION_DAYS', 30),
    'camera_stream_poll_interval_seconds' => (int) env('CAMERA_STREAM_POLL_INTERVAL_SECONDS', 5),
];
