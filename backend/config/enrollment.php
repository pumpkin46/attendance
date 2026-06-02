<?php

return [
    'min_images' => (int) env('FACE_ENROLLMENT_MIN_IMAGES', 10),
    'max_images' => (int) env('FACE_ENROLLMENT_MAX_IMAGES', 50),
    'retain_raw_images' => (bool) env('FACE_ENROLLMENT_RETAIN_RAW_IMAGES', false),
    'storage_disk' => env('FACE_ENROLLMENT_STORAGE_DISK', 'local'),
    'storage_path' => env('FACE_ENROLLMENT_STORAGE_PATH', 'enrollment'),
    'mode' => env('FACE_ENROLLMENT_MODE', 'structured'),
    'required_poses' => array_values(array_filter(array_map(
        'trim',
        explode(',', env(
            'FACE_ENROLLMENT_REQUIRED_POSES',
            'front,left,right,up,down,smiling,neutral,glasses,without_glasses'
        ))
    ))),
    'pose_labels' => [
        'front' => 'Front face — look straight at the camera',
        'left' => 'Turn your head left',
        'right' => 'Turn your head right',
        'up' => 'Tilt your head up slightly',
        'down' => 'Tilt your head down slightly',
        'smiling' => 'Smile naturally',
        'neutral' => 'Neutral expression, relaxed face',
        'glasses' => 'Wear your glasses',
        'without_glasses' => 'Remove glasses',
    ],
];
