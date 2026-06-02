<?php

namespace App\Services;

use App\Models\User;

class TenantContext
{
    private static ?int $overrideOrganizationId = null;

    public static function setOrganizationId(?int $id): void
    {
        self::$overrideOrganizationId = $id;
    }

    public static function organizationId(): ?int
    {
        if (self::$overrideOrganizationId !== null) {
            return self::$overrideOrganizationId;
        }

        $user = auth()->user();
        if (! $user instanceof User) {
            return null;
        }

        if ($user->isSuperAdmin()) {
            $header = config('tenancy.header_organization_id', 'X-Organization-Id');
            $fromHeader = request()->header($header);

            return $fromHeader ? (int) $fromHeader : null;
        }

        return $user->organization_id;
    }

    public static function canAccessOrganization(?int $organizationId): bool
    {
        if (! config('tenancy.isolation_enabled', true)) {
            return true;
        }

        $user = auth()->user();
        if (! $user instanceof User) {
            return false;
        }

        if ($user->isSuperAdmin()) {
            return true;
        }

        return $organizationId !== null && (int) $user->organization_id === (int) $organizationId;
    }

    public static function assertOrganizationAccess(?int $organizationId): void
    {
        if (! self::canAccessOrganization($organizationId)) {
            abort(403, 'Tenant isolation: access denied to this organization');
        }
    }
}
