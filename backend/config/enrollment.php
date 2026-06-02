<?php

return [
    'min_images' => (int) env('FACE_ENROLLMENT_MIN_IMAGES', 10),
    'max_images' => (int) env('FACE_ENROLLMENT_MAX_IMAGES', 50),
    'retain_raw_images' => (bool) env('FACE_ENROLLMENT_RETAIN_RAW_IMAGES', false),
    'storage_disk' => env('FACE_ENROLLMENT_STORAGE_DISK', 'local'),
    'storage_path' => env('FACE_ENROLLMENT_STORAGE_PATH', 'enrollment'),
];
