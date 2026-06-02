<?php

/**
 * Multi-tenant architecture (§17) — mandatory tenant isolation.
 */
return [
    'isolation_enabled' => filter_var(env('TENANT_ISOLATION_ENABLED', true), FILTER_VALIDATE_BOOL),

    'super_admin_role' => 'super_admin',

    'header_organization_id' => 'X-Organization-Id',

    'scoped_models' => [
        'employees',
        'locations',
        'cameras',
        'shifts',
        'visitors',
        'access_points',
        'attendance_policies',
        'holidays',
        'branches',
        'departments',
        'live_events',
    ],
];
