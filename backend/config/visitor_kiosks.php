<?php

return [
    'offline_seconds' => (int) env('VISITOR_KIOSK_OFFLINE_SECONDS', 300),

    'default_visit_hours' => (int) env('VISITOR_KIOSK_DEFAULT_VISIT_HOURS', 4),

    'badge_prefix' => env('VISITOR_BADGE_PREFIX', 'V'),

    'check_in_code_length' => 6,
];
