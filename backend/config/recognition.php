<?php

/**
 * AI Recognition Engine — sources, pipeline, and performance targets (§4).
 */
return [
    'pipeline_stages' => [
        'video_stream',
        'face_detection',
        'face_tracking',
        'face_quality_check',
        'liveness_detection',
        'embedding_generation',
        'vector_search',
        'identity_match',
        'attendance_event',
    ],

    'supported_sources' => [
        'webcam',
        'usb_camera',
        'ip_camera',
        'rtsp',
        'nvr',
        'cctv',
        'mobile',
        'upload',
    ],

    'metrics' => [
        'target_accuracy' => (float) env('RECOGNITION_TARGET_ACCURACY', 0.99),
        'max_false_positive_rate' => (float) env('RECOGNITION_MAX_FPR', 0.001),
        'max_false_negative_rate' => (float) env('RECOGNITION_MAX_FNR', 0.01),
        'recognition_sla_ms' => (int) env('RECOGNITION_SLA_MS', 300),
        'liveness_sla_ms' => (int) env('LIVENESS_SLA_MS', 500),
    ],

    'metrics_window_days' => (int) env('RECOGNITION_METRICS_WINDOW_DAYS', 7),
];
