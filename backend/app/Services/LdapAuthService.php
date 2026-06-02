<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Log;

class LdapAuthService
{
    public function isEnabled(): bool
    {
        return config('security.authentication.ldap.enabled', false)
            && config('security.authentication.ldap.host');
    }

    /**
     * Authenticate against LDAP / Active Directory and return matching user.
     */
    public function attempt(string $email, string $password): ?User
    {
        if (! $this->isEnabled() || ! function_exists('ldap_connect')) {
            return null;
        }

        $host = config('security.authentication.ldap.host');
        $port = config('security.authentication.ldap.port', 389);
        $useTls = config('security.authentication.ldap.use_tls', true);
        $baseDn = config('security.authentication.ldap.base_dn');

        $uri = ($useTls ? 'ldaps' : 'ldap')."://{$host}:{$port}";
        $connection = @ldap_connect($uri);

        if (! $connection) {
            Log::warning('LDAP connect failed', ['host' => $host]);

            return null;
        }

        ldap_set_option($connection, LDAP_OPT_PROTOCOL_VERSION, 3);
        ldap_set_option($connection, LDAP_OPT_REFERRALS, 0);

        $bindUser = $this->bindDnForEmail($email, $baseDn);
        if (! @ldap_bind($connection, $bindUser, $password)) {
            ldap_close($connection);

            return null;
        }

        ldap_close($connection);

        return $this->syncUser($email);
    }

    private function bindDnForEmail(string $email, string $baseDn): string
    {
        if (config('security.authentication.ldap.active_directory', false)) {
            $username = strstr($email, '@', true) ?: $email;

            return "{$username}@".$this->adDomainFromBaseDn($baseDn);
        }

        return "uid={$email},{$baseDn}";
    }

    private function adDomainFromBaseDn(string $baseDn): string
    {
        $parts = ldap_explode_dn($baseDn, 0);
        if (! is_array($parts)) {
            return 'local';
        }

        $dc = array_values(array_filter($parts, fn ($p) => str_starts_with(strtolower($p), 'dc=')));

        return implode('.', array_map(fn ($p) => substr($p, 3), $dc));
    }

    private function syncUser(string $email): ?User
    {
        $user = User::where('email', $email)->where('is_active', true)->first();

        if ($user) {
            $user->update(['auth_provider' => 'ldap']);

            return $user;
        }

        return null;
    }
}
