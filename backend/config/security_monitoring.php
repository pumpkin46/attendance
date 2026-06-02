<?php

return [
    'enabled' => env('SECURITY_MONITORING_ENABLED', true),

    'alert_types' => [
        'unknown_person' => 'Unknown person detected',
        'spoof_attempt' => 'Anti-spoof / liveness failure',
        'access_denied' => 'Access denied at entry point',
        'after_hours' => 'After-hours access attempt',
        'tailgating' => 'Possible tailgating (rapid re-entry)',
        'zone_violation' => 'Restricted zone violation',
    ],

    'severities' => ['low', 'medium', 'high', 'critical'],

    'after_hours' => [
        'start' => env('SECURITY_AFTER_HOURS_START', '20:00'),
        'end' => env('SECURITY_AFTER_HOURS_END', '06:00'),
    ],

    'tailgating_window_seconds' => (int) env('SECURITY_TAILGATING_WINDOW', 8),

    'alert_cooldown_seconds' => (int) env('SECURITY_ALERT_COOLDOWN', 120),
];
