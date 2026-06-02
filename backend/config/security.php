<?php

/**
 * Security requirements (§16) — authentication, authorization, encryption.
 */
return [
    'authentication' => [
        'jwt' => [
            'enabled' => true,
            'driver' => 'sanctum',
            'token_type' => 'Bearer',
            'description' => 'API access via Sanctum personal access tokens (JWT-compatible bearer tokens)',
        ],
        'oauth2' => [
            'enabled' => filter_var(env('OAUTH_ENABLED', true), FILTER_VALIDATE_BOOL),
            'providers' => array_filter(explode(',', env('OAUTH_PROVIDERS', 'google,microsoft'))),
        ],
        'saml' => [
            'enabled' => filter_var(env('SAML_ENABLED', false), FILTER_VALIDATE_BOOL),
            'entity_id' => env('SAML_ENTITY_ID'),
            'sso_url' => env('SAML_SSO_URL'),
            'acs_url' => env('SAML_ACS_URL'),
            'certificate' => env('SAML_CERTIFICATE'),
        ],
        'ldap' => [
            'enabled' => filter_var(env('LDAP_ENABLED', false), FILTER_VALIDATE_BOOL),
            'active_directory' => filter_var(env('LDAP_AD_MODE', false), FILTER_VALIDATE_BOOL),
            'host' => env('LDAP_HOST'),
            'port' => (int) env('LDAP_PORT', 389),
            'base_dn' => env('LDAP_BASE_DN'),
            'use_tls' => filter_var(env('LDAP_TLS', true), FILTER_VALIDATE_BOOL),
        ],
    ],

    'authorization' => [
        'model' => 'rbac',
        'roles' => [
            'super_admin' => 'Super Admin',
            'org_admin' => 'Organization Admin',
            'hr_manager' => 'HR Manager',
            'supervisor' => 'Supervisor',
            'employee' => 'Employee',
            'security_officer' => 'Security Officer',
        ],
    ],

    'encryption' => [
        'in_transit' => [
            'protocol' => env('NFR_TLS_MIN_VERSION', '1.3'),
            'force_https' => filter_var(env('FORCE_HTTPS', false), FILTER_VALIDATE_BOOL),
        ],
        'at_rest' => [
            'cipher' => env('NFR_ENCRYPTION_CIPHER', 'AES-256-CBC'),
            'app_key_required' => true,
        ],
        'secrets' => [
            'driver' => env('SECRETS_DRIVER', 'env'),
            'vault_address' => env('VAULT_ADDR'),
            'kms_key_id' => env('AWS_KMS_KEY_ID'),
        ],
    ],
];
