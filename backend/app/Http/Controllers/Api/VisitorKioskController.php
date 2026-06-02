<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\VisitorKiosk;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class VisitorKioskController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        $timeout = config('visitor_kiosks.offline_seconds', 300);

        $kiosks = VisitorKiosk::with(['location', 'accessPoint'])
            ->orderBy('name')
            ->get()
            ->map(fn (VisitorKiosk $k) => [
                'id' => $k->id,
                'name' => $k->name,
                'device_id' => $k->device_id,
                'is_active' => $k->is_active,
                'allow_walk_in' => $k->allow_walk_in,
                'require_host' => $k->require_host,
                'require_liveness' => $k->require_liveness,
                'online' => $k->last_heartbeat_at?->gte(now()->subSeconds($timeout)) && $k->is_active,
                'last_heartbeat_at' => $k->last_heartbeat_at,
                'location' => $k->location,
                'access_point' => $k->accessPoint,
            ]);

        return response()->json($kiosks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'location_id' => 'nullable|exists:locations,id',
            'access_point_id' => 'nullable|exists:access_points,id',
            'name' => 'required|string|max:255',
            'device_id' => 'nullable|string|max:255|unique:visitor_kiosks,device_id',
            'allow_walk_in' => 'boolean',
            'require_host' => 'boolean',
            'require_liveness' => 'boolean',
        ]);

        if (empty($data['device_id'])) {
            $data['device_id'] = $this->generateDeviceId($data['name']);
        }

        $plainToken = Str::random(40);
        $data['api_token'] = hash('sha256', $plainToken);

        $kiosk = VisitorKiosk::create($data);
        $this->audit->log('visitor_kiosk.created', $kiosk);

        return response()->json([
            ...$kiosk->load(['location', 'accessPoint'])->toArray(),
            'api_token_plain' => $plainToken,
            'kiosk_url' => url('/visitor-kiosk?token='.$plainToken),
        ], 201);
    }

    public function update(Request $request, VisitorKiosk $visitorKiosk): JsonResponse
    {
        $visitorKiosk->update($request->validate([
            'name' => 'sometimes|string|max:255',
            'location_id' => 'nullable|exists:locations,id',
            'access_point_id' => 'nullable|exists:access_points,id',
            'allow_walk_in' => 'boolean',
            'require_host' => 'boolean',
            'require_liveness' => 'boolean',
            'is_active' => 'boolean',
        ]));

        return response()->json($visitorKiosk->fresh()->load(['location', 'accessPoint']));
    }

    public function regenerateToken(VisitorKiosk $visitorKiosk): JsonResponse
    {
        $plainToken = Str::random(40);
        $visitorKiosk->update(['api_token' => hash('sha256', $plainToken)]);
        $this->audit->log('visitor_kiosk.token_regenerated', $visitorKiosk);

        return response()->json([
            'id' => $visitorKiosk->id,
            'api_token_plain' => $plainToken,
            'kiosk_url' => url('/visitor-kiosk?token='.$plainToken),
        ]);
    }

    private function generateDeviceId(string $name): string
    {
        $base = Str::upper(Str::slug($name, '-'));
        $candidate = 'VK-'.$base;
        $suffix = 1;

        while (VisitorKiosk::where('device_id', $candidate)->exists()) {
            $candidate = 'VK-'.$base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }
}
