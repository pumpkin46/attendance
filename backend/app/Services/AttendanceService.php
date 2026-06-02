<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\RecognitionEvent;
use App\Models\RfidEvent;
use App\Models\RfidReader;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AttendanceService
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly UnknownFaceService $unknownFaces,
        private readonly AttendancePolicyService $policies,
        private readonly LiveEventService $liveEvents,
    ) {}

    public function processRecognition(
        Employee $employee,
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        string $imageHash,
        string $source = 'cloud',
        ?array $extraMetadata = null,
    ): array {
        $window = config('attendance.duplicate_window_seconds', 60);
        $cacheKey = "attendance:dup:{$employee->id}";

        if (Cache::has($cacheKey)) {
            return ['action' => 'duplicate_ignored', 'employee_id' => $employee->id];
        }

        Cache::put($cacheKey, true, $window);

        $now = now();
        $workDate = $now->toDateString();
        $requireLiveness = config('attendance.auto_check_in.requires_liveness_passed', true);

        $checkInGate = $this->policies->canAutoCheckIn(
            $employee,
            $confidence,
            $livenessPassed,
            $requireLiveness,
        );

        return DB::transaction(function () use ($employee, $camera, $confidence, $livenessPassed, $processingMs, $imageHash, $now, $workDate, $source, $extraMetadata, $checkInGate) {
            $attendanceType = $this->policies->resolveAttendanceType($employee, $now, 'check_in');
            if (in_array($attendanceType, ['holiday', 'sick_leave', 'vacation', 'remote_work', 'on_leave'], true)) {
                RecognitionEvent::create([
                    'camera_id' => $camera?->id,
                    'employee_id' => $employee->id,
                    'result' => 'matched',
                    'confidence' => $confidence,
                    'liveness_passed' => $livenessPassed,
                    'processing_ms' => $processingMs,
                    'image_hash' => $imageHash,
                    'metadata' => array_merge([
                        'skipped' => $attendanceType,
                        'source' => $source,
                    ], $extraMetadata ?? []),
                    'recognized_at' => $now,
                ]);

                return ['action' => 'skipped_'.$attendanceType, 'employee_id' => $employee->id];
            }

            $shift = $this->policies->resolveShift($employee, $now);
            $record = AttendanceRecord::firstOrCreate(
                ['employee_id' => $employee->id, 'work_date' => $workDate],
                [
                    'location_id' => $employee->location_id ?? $camera?->location_id,
                    'shift_id' => $shift?->id,
                    'status' => 'absent',
                    'attendance_type' => $attendanceType,
                ]
            );

            $action = 'none';

            if (! $record->check_in_at && $this->policies->isEntryZone($camera)) {
                if (! $checkInGate['allowed']) {
                    RecognitionEvent::create([
                        'camera_id' => $camera?->id,
                        'employee_id' => $employee->id,
                        'result' => 'matched',
                        'confidence' => $confidence,
                        'liveness_passed' => $livenessPassed,
                        'processing_ms' => $processingMs,
                        'image_hash' => $imageHash,
                        'metadata' => array_merge([
                            'check_in_denied' => $checkInGate['reason'],
                            'source' => $source,
                        ], $extraMetadata ?? []),
                        'recognized_at' => $now,
                    ]);

                    return [
                        'action' => 'check_in_denied',
                        'reason' => $checkInGate['reason'],
                        'employee_id' => $employee->id,
                    ];
                }

                $status = $this->policies->resolveCheckInStatus($employee, $now);
                $record->update([
                    'check_in_at' => $now,
                    'check_in_method' => 'face',
                    'camera_id' => $camera?->id,
                    'shift_id' => $shift?->id,
                    'location_id' => $record->location_id ?? $camera?->location_id,
                    'status' => $status,
                    'attendance_type' => $status,
                ]);
                $action = 'check_in';
                $this->recordAttendanceLiveEvent($employee, $action, $camera);
            } elseif ($record->check_in_at && ! $record->check_out_at) {
                $checkOutGate = $this->policies->canAutoCheckOut($employee, $camera, $now, true);
                if ($checkOutGate['allowed']) {
                    $record->update([
                        'check_out_at' => $now,
                        'check_out_method' => 'face',
                    ]);
                    $this->calculateWorkedTime($record->fresh());
                    $action = 'check_out';
                    $this->recordAttendanceLiveEvent($employee, $action, $camera);
                }
            }

            RecognitionEvent::create([
                'camera_id' => $camera?->id,
                'employee_id' => $employee->id,
                'result' => 'matched',
                'confidence' => $confidence,
                'liveness_passed' => $livenessPassed,
                'processing_ms' => $processingMs,
                'image_hash' => $imageHash,
                'metadata' => array_merge(['attendance_action' => $action, 'source' => $source], $extraMetadata ?? []),
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

    public function processRfidTap(
        Employee $employee,
        RfidReader $reader,
        string $uid,
        ?Carbon $tappedAt = null,
    ): array {
        $window = config('attendance.rfid_duplicate_window_seconds', 60);
        $cacheKey = "attendance:rfid:dup:{$employee->id}";

        if (Cache::has($cacheKey)) {
            $this->recordRfidEvent($reader, $uid, 'duplicate_ignored', $employee, $tappedAt);

            return ['action' => 'duplicate_ignored', 'employee_id' => $employee->id];
        }

        Cache::put($cacheKey, true, $window);

        $now = $tappedAt ?? now();
        $workDate = $now->toDateString();

        return DB::transaction(function () use ($employee, $reader, $uid, $now, $workDate) {
            $attendanceType = $this->policies->resolveAttendanceType($employee, $now, 'check_in');
            if (in_array($attendanceType, ['holiday', 'sick_leave', 'vacation', 'remote_work', 'on_leave'], true)) {
                $this->recordRfidEvent($reader, $uid, 'matched', $employee, $now, [
                    'skipped' => $attendanceType,
                ]);

                return ['action' => 'skipped_'.$attendanceType, 'employee_id' => $employee->id];
            }

            $shift = $this->policies->resolveShift($employee, $now);
            $record = AttendanceRecord::firstOrCreate(
                ['employee_id' => $employee->id, 'work_date' => $workDate],
                [
                    'location_id' => $employee->location_id ?? $reader->location_id,
                    'shift_id' => $shift?->id,
                    'status' => 'absent',
                ]
            );

            $action = 'none';
            $isEntry = in_array($reader->direction, ['in', 'both'], true);
            $isExit = in_array($reader->direction, ['out', 'both'], true);

            if ($isEntry && ! $record->check_in_at) {
                $status = $this->policies->resolveCheckInStatus($employee, $now);
                $record->update([
                    'check_in_at' => $now,
                    'check_in_method' => 'rfid',
                    'location_id' => $record->location_id ?? $reader->location_id,
                    'shift_id' => $shift?->id,
                    'status' => $status,
                    'attendance_type' => $status,
                ]);
                $action = 'check_in';
            } elseif ($isExit && $record->check_in_at && ! $record->check_out_at) {
                $policy = $this->policies->forEmployee($employee);
                $exitOk = in_array($reader->direction, ['out', 'both'], true);
                if (! $policy->auto_checkout_exit_zone || $exitOk) {
                    $record->update([
                        'check_out_at' => $now,
                        'check_out_method' => 'rfid',
                    ]);
                    $this->calculateWorkedTime($record->fresh());
                    $action = 'check_out';
                }
            }

            $this->recordRfidEvent($reader, $uid, 'matched', $employee, $now, [
                'attendance_action' => $action,
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

    public function recordRfidEvent(
        RfidReader $reader,
        string $uid,
        string $result,
        ?Employee $employee = null,
        ?Carbon $tappedAt = null,
        ?array $metadata = null,
    ): RfidEvent {
        return RfidEvent::create([
            'rfid_reader_id' => $reader->id,
            'employee_id' => $employee?->id,
            'uid' => $uid,
            'result' => $result,
            'metadata' => $metadata,
            'tapped_at' => $tappedAt ?? now(),
        ]);
    }

    public function processEdgeRecognition(
        Employee $employee,
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        int $edgeDeviceId,
    ): array {
        $imageHash = hash('sha256', "edge:{$edgeDeviceId}:{$employee->id}:".now()->timestamp);

        return $this->processRecognition(
            $employee,
            $camera,
            $confidence,
            $livenessPassed,
            $processingMs,
            $imageHash,
            'edge',
            ['edge_device_id' => $edgeDeviceId],
        );
    }

    public function recordEdgeUnknown(
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        int $edgeDeviceId,
    ): RecognitionEvent {
        $imageHash = hash('sha256', "edge:unknown:{$edgeDeviceId}:".now()->timestamp);

        return RecognitionEvent::create([
            'camera_id' => $camera?->id,
            'result' => 'unknown',
            'confidence' => $confidence,
            'liveness_passed' => $livenessPassed,
            'processing_ms' => $processingMs,
            'image_hash' => $imageHash,
            'metadata' => [
                'source' => 'edge',
                'edge_device_id' => $edgeDeviceId,
            ],
            'recognized_at' => now(),
        ]);
    }

    public function recordUnknown(
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        string $imageHash,
        ?string $imageBase64 = null,
        ?string $source = null,
    ): RecognitionEvent {
        return $this->unknownFaces->record(
            $camera,
            $confidence,
            $livenessPassed,
            $processingMs,
            $imageHash,
            $imageBase64,
            $source,
        );
    }

    private function recordAttendanceLiveEvent(Employee $employee, string $action, ?Camera $camera): void
    {
        $time = now()->format('H:i');
        $name = trim("{$employee->first_name} {$employee->last_name}");
        $label = $action === 'check_out' ? 'Checked Out' : 'Checked In';

        $this->liveEvents->record(
            $action === 'check_out' ? 'check_out' : 'check_in',
            "{$time} {$name} {$label}",
            $employee->organization_id,
            [
                'employee_id' => $employee->id,
                'camera_id' => $camera?->id,
            ],
        );
    }

    public function calculateWorkedTime(AttendanceRecord $record): void
    {
        if (! $record->check_in_at || ! $record->check_out_at) {
            return;
        }

        $employee = $record->employee ?? Employee::find($record->employee_id);
        if (! $employee) {
            return;
        }

        $times = $this->policies->calculateWorkedAndOvertime(
            $employee,
            $record->check_in_at,
            $record->check_out_at,
        );

        $status = $this->policies->resolveCheckOutStatus(
            $employee,
            $record->check_in_at,
            $record->check_out_at,
            $times['worked_minutes'],
        );

        $record->update([
            'worked_minutes' => $times['worked_minutes'],
            'overtime_minutes' => $times['overtime_minutes'],
            'status' => $status,
            'attendance_type' => $status,
        ]);
    }
}
