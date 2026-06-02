<?php

/**
 * Camera management — configuration types and health monitoring (§8).
 */
return [
    'online_threshold_seconds' => (int) env('CAMERA_ONLINE_THRESHOLD_SECONDS', 120),

    'health_log_retention_days' => (int) env('CAMERA_HEALTH_LOG_RETENTION_DAYS', 7),

    'health_log_interval_seconds' => (int) env('CAMERA_HEALTH_LOG_INTERVAL_SECONDS', 300),

    'camera_types' => [
        'rtsp' => 'RTSP IP Camera',
        'ip' => 'IP Camera (HTTP)',
        'usb' => 'USB Camera',
        'nvr' => 'NVR Channel',
        'cctv' => 'CCTV Stream',
        'mobile' => 'Mobile Camera',
    ],

    'zones' => [
        'entry' => 'Entry',
        'exit' => 'Exit',
        'lobby' => 'Lobby',
        'parking' => 'Parking',
        'office' => 'Office',
        'warehouse' => 'Warehouse',
        'other' => 'Other',
    ],

    'statuses' => ['active', 'inactive', 'maintenance'],

    'directions' => ['in', 'out', 'both'],

    'deployment_modes' => ['cloud', 'edge'],
];
