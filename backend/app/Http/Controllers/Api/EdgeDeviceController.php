<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Models\EdgeDevice;
use App\Models\Employee;
use App\Services\AttendanceService;
use App\Services\AuditService;
use App\Services\EdgeDeviceMonitoringService;
use App\Services\EdgeEmbeddingSyncService;
use App\Services\NfrComplianceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class EdgeDeviceController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly EdgeDeviceMonitoringService $monitoring,
    ) {}

    public function monitoring(): JsonResponse
    {
        return response()->json($this->monitoring->summary());
    }

    public function index(): JsonResponse
    {
        $devices = EdgeDevice::with(['location', 'camera'])
            ->orderBy('name')
            ->get()
            ->map(fn (EdgeDevice $d) => $this->monitoring->formatDevice($d));

        return response()->json($devices);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => 'required|exists:locations,id',
            'camera_id' => 'nullable|exists:cameras,id|unique:edge_devices,camera_id',
            'name' => 'required|string|max:255',
            'device_id' => 'nullable|string|max:255|unique:edge_devices,device_id',
            'stream_url' => 'nullable|string|max:500',
            'local_ai_url' => 'nullable|url',
            'poll_interval_seconds' => 'nullable|integer|min:1|max:60',
            'require_liveness' => 'boolean',
            'recognition_threshold' => 'nullable|numeric|min:0.5|max:1',
        ]);

        if (empty($data['device_id'])) {
            $data['device_id'] = $this->generateDeviceId($data['name']);
        }

        $plainToken = Str::random(40);
        $data['api_token'] = hash('sha256', $plainToken);
        $data['local_ai_url'] ??= 'http://127.0.0.1:8001';
        $data['poll_interval_seconds'] ??= 5;
        $data['status'] = EdgeDevice::STATUS_PENDING;

        $device = EdgeDevice::create($data);

        if ($device->camera_id) {
            Camera::where('id', $device->camera_id)->update(['deployment_mode' => 'edge']);
        }

        $this->audit->log('edge_device.created', $device);

        $formatted = $this->monitoring->formatDevice($device->load(['location', 'camera']));
        $formatted['api_token_plain'] = $plainToken;

        return response()->json($formatted, 201);
    }

    public function show(EdgeDevice $edgeDevice): JsonResponse
    {
        return response()->json($this->monitoring->formatDevice($edgeDevice->load(['location', 'camera'])));
    }

    public function update(Request $request, EdgeDevice $edgeDevice): JsonResponse
    {
        $old = $edgeDevice->toArray();
        $data = $request->validate([
            'name' => 'sometimes|string|max:255',
            'location_id' => 'sometimes|exists:locations,id',
            'camera_id' => 'nullable|exists:cameras,id|unique:edge_devices,camera_id,'.$edgeDevice->id,
            'stream_url' => 'nullable|string|max:500',
            'local_ai_url' => 'nullable|url',
            'poll_interval_seconds' => 'nullable|integer|min:1|max:60',
            'require_liveness' => 'boolean',
            'recognition_threshold' => 'nullable|numeric|min:0.5|max:1',
            'is_active' => 'boolean',
        ]);

        $edgeDevice->update($data);

        if ($edgeDevice->camera_id) {
            Camera::where('id', $edgeDevice->camera_id)->update(['deployment_mode' => 'edge']);
        }

        $this->audit->log('edge_device.updated', $edgeDevice, $old, $edgeDevice->fresh()->toArray());

        return response()->json($this->monitoring->formatDevice($edgeDevice->fresh()->load(['location', 'camera'])));
    }

    public function destroy(EdgeDevice $edgeDevice): JsonResponse
    {
        if ($edgeDevice->camera) {
            $edgeDevice->camera->update(['deployment_mode' => 'cloud']);
        }

        $edgeDevice->update(['is_active' => false, 'status' => EdgeDevice::STATUS_OFFLINE]);
        $this->audit->log('edge_device.deactivated', $edgeDevice);

        return response()->json(['message' => 'Edge device deactivated']);
    }

    public function regenerateToken(EdgeDevice $edgeDevice): JsonResponse
    {
        $plainToken = Str::random(40);
        $edgeDevice->update(['api_token' => hash('sha256', $plainToken)]);
        $this->audit->log('edge_device.token_regenerated', $edgeDevice);

        return response()->json([
            'id' => $edgeDevice->id,
            'api_token_plain' => $plainToken,
            'message' => 'Token regenerated. Update the edge agent with the new token.',
        ]);
    }

    public function agentConfig(EdgeDevice $edgeDevice): JsonResponse
    {
        return response()->json([
            'device_id' => $edgeDevice->device_id,
            'backend_url' => rtrim(config('app.url'), '/'),
            'stream_url' => $edgeDevice->stream_url,
            'local_ai_url' => $edgeDevice->local_ai_url,
            'poll_interval_seconds' => $edgeDevice->poll_interval_seconds,
            'require_liveness' => $edgeDevice->require_liveness,
            'recognition_threshold' => $edgeDevice->recognition_threshold ?? config('services.ai.threshold', 0.95),
        ]);
    }

    private function generateDeviceId(string $name): string
    {
        $base = Str::upper(Str::slug($name, '-'));
        $candidate = $base;
        $suffix = 1;

        while (EdgeDevice::where('device_id', $candidate)->exists()) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }
}
