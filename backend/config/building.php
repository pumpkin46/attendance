<?php

return [
    'enabled' => env('BUILDING_INTEGRATION_ENABLED', true),

    'drivers' => [
        'webhook' => 'HTTP Webhook (BMS / IoT hub)',
        'mqtt' => 'MQTT broker (simulated log)',
        'bacnet_gateway' => 'BACnet gateway webhook',
    ],

    'event_types' => [
        'access_granted' => 'Door / turnstile unlocked',
        'access_denied' => 'Access denied at entry point',
        'occupancy_update' => 'Zone occupancy changed',
        'visitor_checked_in' => 'Visitor checked in at kiosk',
        'after_hours_entry' => 'Entry outside business hours',
        'hvac_occupancy' => 'HVAC setpoint from occupancy',
    ],

    'default_subscribed_events' => [
        'access_granted',
        'access_denied',
        'occupancy_update',
        'visitor_checked_in',
    ],

    'webhook_timeout_seconds' => (int) env('BUILDING_WEBHOOK_TIMEOUT', 5),

    'business_hours' => [
        'start' => env('BUILDING_BUSINESS_HOURS_START', '08:00'),
        'end' => env('BUILDING_BUSINESS_HOURS_END', '18:00'),
        'timezone' => env('BUILDING_BUSINESS_TIMEZONE', 'UTC'),
    ],
];
