<?php

return [
    'default_visit_hours' => (int) env('VISITOR_DEFAULT_VISIT_HOURS', 8),
    'face_expiry_buffer_minutes' => (int) env('VISITOR_FACE_EXPIRY_BUFFER_MINUTES', 30),
    'expire_check_interval_minutes' => (int) env('VISITOR_EXPIRE_CHECK_MINUTES', 15),
];
