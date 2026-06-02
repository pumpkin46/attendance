<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;

class SecurityController extends Controller
{
    public function config(): JsonResponse
    {
        return response()->json([
            'authentication' => config('security.authentication'),
            'authorization' => config('security.authorization'),
            'encryption' => [
                'in_transit' => config('security.encryption.in_transit'),
                'at_rest' => config('security.encryption.at_rest'),
                'secrets' => [
                    'driver' => config('security.encryption.secrets.driver'),
                    'vault_configured' => (bool) config('security.encryption.secrets.vault_address'),
                    'kms_configured' => (bool) config('security.encryption.secrets.kms_key_id'),
                ],
            ],
            'tenancy' => [
                'isolation_enabled' => config('tenancy.isolation_enabled'),
                'supports' => [
                    'unlimited_organizations' => true,
                    'unlimited_branches' => true,
                    'unlimited_departments' => true,
                ],
            ],
            'app' => [
                'cipher' => Config::get('app.cipher'),
                'key_configured' => ! empty(Config::get('app.key')),
            ],
        ]);
    }
}
