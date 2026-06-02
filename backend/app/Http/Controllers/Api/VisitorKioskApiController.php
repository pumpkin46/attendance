<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Visitor;
use App\Models\VisitorKiosk;
use App\Services\AccessControlService;
use App\Services\AiRecognitionClient;
use App\Services\VisitorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VisitorKioskApiController extends Controller
{
    public function __construct(
        private readonly VisitorService $visitors,
        private readonly AiRecognitionClient $ai,
        private readonly AccessControlService $accessControl,
    ) {}

    public function config(Request $request): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        return response()->json([
            'kiosk' => [
                'id' => $kiosk->id,
                'name' => $kiosk->name,
                'allow_walk_in' => $kiosk->allow_walk_in,
                'require_host' => $kiosk->require_host,
                'require_liveness' => $kiosk->require_liveness,
                'organization_id' => $kiosk->organization_id,
            ],
            'recognition_threshold' => config('services.ai.threshold', 0.95),
        ]);
    }

    public function hosts(Request $request): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');
        $search = $request->string('search')->toString();

        $hosts = Employee::where('organization_id', $kiosk->organization_id)
            ->where('is_active', true)
            ->when($search !== '', fn ($q) => $q->where(function ($inner) use ($search) {
                $inner->where('first_name', 'ilike', "%{$search}%")
                    ->orWhere('last_name', 'ilike', "%{$search}%")
                    ->orWhere('employee_code', 'ilike', "%{$search}%");
            }))
            ->orderBy('last_name')
            ->limit(20)
            ->get(['id', 'employee_code', 'first_name', 'last_name']);

        return response()->json($hosts);
    }

    public function lookup(Request $request): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        $data = $request->validate([
            'query' => 'required|string|max:64',
        ]);

        $visitor = $this->visitors->lookupByCodeOrPhone($data['query'], $kiosk->organization_id);

        if (! $visitor) {
            return response()->json(['found' => false], 404);
        }

        return response()->json([
            'found' => true,
            'visitor' => $this->formatVisitor($visitor),
        ]);
    }

    public function register(Request $request): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        if (! $kiosk->allow_walk_in) {
            return response()->json(['message' => 'Walk-in registration disabled on this kiosk'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'company' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:32',
            'purpose' => 'nullable|string|max:500',
            'host_employee_id' => $kiosk->require_host ? 'required|exists:employees,id' : 'nullable|exists:employees,id',
        ]);

        $hours = config('visitor_kiosks.default_visit_hours', 4);
        $visitor = $this->visitors->register([
            'organization_id' => $kiosk->organization_id,
            'host_employee_id' => $data['host_employee_id'] ?? null,
            'name' => $data['name'],
            'company' => $data['company'] ?? null,
            'phone' => $data['phone'] ?? null,
            'purpose' => $data['purpose'] ?? null,
            'visit_start_at' => now(),
            'visit_end_at' => now()->addHours($hours),
        ]);

        return response()->json(['visitor' => $this->formatVisitor($visitor->load('host'))], 201);
    }

    public function enrollFace(Request $request, Visitor $visitor): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        if ($visitor->organization_id !== $kiosk->organization_id) {
            return response()->json(['message' => 'Visitor not found'], 404);
        }

        $request->validate(['image' => 'required|string']);

        $result = $this->visitors->enrollFace($visitor, $request->image);

        if (! ($result['success'] ?? false)) {
            return response()->json($result, 422);
        }

        return response()->json([
            'success' => true,
            'visitor' => $this->formatVisitor($visitor->fresh()),
        ]);
    }

    public function checkIn(Request $request, Visitor $visitor): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        if ($visitor->organization_id !== $kiosk->organization_id) {
            return response()->json(['message' => 'Visitor not found'], 404);
        }

        if (! $visitor->face_registered) {
            return response()->json(['message' => 'Face enrollment required before check-in'], 422);
        }

        $visitor = $this->visitors->checkIn($visitor);

        $accessResult = null;
        if ($kiosk->access_point_id) {
            $point = $kiosk->accessPoint;
            if ($point) {
                $accessResult = $this->accessControl->evaluateAndExecute(
                    $point,
                    null,
                    $visitor,
                    1.0,
                    true,
                );
            }
        }

        return response()->json([
            'visitor' => $this->formatVisitor($visitor),
            'access' => $accessResult,
        ]);
    }

    public function identify(Request $request): JsonResponse
    {
        /** @var VisitorKiosk $kiosk */
        $kiosk = $request->attributes->get('visitor_kiosk');

        $data = $request->validate([
            'image' => 'required|string',
            'liveness_frames' => 'nullable|array|max:30',
            'liveness_frames.*' => 'string',
        ]);

        $requireLiveness = $kiosk->require_liveness;
        $result = $this->ai->identify(
            $data['image'],
            $requireLiveness,
            $data['liveness_frames'] ?? null,
            'kiosk-'.$kiosk->device_id,
            'webcam',
        );

        if (! ($result['success'] ?? false)) {
            return response()->json(['matched' => false, 'reason' => $result['error'] ?? 'failed'], 503);
        }

        $identityId = (string) ($result['employee_id'] ?? '');
        if (! str_starts_with($identityId, 'visitor-')) {
            return response()->json(['matched' => false, 'reason' => 'not_visitor']);
        }

        $visitor = $this->visitors->resolveVisitorFromIdentity($identityId);
        $confidence = (float) ($result['confidence'] ?? 0);

        if (! $visitor || $confidence < config('services.ai.threshold', 0.95)) {
            return response()->json(['matched' => false, 'reason' => 'unknown', 'confidence' => $confidence]);
        }

        if ($visitor->status === 'scheduled') {
            $visitor = $this->visitors->checkIn($visitor);
        }

        return response()->json([
            'matched' => true,
            'visitor' => $this->formatVisitor($visitor),
            'confidence' => $confidence,
        ]);
    }

    public function heartbeat(Request $request): JsonResponse
    {
        return response()->json(['ok' => true, 'server_time' => now()->toIso8601String()]);
    }

    private function formatVisitor(Visitor $visitor): array
    {
        return [
            'id' => $visitor->id,
            'name' => $visitor->name,
            'company' => $visitor->company,
            'phone' => $visitor->phone,
            'purpose' => $visitor->purpose,
            'status' => $visitor->status,
            'check_in_code' => $visitor->check_in_code,
            'badge_number' => $visitor->badge_number,
            'face_registered' => $visitor->face_registered,
            'visit_end_at' => $visitor->visit_end_at?->toIso8601String(),
            'checked_in_at' => $visitor->checked_in_at?->toIso8601String(),
            'host' => $visitor->relationLoaded('host') && $visitor->host
                ? $visitor->host->only(['id', 'first_name', 'last_name', 'employee_code'])
                : null,
        ];
    }
}
