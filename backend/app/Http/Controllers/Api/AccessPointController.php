<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AccessPoint;
use App\Services\AccessControlService;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccessPointController extends Controller
{
    public function __construct(
        private readonly AccessControlService $access,
        private readonly AuditService $audit,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'actions' => config('access_control.actions'),
            'device_types' => config('access_control.device_types'),
            'grant_conditions' => config('access_control.grant_conditions'),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $points = AccessPoint::with(['location', 'camera'])
            ->when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->orderBy('name')
            ->get();

        return response()->json($points);
    }

    public function store(Request $request): JsonResponse
    {
        $actions = implode(',', array_keys(config('access_control.actions', [])));
        $types = implode(',', array_keys(config('access_control.device_types', [])));

        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'location_id' => 'nullable|exists:locations,id',
            'camera_id' => 'nullable|exists:cameras,id',
            'name' => 'required|string|max:255',
            'device_type' => 'required|in:'.$types,
            'default_action' => 'required|in:'.$actions,
            'controller_url' => 'nullable|url',
            'require_liveness' => 'boolean',
            'min_confidence' => 'numeric|min:0|max:1',
        ]);

        $point = AccessPoint::create($data);
        $this->audit->log('access_point.created', $point);

        return response()->json($point->load(['location', 'camera']), 201);
    }

    public function execute(Request $request, AccessPoint $accessPoint): JsonResponse
    {
        $actions = implode(',', array_keys(config('access_control.actions', [])));
        $data = $request->validate([
            'action' => 'required|in:'.$actions,
        ]);

        $result = $this->access->manualAction($accessPoint, $data['action']);

        return response()->json($result, ($result['success'] ?? false) ? 200 : 422);
    }
}
