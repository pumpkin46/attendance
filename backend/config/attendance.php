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
    'weekend_days' => [0, 6],
    'unknown_person_alert' => filter_var(env('UNKNOWN_PERSON_ALERT', true), FILTER_VALIDATE_BOOL),
    'unknown_snapshot_enabled' => filter_var(env('UNKNOWN_SNAPSHOT_ENABLED', true), FILTER_VALIDATE_BOOL),
    'unknown_notify_admins' => filter_var(env('UNKNOWN_NOTIFY_ADMINS', true), FILTER_VALIDATE_BOOL),
    'unknown_alert_cooldown_seconds' => (int) env('UNKNOWN_ALERT_COOLDOWN_SECONDS', 300),
    'unknown_snapshot_retention_days' => (int) env('UNKNOWN_SNAPSHOT_RETENTION_DAYS', 30),
    'camera_stream_poll_interval_seconds' => (int) env('CAMERA_STREAM_POLL_INTERVAL_SECONDS', 5),

    'attendance_types' => [
        'present', 'late', 'early_leave', 'half_day', 'absent',
        'holiday', 'sick_leave', 'vacation', 'remote_work', 'on_leave',
    ],

    'shift_types' => [
        'fixed' => ['label' => 'Fixed Shift', 'example' => '09:00–18:00'],
        'rotational' => ['label' => 'Rotational Shift', 'slots' => ['morning', 'evening', 'night']],
        'flexible' => ['label' => 'Flexible Shift', 'description' => 'Employee defines start time'],
        'split' => ['label' => 'Split Shift', 'example' => '08:00–12:00, 14:00–18:00'],
    ],

    'auto_check_in' => [
        'requires_recognized' => true,
        'requires_confidence_above_threshold' => true,
        'requires_liveness_passed' => true,
    ],

    'auto_check_out' => [
        'requires_exit_zone' => true,
        'requires_recognized' => true,
    ],

    'default_policy' => [
        'grace_minutes' => (int) env('ATTENDANCE_GRACE_MINUTES', 15),
        'min_work_minutes' => (int) env('ATTENDANCE_MIN_WORK_MINUTES', 240),
        'max_work_minutes' => (int) env('ATTENDANCE_MAX_WORK_MINUTES', 600),
        'break_minutes' => (int) env('ATTENDANCE_BREAK_MINUTES', 60),
        'overtime_after_minutes' => (int) env('ATTENDANCE_OVERTIME_THRESHOLD_MINUTES', 480),
        'overtime_multiplier' => (float) env('ATTENDANCE_OVERTIME_MULTIPLIER', 1.5),
        'night_shift_start' => env('ATTENDANCE_NIGHT_START', '22:00'),
        'night_shift_end' => env('ATTENDANCE_NIGHT_END', '06:00'),
        'night_shift_multiplier' => (float) env('ATTENDANCE_NIGHT_MULTIPLIER', 1.25),
        'weekend_days' => [0, 6],
        'weekend_multiplier' => (float) env('ATTENDANCE_WEEKEND_MULTIPLIER', 1.5),
        'holiday_paid' => true,
        'auto_checkout_exit_zone' => true,
        'require_liveness_checkin' => true,
        'min_confidence' => (float) env('ATTENDANCE_MIN_CONFIDENCE', 0.95),
        'half_day_minutes' => (int) env('ATTENDANCE_HALF_DAY_MINUTES', 240),
    ],
];
