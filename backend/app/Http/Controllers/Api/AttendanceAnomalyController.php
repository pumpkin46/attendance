<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceAnomaly;
use App\Services\AttendanceAnomalyService;
use App\Services\AuditService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AttendanceAnomalyController extends Controller
{
    public function __construct(
        private readonly AttendanceAnomalyService $anomalies,
        private readonly AuditService $audit,
    ) {}

    public function summary(): JsonResponse
    {
        return response()->json($this->anomalies->summary());
    }

    public function index(Request $request): JsonResponse
    {
        $query = AttendanceAnomaly::with(['employee', 'attendanceRecord'])
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->when($request->severity, fn ($q, $s) => $q->where('severity', $s))
            ->when($request->anomaly_type, fn ($q, $t) => $q->where('anomaly_type', $t))
            ->when($request->employee_id, fn ($q, $id) => $q->where('employee_id', $id))
            ->when($request->date_from, fn ($q, $d) => $q->whereDate('detected_at', '>=', $d))
            ->when($request->date_to, fn ($q, $d) => $q->whereDate('detected_at', '<=', $d))
            ->orderByDesc('detected_at');

        return response()->json($query->paginate($request->integer('per_page', 50)));
    }

    public function detect(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'location_id' => 'nullable|exists:locations,id',
            'lookback_days' => 'nullable|integer|min:1|max:90',
        ]);

        $lookback = (int) ($data['lookback_days'] ?? config('attendance.anomaly_lookback_days', 30));
        $dateTo = isset($data['date_to']) ? Carbon::parse($data['date_to'])->toDateString() : now()->toDateString();
        $dateFrom = isset($data['date_from'])
            ? Carbon::parse($data['date_from'])->toDateString()
            : now()->subDays($lookback)->toDateString();

        $result = $this->anomalies->detect($dateFrom, $dateTo, $data['location_id'] ?? null);
        $this->audit->log('anomaly_detection.run', null, null, $result);

        return response()->json($result);
    }

    public function update(Request $request, AttendanceAnomaly $attendanceAnomaly): JsonResponse
    {
        $data = $request->validate([
            'status' => 'required|in:acknowledged,resolved,false_positive',
        ]);

        $old = $attendanceAnomaly->toArray();
        $updates = ['status' => $data['status']];

        if ($data['status'] === 'acknowledged') {
            $updates['acknowledged_at'] = now();
            $updates['acknowledged_by'] = Auth::id();
        }

        if (in_array($data['status'], ['resolved', 'false_positive'], true)) {
            $updates['resolved_at'] = now();
            if (! $attendanceAnomaly->acknowledged_at) {
                $updates['acknowledged_at'] = now();
                $updates['acknowledged_by'] = Auth::id();
            }
        }

        $attendanceAnomaly->update($updates);
        $this->audit->log('anomaly.updated', $attendanceAnomaly, $old, $attendanceAnomaly->fresh()->toArray());

        return response()->json($attendanceAnomaly->fresh()->load(['employee', 'attendanceRecord']));
    }
}
