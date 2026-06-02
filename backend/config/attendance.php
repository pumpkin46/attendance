<?php

return [
    'duplicate_window_seconds' => (int) env('FACE_DUPLICATE_WINDOW_SECONDS', 60),
    'overtime_threshold_minutes' => (int) env('ATTENDANCE_OVERTIME_THRESHOLD_MINUTES', 480),
    'default_grace_minutes' => 15,
    'unknown_person_alert' => filter_var(env('UNKNOWN_PERSON_ALERT', true), FILTER_VALIDATE_BOOL),
    'unknown_snapshot_enabled' => filter_var(env('UNKNOWN_SNAPSHOT_ENABLED', true), FILTER_VALIDATE_BOOL),
    'unknown_notify_admins' => filter_var(env('UNKNOWN_NOTIFY_ADMINS', true), FILTER_VALIDATE_BOOL),
    'unknown_alert_cooldown_seconds' => (int) env('UNKNOWN_ALERT_COOLDOWN_SECONDS', 300),
    'unknown_snapshot_retention_days' => (int) env('UNKNOWN_SNAPSHOT_RETENTION_DAYS', 30),
    'camera_stream_poll_interval_seconds' => (int) env('CAMERA_STREAM_POLL_INTERVAL_SECONDS', 5),
];
