<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BuildingConnector;
use App\Models\BuildingEvent;
use App\Services\AuditService;
use App\Services\BuildingIntegrationService;
use App\Services\MonitoringCenterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BuildingIntegrationController extends Controller
{
    public function __construct(
        private readonly BuildingIntegrationService $building,
        private readonly AuditService $audit,
        private readonly MonitoringCenterService $monitoring,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'enabled' => config('building.enabled'),
            'drivers' => config('building.drivers'),
            'event_types' => config('building.event_types'),
            'default_subscribed_events' => config('building.default_subscribed_events'),
            'business_hours' => config('building.business_hours'),
        ]);
    }

    public function index(): JsonResponse
    {
        $connectors = BuildingConnector::with('location')
            ->orderBy('name')
            ->get()
            ->map(fn (BuildingConnector $c) => [
                'id' => $c->id,
                'name' => $c->name,
                'driver' => $c->driver,
                'endpoint_url' => $c->endpoint_url,
                'subscribed_events' => $c->subscribed_events,
                'is_active' => $c->is_active,
                'last_sync_at' => $c->last_sync_at,
                'location' => $c->location,
                'events_today' => $c->events()->whereDate('created_at', today())->count(),
            ]);

        return response()->json($connectors);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'location_id' => 'nullable|exists:locations,id',
            'name' => 'required|string|max:255',
            'driver' => 'in:webhook,mqtt,bacnet_gateway',
            'endpoint_url' => 'nullable|url|max:500',
            'api_secret' => 'nullable|string|max:255',
            'subscribed_events' => 'nullable|array',
            'subscribed_events.*' => 'string',
            'settings' => 'nullable|array',
        ]);

        $data['subscribed_events'] ??= config('building.default_subscribed_events');
        $connector = BuildingConnector::create($data);
        $this->audit->log('building_connector.created', $connector);

        return response()->json($connector->load('location'), 201);
    }

    public function update(Request $request, BuildingConnector $buildingConnector): JsonResponse
    {
        $buildingConnector->update($request->validate([
            'name' => 'sometimes|string|max:255',
            'driver' => 'in:webhook,mqtt,bacnet_gateway',
            'endpoint_url' => 'nullable|url|max:500',
            'api_secret' => 'nullable|string|max:255',
            'subscribed_events' => 'nullable|array',
            'settings' => 'nullable|array',
            'is_active' => 'boolean',
        ]));

        return response()->json($buildingConnector->fresh()->load('location'));
    }

    public function destroy(BuildingConnector $buildingConnector): JsonResponse
    {
        $buildingConnector->update(['is_active' => false]);

        return response()->json(['message' => 'Connector deactivated']);
    }

    public function events(Request $request): JsonResponse
    {
        $events = BuildingEvent::with('connector:id,name')
            ->when($request->connector_id, fn ($q, $id) => $q->where('building_connector_id', $id))
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('created_at')
            ->paginate($request->integer('per_page', 50));

        return response()->json($events);
    }

    public function testDispatch(BuildingConnector $buildingConnector): JsonResponse
    {
        $this->building->dispatch(
            'occupancy_update',
            ['test' => true, 'connector_id' => $buildingConnector->id],
            $buildingConnector->organization_id,
            $buildingConnector->location_id,
        );

        return response()->json(['message' => 'Test event dispatched']);
    }

    public function occupancy(): JsonResponse
    {
        $dashboard = $this->monitoring->dashboard();

        $this->building->publishOccupancy(
            null,
            null,
            (int) ($dashboard['employees_present'] ?? 0),
            (int) (($dashboard['employees_present'] ?? 0) + ($dashboard['employees_absent'] ?? 0)),
        );

        return response()->json([
            'published' => true,
            'present' => $dashboard['employees_present'] ?? 0,
        ]);
    }
}
