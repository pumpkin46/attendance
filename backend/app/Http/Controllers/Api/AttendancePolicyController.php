<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendancePolicy;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttendancePolicyController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $policies = AttendancePolicy::query()
            ->when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->where('is_active', true)
            ->orderBy('name')
            ->get();

        return response()->json($policies);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'name' => 'required|string',
            'grace_minutes' => 'integer|min:0',
            'min_work_minutes' => 'integer|min:0',
            'max_work_minutes' => 'integer|min:0',
            'break_minutes' => 'integer|min:0',
            'overtime_after_minutes' => 'integer|min:0',
            'overtime_multiplier' => 'numeric|min:1',
            'night_shift_start' => 'nullable|date_format:H:i',
            'night_shift_end' => 'nullable|date_format:H:i',
            'night_shift_multiplier' => 'numeric|min:1',
            'weekend_days' => 'nullable|array',
            'weekend_multiplier' => 'numeric|min:1',
            'holiday_paid' => 'boolean',
            'auto_checkout_exit_zone' => 'boolean',
            'require_liveness_checkin' => 'boolean',
            'min_confidence' => 'numeric|min:0|max:1',
            'half_day_minutes' => 'integer|min:0',
            'is_default' => 'boolean',
        ]);

        if ($data['is_default'] ?? false) {
            AttendancePolicy::where('organization_id', $data['organization_id'])
                ->update(['is_default' => false]);
        }

        $policy = AttendancePolicy::create($data);
        $this->audit->log('attendance_policy.created', $policy);

        return response()->json($policy, 201);
    }

    public function show(AttendancePolicy $attendancePolicy): JsonResponse
    {
        return response()->json($attendancePolicy);
    }

    public function update(Request $request, AttendancePolicy $attendancePolicy): JsonResponse
    {
        $old = $attendancePolicy->toArray();
        $data = $request->validate([
            'name' => 'sometimes|string',
            'grace_minutes' => 'integer|min:0',
            'min_work_minutes' => 'integer|min:0',
            'max_work_minutes' => 'integer|min:0',
            'break_minutes' => 'integer|min:0',
            'overtime_after_minutes' => 'integer|min:0',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ]);

        if ($data['is_default'] ?? false) {
            AttendancePolicy::where('organization_id', $attendancePolicy->organization_id)
                ->where('id', '!=', $attendancePolicy->id)
                ->update(['is_default' => false]);
        }

        $attendancePolicy->update($data);
        $this->audit->log('attendance_policy.updated', $attendancePolicy, $old, $attendancePolicy->fresh()->toArray());

        return response()->json($attendancePolicy->fresh());
    }
}
