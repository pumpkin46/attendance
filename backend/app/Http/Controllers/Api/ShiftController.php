<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Shift;
use App\Models\ShiftAssignment;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $shifts = Shift::when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->where('is_active', true)
            ->orderBy('name')
            ->get();

        return response()->json($shifts);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'name' => 'required|string',
            'start_time' => 'required|date_format:H:i',
            'end_time' => 'required|date_format:H:i|after:start_time',
            'grace_minutes' => 'integer|min:0',
            'break_minutes' => 'integer|min:0',
            'days_of_week' => 'nullable|array',
        ]);

        $shift = Shift::create($data);
        $this->audit->log('shift.created', $shift);

        return response()->json($shift, 201);
    }

    public function show(Shift $shift): JsonResponse
    {
        return response()->json($shift->load('assignments.employee'));
    }

    public function update(Request $request, Shift $shift): JsonResponse
    {
        $old = $shift->toArray();
        $shift->update($request->validate([
            'name' => 'sometimes|string',
            'start_time' => 'sometimes|date_format:H:i',
            'end_time' => 'sometimes|date_format:H:i',
            'grace_minutes' => 'integer|min:0',
            'is_active' => 'boolean',
        ]));
        $this->audit->log('shift.updated', $shift, $old, $shift->fresh()->toArray());

        return response()->json($shift->fresh());
    }

    public function destroy(Shift $shift): JsonResponse
    {
        $shift->update(['is_active' => false]);
        $this->audit->log('shift.deactivated', $shift);

        return response()->json(['message' => 'Shift deactivated']);
    }

    public function assign(Request $request, Shift $shift): JsonResponse
    {
        $data = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'effective_from' => 'required|date',
            'effective_to' => 'nullable|date|after_or_equal:effective_from',
        ]);

        $assignment = ShiftAssignment::create([
            'shift_id' => $shift->id,
            ...$data,
        ]);

        $this->audit->log('shift.assigned', $assignment);

        return response()->json($assignment->load('employee', 'shift'), 201);
    }
}
