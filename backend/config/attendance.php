<?php

return [
    'duplicate_window_seconds' => (int) env('FACE_DUPLICATE_WINDOW_SECONDS', 60),
    'overtime_threshold_minutes' => (int) env('ATTENDANCE_OVERTIME_THRESHOLD_MINUTES', 480),
    'default_grace_minutes' => 15,
    'unknown_person_alert' => true,
];
