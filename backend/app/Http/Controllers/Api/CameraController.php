<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CameraController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $cameras = Camera::with('location')
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('name')
            ->get();

        return response()->json($cameras);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => 'required|exists:locations,id',
            'name' => 'required|string',
            'device_id' => 'required|string|unique:cameras,device_id',
            'stream_url' => 'nullable|url',
            'direction' => 'in:in,out,both',
        ]);

        $camera = Camera::create($data);
        $this->audit->log('camera.created', $camera);

        return response()->json($camera->load('location'), 201);
    }

    public function show(Camera $camera): JsonResponse
    {
        return response()->json($camera->load('location'));
    }

    public function update(Request $request, Camera $camera): JsonResponse
    {
        $old = $camera->toArray();
        $camera->update($request->validate([
            'name' => 'sometimes|string',
            'stream_url' => 'nullable|url',
            'direction' => 'in:in,out,both',
            'is_active' => 'boolean',
        ]));
        $this->audit->log('camera.updated', $camera, $old, $camera->fresh()->toArray());

        return response()->json($camera->fresh());
    }

    public function destroy(Camera $camera): JsonResponse
    {
        $camera->update(['is_active' => false]);
        $this->audit->log('camera.deactivated', $camera);

        return response()->json(['message' => 'Camera deactivated']);
    }

    public function heartbeat(Camera $camera): JsonResponse
    {
        $camera->update(['last_heartbeat_at' => now()]);

        return response()->json(['status' => 'ok', 'last_heartbeat_at' => $camera->last_heartbeat_at]);
    }
}
