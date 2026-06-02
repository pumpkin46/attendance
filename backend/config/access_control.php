<?php

return [
    'actions' => [
        'unlock_door' => 'Unlock door',
        'lock_door' => 'Lock door',
        'open_turnstile' => 'Open turnstile',
        'open_gate' => 'Open gate',
    ],

    'device_types' => [
        'door' => 'Door',
        'turnstile' => 'Turnstile',
        'gate' => 'Gate',
    ],

    'grant_conditions' => [
        'face_recognized' => true,
        'liveness_passed' => true,
        'access_authorized' => true,
    ],

    'default_action_by_device' => [
        'door' => 'unlock_door',
        'turnstile' => 'open_turnstile',
        'gate' => 'open_gate',
    ],
];
