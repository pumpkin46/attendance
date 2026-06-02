<?php

namespace App\Services;

use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class SamlAuthService
{
    public function isEnabled(): bool
    {
        return config('security.authentication.saml.enabled', false)
            && config('security.authentication.saml.sso_url');
    }

    public function loginUrl(): ?string
    {
        if (! $this->isEnabled()) {
            return null;
        }

        $acs = config('security.authentication.saml.acs_url');
        $sso = config('security.authentication.saml.sso_url');

        return $sso.'?'.http_build_query([
            'RelayState' => $acs,
        ]);
    }

    /**
     * Process SAML assertion attributes (from your IdP integration) into a local user.
     */
    public function userFromAssertion(string $email, ?string $name = null, array $attributes = []): User
    {
        $user = User::firstOrCreate(
            ['email' => $email],
            [
                'name' => $name ?? $email,
                'password' => Hash::make(str()->random(32)),
                'auth_provider' => 'saml',
                'external_id' => $attributes['name_id'] ?? null,
                'is_active' => true,
            ]
        );

        $user->update([
            'auth_provider' => 'saml',
            'external_id' => $attributes['name_id'] ?? $user->external_id,
        ]);

        if ($user->roles()->count() === 0) {
            $defaultRole = Role::where('name', 'employee')->first();
            if ($defaultRole) {
                $user->roles()->attach($defaultRole);
            }
        }

        return $user;
    }
}
