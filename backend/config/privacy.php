<?php

/**
 * NFR-008: GDPR and local privacy law compliance settings.
 */
return [
    'enabled' => filter_var(env('GDPR_ENABLED', true), FILTER_VALIDATE_BOOL),

    'controller' => [
        'name' => env('PRIVACY_CONTROLLER_NAME', 'Attendance Platform Administrator'),
        'contact_email' => env('PRIVACY_CONTACT_EMAIL', 'privacy@attendance.local'),
    ],

    'lawful_basis' => 'legitimate_interest', // employment / security

    'data_categories' => [
        'biometric' => 'Face embeddings (mathematical vectors, not raw photos by default)',
        'attendance' => 'Check-in/out timestamps and worked hours',
        'audit' => 'Security and access audit trail',
    ],

    'subject_rights' => [
        'access' => true,
        'rectification' => true,
        'erasure' => true,
        'portability' => true,
        'restrict_processing' => true,
    ],

    'retention_days' => [
        'audit_logs' => (int) env('RETENTION_AUDIT_LOGS_DAYS', 365),
        'recognition_events' => (int) env('RETENTION_RECOGNITION_EVENTS_DAYS', 90),
        'unknown_snapshots' => (int) env('UNKNOWN_SNAPSHOT_RETENTION_DAYS', 30),
        'notifications' => (int) env('RETENTION_NOTIFICATIONS_DAYS', 90),
    ],

    'consent_required_for_enrollment' => filter_var(
        env('GDPR_ENROLLMENT_CONSENT_REQUIRED', false),
        FILTER_VALIDATE_BOOL
    ),
];
