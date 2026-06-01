<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\RecognitionEvent;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AttendanceService
{
    public function __construct(
        private readonly AuditService $audit
    ) {}

    public function processRecognition(
        Employee $employee,
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        string $imageHash
    ): array {
        $window = config('attendance.duplicate_window_seconds', 60);
        $cacheKey = "attendance:dup:{$employee->id}";

        if (Cache::has($cacheKey)) {
            return ['action' => 'duplicate_ignored', 'employee_id' => $employee->id];
        }

        Cache::put($cacheKey, true, $window);

        $now = now();
        $workDate = $now->toDateString();
        $direction = $camera?->direction ?? 'both';

        return DB::transaction(function () use ($employee, $camera, $confidence, $livenessPassed, $processingMs, $imageHash, $now, $workDate, $direction) {
            if ($this->isOnLeaveOrHoliday($employee, $workDate)) {
                RecognitionEvent::create([
                    'camera_id' => $camera?->id,
                    'employee_id' => $employee->id,
                    'result' => 'matched',
                    'confidence' => $confidence,
                    'liveness_passed' => $livenessPassed,
                    'processing_ms' => $processingMs,
                    'image_hash' => $imageHash,
                    'metadata' => ['skipped' => 'on_leave_or_holiday'],
                    'recognized_at' => $now,
                ]);

                return ['action' => 'skipped_leave_holiday', 'employee_id' => $employee->id];
            }

            $record = AttendanceRecord::firstOrCreate(
                ['employee_id' => $employee->id, 'work_date' => $workDate],
                [
                    'location_id' => $employee->location_id ?? $camera?->location_id,
                    'status' => 'absent',
                ]
            );

            $action = 'none';

            if (in_array($direction, ['in', 'both'], true) && ! $record->check_in_at) {
                $record->update([
                    'check_in_at' => $now,
                    'check_in_method' => 'face',
                    'camera_id' => $camera?->id,
                    'location_id' => $record->location_id ?? $camera?->location_id,
                    'status' => $this->resolveCheckInStatus($employee, $now),
                ]);
                $action = 'check_in';
            } elseif (in_array($direction, ['out', 'both'], true) && $record->check_in_at && ! $record->check_out_at) {
                $record->update([
                    'check_out_at' => $now,
                    'check_out_method' => 'face',
                ]);
                $this->calculateWorkedTime($record);
                $action = 'check_out';
            }

            RecognitionEvent::create([
                'camera_id' => $camera?->id,
                'employee_id' => $employee->id,
                'result' => 'matched',
                'confidence' => $confidence,
                'liveness_passed' => $livenessPassed,
                'processing_ms' => $processingMs,
                'image_hash' => $imageHash,
                'metadata' => ['attendance_action' => $action],
                'recognized_at' => $now,
            ]);

            if ($action !== 'none') {
                $this->audit->log("attendance.{$action}", $record, null, $record->fresh()->toArray());
            }

            return [
                'action' => $action,
                'employee_id' => $employee->id,
                'record' => $record->fresh()->load('employee'),
            ];
        });
    }

    public function recordUnknown(?Camera $camera, float $confidence, bool $livenessPassed, int $processingMs, string $imageHash): void
    {
        RecognitionEvent::create([
            'camera_id' => $camera?->id,
            'result' => config('attendance.unknown_person_alert') ? 'unknown' : 'low_confidence',
            'confidence' => $confidence,
            'liveness_passed' => $livenessPassed,
            'processing_ms' => $processingMs,
            'image_hash' => $imageHash,
            'recognized_at' => now(),
        ]);
    }

    public function calculateWorkedTime(AttendanceRecord $record): void
    {
        if (! $record->check_in_at || ! $record->check_out_at) {
            return;
        }

        $worked = (int) round($record->check_in_at->diffInMinutes($record->check_out_at));
        $overtimeThreshold = config('attendance.overtime_threshold_minutes', 480);
        $overtime = max(0, $worked - $overtimeThreshold);

        $record->update([
            'worked_minutes' => $worked,
            'overtime_minutes' => (int) $overtime,
            'status' => 'present',
        ]);
    }

    private function isOnLeaveOrHoliday(Employee $employee, string $workDate): bool
    {
        $onLeave = LeaveRequest::where('employee_id', $employee->id)
            ->where('status', 'approved')
            ->where('start_date', '<=', $workDate)
            ->where('end_date', '>=', $workDate)
            ->exists();

        if ($onLeave) {
            return true;
        }

        return Holiday::where('organization_id', $employee->organization_id)
            ->where(function ($q) use ($employee) {
                $q->whereNull('location_id')->orWhere('location_id', $employee->location_id);
            })
            ->where('date', $workDate)
            ->exists();
    }

    private function resolveCheckInStatus(Employee $employee, Carbon $checkIn): string
    {
        $assignment = $employee->shiftAssignments()
            ->where('effective_from', '<=', $checkIn->toDateString())
            ->where(function ($q) use ($checkIn) {
                $q->whereNull('effective_to')->orWhere('effective_to', '>=', $checkIn->toDateString());
            })
            ->with('shift')
            ->first();

        if (! $assignment?->shift) {
            return 'present';
        }

        $shiftStart = Carbon::parse($checkIn->toDateString().' '.$assignment->shift->start_time);
        $graceEnd = $shiftStart->copy()->addMinutes($assignment->shift->grace_minutes);

        return $checkIn->gt($graceEnd) ? 'late' : 'present';
    }
}
