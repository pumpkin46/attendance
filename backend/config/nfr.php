<?php

/**
 * Non-functional requirements (NFR-001 – NFR-008) — targets and platform limits.
 */
return [
    // NFR-001 Recognition speed: < 300 ms (embedding + search); liveness < 500 ms
    'recognition_sla_ms' => (int) env('NFR_RECOGNITION_SLA_MS', 300),
    'liveness_sla_ms' => (int) env('NFR_LIVENESS_SLA_MS', 500),

    // NFR-002 Concurrent users / employee capacity
    'max_employees' => (int) env('NFR_MAX_EMPLOYEES', 10_000),

    // NFR-003 Camera support
    'max_cameras' => (int) env('NFR_MAX_CAMERAS', 100),

    // NFR-004 Availability target (99.9% ≈ 8.76 h downtime/year)
    'uptime_target_percent' => (float) env('NFR_UPTIME_TARGET', 99.9),

    // NFR-005 Horizontal scaling — see config/scaling.php
    'horizontal_scaling_enabled' => filter_var(env('NFR_HORIZONTAL_SCALING', true), FILTER_VALIDATE_BOOL),

    // NFR-006 Encryption
    'tls_min_version' => env('NFR_TLS_MIN_VERSION', '1.3'),
    'encryption_cipher' => env('NFR_ENCRYPTION_CIPHER', 'AES-256-CBC'),

    // NFR-007 Password security — driver set in config/hashing.php (argon2id)
    'password_hasher' => env('HASH_DRIVER', 'argon2id'),

    // NFR-008 Data privacy / GDPR
    'gdpr_enabled' => filter_var(env('GDPR_ENABLED', true), FILTER_VALIDATE_BOOL),
    'data_retention_days' => [
        'audit_logs' => (int) env('RETENTION_AUDIT_LOGS_DAYS', 365),
        'recognition_events' => (int) env('RETENTION_RECOGNITION_EVENTS_DAYS', 90),
        'unknown_snapshots' => (int) env('UNKNOWN_SNAPSHOT_RETENTION_DAYS', 30),
        'notifications' => (int) env('RETENTION_NOTIFICATIONS_DAYS', 90),
    ],
];
