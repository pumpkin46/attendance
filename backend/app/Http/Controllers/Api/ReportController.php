<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RecognitionEvent;
use App\Services\AttendanceReportService;
use App\Services\ReportExportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ReportController extends Controller
{
    public function __construct(
        private readonly AttendanceReportService $reports,
        private readonly ReportExportService $export,
    ) {}

    /** FR-021 Daily attendance report */
    public function daily(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => 'nullable|date',
            'location_id' => 'nullable|exists:locations,id',
        ]);

        $date = $data['date'] ?? now()->toDateString();

        return response()->json($this->reports->daily($date, $data['location_id'] ?? null));
    }

    /** FR-022 Monthly attendance report */
    public function monthly(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => 'nullable|integer|min:2000|max:2100',
            'month' => 'nullable|integer|min:1|max:12',
            'location_id' => 'nullable|exists:locations,id',
        ]);

        $year = (int) ($data['year'] ?? now()->year);
        $month = (int) ($data['month'] ?? now()->month);

        return response()->json($this->reports->monthly($year, $month, $data['location_id'] ?? null));
    }

    public function attendanceSummary(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        $daily = $this->reports->daily($request->date_from);
        $monthly = $this->reports->monthly(
            (int) date('Y', strtotime($request->date_from)),
            (int) date('m', strtotime($request->date_from)),
        );

        return response()->json([
            'period' => ['from' => $request->date_from, 'to' => $request->date_to],
            'daily' => $daily,
            'monthly_summary' => $monthly['summary'],
        ]);
    }

    public function overtime(Request $request): JsonResponse
    {
        $records = \App\Models\AttendanceRecord::with('employee')
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

    /** FR-023 Export reports — CSV, Excel (.xls), PDF */
    public function export(Request $request): Response
    {
        $data = $request->validate([
            'format' => 'required|in:csv,xlsx,excel,pdf',
            'report_type' => 'required|in:daily,monthly,detail',
            'date' => 'nullable|date',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'year' => 'nullable|integer|min:2000|max:2100',
            'month' => 'nullable|integer|min:1|max:12',
            'location_id' => 'nullable|exists:locations,id',
        ]);

        $file = $this->export->export(
            $data['format'],
            $data['report_type'],
            $data,
        );

        return response($file['content'], 200, [
            'Content-Type' => $file['mime'],
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
        ]);
    }
}
