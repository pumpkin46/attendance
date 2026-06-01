<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Services\AttendanceService;
use App\Services\AuditService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendance,
        private readonly AuditService $audit
    ) {}

    public function index(Request $request): JsonResponse
    {
        $records = AttendanceRecord::with(['employee', 'camera'])
            ->when($request->employee_id, fn ($q, $id) => $q->where('employee_id', $id))
            ->when($request->date_from, fn ($q, $d) => $q->where('work_date', '>=', $d))
            ->when($request->date_to, fn ($q, $d) => $q->where('work_date', '<=', $d))
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('work_date')
            ->paginate($request->integer('per_page', 50));

        return response()->json($records);
    }

    public function today(Request $request): JsonResponse
    {
        $today = Carbon::today()->toDateString();

        $records = AttendanceRecord::with('employee')
            ->where('work_date', $today)
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->get();

        $summary = [
            'date' => $today,
            'present' => $records->whereIn('status', ['present', 'late'])->count(),
            'absent' => $records->where('status', 'absent')->count(),
            'late' => $records->where('status', 'late')->count(),
            'on_leave' => $records->where('status', 'on_leave')->count(),
            'records' => $records,
        ];

        return response()->json($summary);
    }

    public function manual(Request $request): JsonResponse
    {
        $data = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'action' => 'required|in:check_in,check_out',
            'timestamp' => 'nullable|date',
            'notes' => 'nullable|string',
        ]);

        $timestamp = isset($data['timestamp']) ? Carbon::parse($data['timestamp']) : now();
        $workDate = $timestamp->toDateString();

        $record = AttendanceRecord::firstOrCreate(
            ['employee_id' => $data['employee_id'], 'work_date' => $workDate],
            ['status' => 'absent']
        );

        if ($data['action'] === 'check_in') {
            $record->update([
                'check_in_at' => $timestamp,
                'check_in_method' => 'manual',
                'status' => 'present',
                'notes' => $data['notes'] ?? $record->notes,
            ]);
        } else {
            $record->update([
                'check_out_at' => $timestamp,
                'check_out_method' => 'manual',
                'notes' => $data['notes'] ?? $record->notes,
            ]);
            $this->attendance->calculateWorkedTime($record->fresh());
        }

        $this->audit->log("attendance.manual_{$data['action']}", $record);

        return response()->json($record->fresh()->load('employee'));
    }
}
