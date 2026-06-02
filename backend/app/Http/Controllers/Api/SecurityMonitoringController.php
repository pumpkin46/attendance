<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SecurityAlert;
use App\Services\SecurityMonitoringService;
use App\Services\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SecurityMonitoringController extends Controller
{
    public function __construct(private readonly SecurityMonitoringService $monitoring) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'enabled' => config('security_monitoring.enabled'),
            'alert_types' => config('security_monitoring.alert_types'),
            'severities' => config('security_monitoring.severities'),
            'after_hours' => config('security_monitoring.after_hours'),
        ]);
    }

    public function dashboard(): JsonResponse
    {
        return response()->json(
            $this->monitoring->dashboard(TenantContext::organizationId())
        );
    }

    public function index(Request $request): JsonResponse
    {
        $alerts = SecurityAlert::with(['camera:id,name', 'employee:id,first_name,last_name', 'visitor:id,name'])
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->when($request->severity, fn ($q, $s) => $q->where('severity', $s))
            ->when($request->alert_type, fn ($q, $t) => $q->where('alert_type', $t))
            ->orderByDesc('occurred_at')
            ->paginate($request->integer('per_page', 25));

        return response()->json($alerts);
    }

    public function show(SecurityAlert $securityAlert): JsonResponse
    {
        return response()->json(
            $securityAlert->load(['camera', 'employee', 'visitor', 'accessPoint', 'acknowledgedByUser'])
        );
    }

    public function acknowledge(Request $request, SecurityAlert $securityAlert): JsonResponse
    {
        $alert = $this->monitoring->acknowledge($securityAlert, $request->user());

        return response()->json($alert);
    }

    public function resolve(SecurityAlert $securityAlert): JsonResponse
    {
        return response()->json($this->monitoring->resolve($securityAlert));
    }
}
