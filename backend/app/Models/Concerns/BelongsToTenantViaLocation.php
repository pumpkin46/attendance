<?php

namespace App\Models\Concerns;

use App\Services\TenantContext;
use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenantViaLocation
{
    public static function bootBelongsToTenantViaLocation(): void
    {
        static::addGlobalScope('tenant', function (Builder $builder) {
            if (! config('tenancy.isolation_enabled', true)) {
                return;
            }

            $orgId = TenantContext::organizationId();
            if ($orgId === null) {
                return;
            }

            $builder->whereHas('location', fn ($q) => $q->where('organization_id', $orgId));
        });
    }
}
