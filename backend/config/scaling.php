<?php

/**
 * NFR-005: Horizontal scaling — independent recognition nodes, API servers, and workers.
 */
return [
    'enabled' => filter_var(env('NFR_HORIZONTAL_SCALING', true), FILTER_VALIDATE_BOOL),

    // Comma-separated AI recognition node URLs (load-balanced round-robin)
    'recognition_nodes' => array_values(array_filter(array_map(
        'trim',
        explode(',', env('AI_SERVICE_URLS', env('AI_SERVICE_URL', 'http://127.0.0.1:8001')))
    ))),

    'api' => [
        'stateless' => true,
        'session_driver' => env('SESSION_DRIVER', 'file'),
        'cache_store' => env('CACHE_STORE', 'file'),
    ],

    'workers' => [
        'queue_connection' => env('QUEUE_CONNECTION', 'sync'),
        'redis_host' => env('REDIS_HOST', '127.0.0.1'),
    ],

    'shared_storage' => [
        // FAISS index + unknown-face snapshots must be on shared volume when scaling AI nodes
        'faiss_index_path' => env('FAISS_SHARED_PATH', 'ai-service/data/faiss.index'),
    ],
];
