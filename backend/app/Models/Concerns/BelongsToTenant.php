<?php

namespace App\Models\Concerns;

use App\Services\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $builder) {
            if (! config('tenancy.isolation_enabled', true)) {
                return;
            }

            $orgId = TenantContext::organizationId();
            if ($orgId === null) {
                return;
            }

            $table = $builder->getModel()->getTable();
            $builder->where("{$table}.organization_id", $orgId);
        });

        static::creating(function (Model $model) {
            if (! config('tenancy.isolation_enabled', true)) {
                return;
            }

            if (! empty($model->organization_id)) {
                return;
            }

            $orgId = TenantContext::organizationId();
            if ($orgId !== null) {
                $model->organization_id = $orgId;
            }
        });
    }
}
