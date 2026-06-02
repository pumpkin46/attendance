<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Visitor;
use App\Services\AuditService;
use App\Services\VisitorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VisitorController extends Controller
{
    public function __construct(
        private readonly VisitorService $visitors,
        private readonly AuditService $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $visitors = Visitor::with('host')
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->when($request->date, fn ($q, $d) => $q->whereDate('visit_start_at', '<=', $d)
                ->whereDate('visit_end_at', '>=', $d))
            ->orderByDesc('visit_start_at')
            ->paginate($request->integer('per_page', 25));

        return response()->json($visitors);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'host_employee_id' => 'nullable|exists:employees,id',
            'name' => 'required|string|max:255',
            'company' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:32',
            'purpose' => 'nullable|string|max:500',
            'visit_start_at' => 'nullable|date',
            'visit_end_at' => 'nullable|date|after:visit_start_at',
        ]);

        $visitor = $this->visitors->register($data);
        $this->audit->log('visitor.registered', $visitor);

        return response()->json($visitor->load('host'), 201);
    }

    public function show(Visitor $visitor): JsonResponse
    {
        return response()->json($visitor->load('host'));
    }

    public function enrollFace(Request $request, Visitor $visitor): JsonResponse
    {
        $request->validate(['image' => 'required|string']);

        $result = $this->visitors->enrollFace($visitor, $request->image);

        if (! ($result['success'] ?? false)) {
            return response()->json($result, 422);
        }

        $this->audit->log('visitor.face_enrolled', $visitor);

        return response()->json($result, 201);
    }

    public function cancel(Visitor $visitor): JsonResponse
    {
        if ($visitor->face_registered && $visitor->ai_identity_id) {
            app(\App\Services\AiRecognitionClient::class)->deleteEmployee($visitor->ai_identity_id);
        }
        $visitor->update(['status' => 'cancelled', 'face_registered' => false]);
        $this->audit->log('visitor.cancelled', $visitor);

        return response()->json($visitor->fresh());
    }
}
