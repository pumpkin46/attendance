<?php

namespace App\Services;

use App\Models\AttendancePolicy;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\Shift;
use App\Models\ShiftAssignment;
use Carbon\Carbon;

class AttendancePolicyService
{
    public function forEmployee(Employee $employee): AttendancePolicy
    {
        $assignment = $this->activeShiftAssignment($employee, now());
        if ($assignment?->shift?->attendancePolicy) {
            return $assignment->shift->attendancePolicy;
        }

        $policy = AttendancePolicy::query()
            ->where('organization_id', $employee->organization_id)
            ->where('is_default', true)
            ->where('is_active', true)
            ->first();

        if ($policy) {
            return $policy;
        }

        return $this->syntheticPolicy($employee->organization_id);
    }

    /** Automatic check-in: recognized + confidence + liveness (§5). */
    public function canAutoCheckIn(
        Employee $employee,
        float $confidence,
        bool $livenessPassed,
        bool $requireLiveness,
    ): array {
        $policy = $this->forEmployee($employee);
        $minConfidence = (float) $policy->min_confidence;

        if ($confidence < $minConfidence) {
            return ['allowed' => false, 'reason' => 'confidence_below_threshold'];
        }

        if ($requireLiveness && $policy->require_liveness_checkin && ! $livenessPassed) {
            return ['allowed' => false, 'reason' => 'liveness_not_passed'];
        }

        return ['allowed' => true, 'reason' => null, 'policy_id' => $policy->id];
    }

    /** Automatic check-out: recognized at exit zone + configured rules (§5). */
    public function canAutoCheckOut(
        Employee $employee,
        ?Camera $camera,
        Carbon $now,
        bool $hasCheckIn,
    ): array {
        if (! $hasCheckIn) {
            return ['allowed' => false, 'reason' => 'no_check_in'];
        }

        $policy = $this->forEmployee($employee);

        if ($policy->auto_checkout_exit_zone && ! $this->isExitZone($camera)) {
            return ['allowed' => false, 'reason' => 'not_exit_zone'];
        }

        return ['allowed' => true, 'reason' => null, 'policy_id' => $policy->id];
    }

    public function isExitZone(?Camera $camera): bool
    {
        if (! $camera) {
            return true;
        }

        return in_array($camera->direction, ['out', 'both'], true);
    }

    public function isEntryZone(?Camera $camera): bool
    {
        if (! $camera) {
            return true;
        }

        return in_array($camera->direction, ['in', 'both'], true);
    }

    public function resolveAttendanceType(Employee $employee, Carbon $moment, string $phase): string
    {
        $workDate = $moment->toDateString();

        if ($this->isHoliday($employee, $workDate)) {
            return 'holiday';
        }

        $leaveType = $this->approvedLeaveType($employee, $workDate);
        if ($leaveType) {
            return match ($leaveType) {
                'sick' => 'sick_leave',
                'annual' => 'vacation',
                'remote' => 'remote_work',
                default => 'on_leave',
            };
        }

        if ($phase === 'check_in') {
            return $this->resolveCheckInStatus($employee, $moment);
        }

        return 'present';
    }

    public function resolveCheckInStatus(Employee $employee, Carbon $checkIn): string
    {
        $shift = $this->resolveShift($employee, $checkIn);
        if (! $shift) {
            return 'present';
        }

        $shiftStart = $this->shiftStartOnDate($shift, $employee, $checkIn);
        $graceEnd = $shiftStart->copy()->addMinutes($shift->grace_minutes ?? 15);

        return $checkIn->gt($graceEnd) ? 'late' : 'present';
    }

    public function resolveCheckOutStatus(
        Employee $employee,
        Carbon $checkIn,
        Carbon $checkOut,
        int $workedMinutes,
    ): string {
        $policy = $this->forEmployee($employee);
        $shift = $this->resolveShift($employee, $checkIn);

        if ($workedMinutes < ($policy->half_day_minutes ?? 240)) {
            return 'half_day';
        }

        if ($shift) {
            $shiftEnd = $this->shiftEndOnDate($shift, $employee, $checkIn);
            $earlyThreshold = $shiftEnd->copy()->subMinutes($policy->grace_minutes ?? 15);
            if ($checkOut->lt($earlyThreshold)) {
                return 'early_leave';
            }
        }

        $checkInStatus = $this->resolveCheckInStatus($employee, $checkIn);

        return $checkInStatus === 'late' ? 'late' : 'present';
    }

    public function calculateWorkedAndOvertime(
        Employee $employee,
        Carbon $checkIn,
        Carbon $checkOut,
    ): array {
        $policy = $this->forEmployee($employee);
        $gross = (int) round($checkIn->diffInMinutes($checkOut));
        $break = (int) ($policy->break_minutes ?? 0);
        $worked = max(0, $gross - $break);

        $overtimeAfter = (int) ($policy->overtime_after_minutes
            ?? config('attendance.overtime_threshold_minutes', 480));
        $overtime = max(0, $worked - $overtimeAfter);

        if ($this->isWeekend($policy, $checkIn)) {
            $overtime = (int) round($worked * (($policy->weekend_multiplier ?? 1.5) - 1));
        }

        if ($this->isNightShiftWindow($policy, $checkIn, $checkOut)) {
            $overtime = max($overtime, (int) round($worked * 0.25));
        }

        $maxWork = (int) ($policy->max_work_minutes ?? 600);
        $worked = min($worked, $maxWork);

        return ['worked_minutes' => $worked, 'overtime_minutes' => $overtime];
    }

    public function activeShiftAssignment(Employee $employee, Carbon $date): ?ShiftAssignment
    {
        return $employee->shiftAssignments()
            ->where('effective_from', '<=', $date->toDateString())
            ->where(function ($q) use ($date) {
                $q->whereNull('effective_to')->orWhere('effective_to', '>=', $date->toDateString());
            })
            ->with(['shift.attendancePolicy'])
            ->first();
    }

    public function resolveShift(Employee $employee, Carbon $moment): ?Shift
    {
        return $this->activeShiftAssignment($employee, $moment)?->shift;
    }

    public function shiftStartOnDate(Shift $shift, Employee $employee, Carbon $date): Carbon
    {
        $assignment = $this->activeShiftAssignment($employee, $date);

        if ($shift->type === 'flexible' && $assignment?->flex_start_time) {
            return Carbon::parse($date->toDateString().' '.$assignment->flex_start_time);
        }

        if ($shift->type === 'split' && is_array($shift->segments) && count($shift->segments) > 0) {
            $first = $shift->segments[0];

            return Carbon::parse($date->toDateString().' '.($first['start'] ?? $shift->start_time));
        }

        return Carbon::parse($date->toDateString().' '.$shift->start_time);
    }

    public function shiftEndOnDate(Shift $shift, Employee $employee, Carbon $date): Carbon
    {
        if ($shift->type === 'split' && is_array($shift->segments) && count($shift->segments) > 0) {
            $last = $shift->segments[count($shift->segments) - 1];

            return Carbon::parse($date->toDateString().' '.($last['end'] ?? $shift->end_time));
        }

        $start = $this->shiftStartOnDate($shift, $employee, $date);
        $end = Carbon::parse($date->toDateString().' '.$shift->end_time);
        if ($end->lte($start)) {
            $end->addDay();
        }

        return $end;
    }

    private function isHoliday(Employee $employee, string $workDate): bool
    {
        return Holiday::where('organization_id', $employee->organization_id)
            ->where(function ($q) use ($employee) {
                $q->whereNull('location_id')->orWhere('location_id', $employee->location_id);
            })
            ->where('date', $workDate)
            ->exists();
    }

    private function approvedLeaveType(Employee $employee, string $workDate): ?string
    {
        $leave = LeaveRequest::where('employee_id', $employee->id)
            ->where('status', 'approved')
            ->where('start_date', '<=', $workDate)
            ->where('end_date', '>=', $workDate)
            ->first();

        return $leave?->type;
    }

    private function isWeekend(AttendancePolicy $policy, Carbon $date): bool
    {
        $days = $policy->weekend_days ?? config('attendance.weekend_days', [0, 6]);

        return in_array($date->dayOfWeek, $days, true);
    }

    private function isNightShiftWindow(AttendancePolicy $policy, Carbon $checkIn, Carbon $checkOut): bool
    {
        if (! $policy->night_shift_start || ! $policy->night_shift_end) {
            return false;
        }

        $nightStart = Carbon::parse($checkIn->toDateString().' '.$policy->night_shift_start);
        $nightEnd = Carbon::parse($checkIn->toDateString().' '.$policy->night_shift_end);
        if ($nightEnd->lte($nightStart)) {
            $nightEnd->addDay();
        }

        return $checkIn->between($nightStart, $nightEnd) || $checkOut->between($nightStart, $nightEnd);
    }

    private function syntheticPolicy(int $organizationId): AttendancePolicy
    {
        $defaults = config('attendance.default_policy');

        return new AttendancePolicy(array_merge($defaults, [
            'organization_id' => $organizationId,
            'name' => 'System Default',
            'is_default' => true,
        ]));
    }
}
