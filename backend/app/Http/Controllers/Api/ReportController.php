<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\RecognitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    public function attendanceSummary(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        $summary = AttendanceRecord::query()
            ->whereBetween('work_date', [$request->date_from, $request->date_to])
            ->select('status', DB::raw('count(*) as count'))
            ->groupBy('status')
            ->pluck('count', 'status');

        $daily = AttendanceRecord::query()
            ->whereBetween('work_date', [$request->date_from, $request->date_to])
            ->select('work_date', DB::raw('count(*) as total'), DB::raw("sum(case when status in ('present','late') then 1 else 0 end) as present"))
            ->groupBy('work_date')
            ->orderBy('work_date')
            ->get();

        return response()->json([
            'period' => ['from' => $request->date_from, 'to' => $request->date_to],
            'by_status' => $summary,
            'daily' => $daily,
        ]);
    }

    public function overtime(Request $request): JsonResponse
    {
        $records = AttendanceRecord::with('employee')
            ->where('overtime_minutes', '>', 0)
            ->when($request->date_from, fn ($q, $d) => $q->where('work_date', '>=', $d))
            ->when($request->date_to, fn ($q, $d) => $q->where('work_date', '<=', $d))
            ->orderByDesc('overtime_minutes')
            ->paginate($request->integer('per_page', 50));

        return response()->json($records);
    }

    public function unknownPersons(Request $request): JsonResponse
    {
        $events = RecognitionEvent::with('camera')
            ->where('result', 'unknown')
            ->when($request->date_from, fn ($q, $d) => $q->where('recognized_at', '>=', $d))
            ->when($request->date_to, fn ($q, $d) => $q->where('recognized_at', '<=', $d))
            ->orderByDesc('recognized_at')
            ->paginate($request->integer('per_page', 50));

        $events->getCollection()->transform(function (RecognitionEvent $event) {
            $data = $event->toArray();
            $data['snapshot_url'] = $event->snapshotUrl();

            return $data;
        });

        return response()->json($events);
    }

    public function export(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date',
            'format' => 'in:json,csv',
        ]);

        $records = AttendanceRecord::with('employee')
            ->whereBetween('work_date', [$request->date_from, $request->date_to])
            ->orderBy('work_date')
            ->get()
            ->map(fn ($r) => [
                'work_date' => $r->work_date->toDateString(),
                'employee_code' => $r->employee->employee_code,
                'employee_name' => $r->employee->full_name,
                'check_in' => $r->check_in_at?->toIso8601String(),
                'check_out' => $r->check_out_at?->toIso8601String(),
                'worked_minutes' => $r->worked_minutes,
                'overtime_minutes' => $r->overtime_minutes,
                'status' => $r->status,
            ]);

        if ($request->format === 'csv') {
            $csv = "work_date,employee_code,employee_name,check_in,check_out,worked_minutes,overtime_minutes,status\n";
            foreach ($records as $row) {
                $csv .= implode(',', array_map(fn ($v) => '"'.str_replace('"', '""', (string) $v).'"', $row))."\n";
            }

            return response()->json(['format' => 'csv', 'content' => $csv]);
        }

        return response()->json(['format' => 'json', 'records' => $records]);
    }
}
