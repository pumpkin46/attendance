<?php

namespace App\Http\Middleware;

use App\Services\TenantContext;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceTenantIsolation
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('tenancy.isolation_enabled', true)) {
            return $next($request);
        }

        $user = $request->user();
        if (! $user) {
            return $next($request);
        }

        if ($request->has('organization_id')) {
            TenantContext::assertOrganizationAccess((int) $request->input('organization_id'));
        }

        foreach ($request->route()?->parameters() ?? [] as $param) {
            if ($param instanceof Model && isset($param->organization_id)) {
                TenantContext::assertOrganizationAccess((int) $param->organization_id);
            }
        }

        return $next($request);
    }
}
