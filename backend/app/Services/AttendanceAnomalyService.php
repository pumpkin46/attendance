<?php

namespace App\Services;

use App\Models\AttendanceAnomaly;
use App\Models\AttendanceRecord;
use App\Models\RecognitionEvent;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class AttendanceAnomalyService
{
    public function __construct(private readonly AiRecognitionClient $ai) {}

    public function detect(string $dateFrom, string $dateTo, ?int $locationId = null): array
    {
        $records = AttendanceRecord::with([
            'employee.shiftAssignments.shift',
        ])
            ->whereBetween('work_date', [$dateFrom, $dateTo])
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('work_date')
            ->get();

        if ($records->isEmpty()) {
            return [
                'run_id' => null,
                'records_analyzed' => 0,
                'anomalies_found' => 0,
                'anomalies_created' => 0,
                'anomalies_updated' => 0,
            ];
        }

        $recognitionCounts = $this->recognitionCountsByEmployeeDate($records);
        $payload = $records->map(fn (AttendanceRecord $r) => $this->buildRecordPayload(
            $r,
            $recognitionCounts
        ))->values()->all();

        $result = $this->ai->analyzeAnomalies($payload, $this->detectionConfig());

        if (! ($result['success'] ?? false)) {
            throw new \RuntimeException($result['error'] ?? 'Anomaly analysis failed');
        }

        $runId = (string) Str::uuid();
        $created = 0;
        $updated = 0;

        foreach ($result['anomalies'] ?? [] as $anomaly) {
            $wasUpdated = $this->persistAnomaly($anomaly, $runId);
            $wasUpdated ? $updated++ : $created++;
        }

        return [
            'run_id' => $runId,
            'records_analyzed' => $result['records_analyzed'] ?? count($payload),
            'anomalies_found' => $result['anomaly_count'] ?? count($result['anomalies'] ?? []),
            'anomalies_created' => $created,
            'anomalies_updated' => $updated,
            'processing_ms' => $result['processing_ms'] ?? 0,
            'period' => ['from' => $dateFrom, 'to' => $dateTo],
        ];
    }

    public function summary(): array
    {
        $open = AttendanceAnomaly::where('status', 'open')->get();

        return [
            'open_total' => $open->count(),
            'critical' => $open->where('severity', 'critical')->count(),
            'high' => $open->where('severity', 'high')->count(),
            'medium' => $open->where('severity', 'medium')->count(),
            'low' => $open->where('severity', 'low')->count(),
            'by_type' => $open->groupBy('anomaly_type')->map->count(),
        ];
    }

    private function buildRecordPayload(AttendanceRecord $record, Collection $recognitionCounts): array
    {
        $shiftStart = $this->resolveShiftStartHour($record);
        $key = $record->employee_id.'|'.$record->work_date->toDateString();

        return [
            'record_id' => $record->id,
            'employee_id' => $record->employee_id,
            'work_date' => $record->work_date->toDateString(),
            'check_in_at' => $record->check_in_at?->toIso8601String(),
            'check_out_at' => $record->check_out_at?->toIso8601String(),
            'check_in_hour' => $record->check_in_at
                ? $record->check_in_at->hour + ($record->check_in_at->minute / 60)
                : null,
            'shift_start_hour' => $shiftStart,
            'worked_minutes' => $record->worked_minutes,
            'overtime_minutes' => $record->overtime_minutes,
            'status' => $record->status,
            'check_in_method' => $record->check_in_method,
            'day_of_week' => $record->work_date->dayOfWeekIso,
            'recognition_events_count' => (int) ($recognitionCounts->get($key) ?? 0),
        ];
    }

    private function resolveShiftStartHour(AttendanceRecord $record): ?float
    {
        $assignment = $record->employee?->shiftAssignments
            ?->where('effective_from', '<=', $record->work_date)
            ->filter(fn ($a) => ! $a->effective_to || $a->effective_to >= $record->work_date)
            ->sortByDesc('effective_from')
            ->first();

        if (! $assignment?->shift?->start_time) {
            return null;
        }

        $parts = explode(':', $assignment->shift->start_time);

        return (int) $parts[0] + ((int) ($parts[1] ?? 0) / 60);
    }

    private function recognitionCountsByEmployeeDate(Collection $records): Collection
    {
        if ($records->isEmpty()) {
            return collect();
        }

        $from = $records->min(fn (AttendanceRecord $r) => $r->work_date->toDateString());
        $to = $records->max(fn (AttendanceRecord $r) => $r->work_date->toDateString());
        $employeeIds = $records->pluck('employee_id')->unique();

        return RecognitionEvent::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereBetween('recognized_at', [
                Carbon::parse($from)->startOfDay(),
                Carbon::parse($to)->endOfDay(),
            ])
            ->where('result', 'matched')
            ->get()
            ->groupBy(fn (RecognitionEvent $e) => $e->employee_id.'|'.$e->recognized_at->toDateString())
            ->map->count();
    }

    private function persistAnomaly(array $anomaly, string $runId): bool
    {
        $keys = [
            'employee_id' => $anomaly['employee_id'],
            'anomaly_type' => $anomaly['anomaly_type'],
            'status' => 'open',
        ];

        if (! empty($anomaly['record_id'])) {
            $keys['attendance_record_id'] = $anomaly['record_id'];
        }

        $existing = AttendanceAnomaly::where($keys)->first();

        $data = [
            'severity' => $anomaly['severity'],
            'score' => $anomaly['score'],
            'title' => $anomaly['title'],
            'description' => $anomaly['description'],
            'evidence' => $anomaly['evidence'] ?? [],
            'detection_run_id' => $runId,
            'detected_at' => now(),
        ];

        if ($existing) {
            $existing->update($data);

            return true;
        }

        AttendanceAnomaly::create(array_merge($keys, $data));

        return false;
    }

    private function detectionConfig(): array
    {
        return [
            'overtime_threshold_minutes' => config('attendance.anomaly_overtime_minutes', 600),
            'check_in_deviation_minutes' => config('attendance.anomaly_check_in_deviation_minutes', 120),
            'ml_min_samples' => config('attendance.anomaly_ml_min_samples', 15),
            'ml_contamination' => config('attendance.anomaly_ml_contamination', 0.08),
        ];
    }
}
