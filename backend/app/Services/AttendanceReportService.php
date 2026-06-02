<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\Holiday;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Support\Collection;

class AttendanceReportService
{
    /** @var array<int> Default Mon–Fri working days */
    private array $defaultWorkingDays = [1, 2, 3, 4, 5];

    public function daily(string $date, ?int $locationId = null): array
    {
        $records = AttendanceRecord::with('employee')
            ->where('work_date', $date)
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id))
            ->get();

        $present = $records->where('status', 'present')->count();
        $late = $records->where('status', 'late')->count();
        $absent = $records->where('status', 'absent')->count();
        $onLeave = $records->where('status', 'on_leave')->count();

        return [
            'date' => $date,
            'present' => $present,
            'absent' => $absent,
            'late' => $late,
            'on_leave' => $onLeave,
            'total_records' => $records->count(),
            'employees' => $records->map(fn (AttendanceRecord $r) => [
                'employee_code' => $r->employee->employee_code,
                'employee_name' => $r->employee->full_name,
                'status' => $r->status,
                'check_in_at' => $r->check_in_at?->toIso8601String(),
                'check_out_at' => $r->check_out_at?->toIso8601String(),
                'worked_minutes' => $r->worked_minutes,
                'overtime_minutes' => $r->overtime_minutes,
            ])->values(),
        ];
    }

    public function monthly(int $year, int $month, ?int $locationId = null): array
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end = $start->copy()->endOfMonth();
        $workingDays = $this->countWorkingDays($start, $end);

        $records = AttendanceRecord::with('employee')
            ->whereBetween('work_date', [$start->toDateString(), $end->toDateString()])
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id))
            ->get();

        $employees = Employee::query()
            ->where('is_active', true)
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('employee_code')
            ->get();

        $byEmployee = $records->groupBy('employee_id');

        $rows = $employees->map(function (Employee $employee) use ($byEmployee, $workingDays) {
            $empRecords = $byEmployee->get($employee->id, collect());
            $presentDays = $empRecords->whereIn('status', ['present', 'late'])->count();
            $absenceCount = $empRecords->where('status', 'absent')->count();
            $overtimeMinutes = (int) $empRecords->sum('overtime_minutes');
            $attendancePercent = $workingDays > 0
                ? round(($presentDays / $workingDays) * 100, 1)
                : 0.0;

            return [
                'employee_id' => $employee->id,
                'employee_code' => $employee->employee_code,
                'employee_name' => $employee->full_name,
                'department' => $employee->department,
                'total_working_days' => $workingDays,
                'present_days' => $presentDays,
                'attendance_percent' => $attendancePercent,
                'overtime_minutes' => $overtimeMinutes,
                'overtime_hours' => round($overtimeMinutes / 60, 1),
                'absence_count' => $absenceCount,
                'late_count' => $empRecords->where('status', 'late')->count(),
                'on_leave_count' => $empRecords->where('status', 'on_leave')->count(),
            ];
        });

        $totalPresent = $records->whereIn('status', ['present', 'late'])->count();
        $totalPossible = $workingDays * max($employees->count(), 1);

        return [
            'year' => $year,
            'month' => $month,
            'period' => [
                'from' => $start->toDateString(),
                'to' => $end->toDateString(),
            ],
            'total_working_days' => $workingDays,
            'employee_count' => $employees->count(),
            'summary' => [
                'total_working_days' => $workingDays,
                'attendance_percent' => $totalPossible > 0
                    ? round(($totalPresent / $totalPossible) * 100, 1)
                    : 0.0,
                'overtime_minutes' => (int) $records->sum('overtime_minutes'),
                'absence_count' => $records->where('status', 'absent')->count(),
            ],
            'employees' => $rows->values(),
        ];
    }

    public function detailRows(string $dateFrom, string $dateTo, ?int $locationId = null): Collection
    {
        return AttendanceRecord::with('employee')
            ->whereBetween('work_date', [$dateFrom, $dateTo])
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('work_date')
            ->orderBy('employee_id')
            ->get()
            ->map(fn (AttendanceRecord $r) => [
                'work_date' => $r->work_date->toDateString(),
                'employee_code' => $r->employee->employee_code,
                'employee_name' => $r->employee->full_name,
                'department' => $r->employee->department ?? '',
                'check_in' => $r->check_in_at?->format('Y-m-d H:i:s') ?? '',
                'check_out' => $r->check_out_at?->format('Y-m-d H:i:s') ?? '',
                'worked_minutes' => $r->worked_minutes,
                'overtime_minutes' => $r->overtime_minutes,
                'status' => $r->status,
            ]);
    }

    public function countWorkingDays(Carbon $from, Carbon $to, ?int $organizationId = null): int
    {
        $holidays = Holiday::query()
            ->when($organizationId, fn ($q, $id) => $q->where('organization_id', $id))
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])
            ->pluck('date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->all();

        $count = 0;
        foreach (CarbonPeriod::create($from, $to) as $day) {
            if (! in_array($day->dayOfWeekIso, $this->defaultWorkingDays, true)) {
                continue;
            }
            if (in_array($day->toDateString(), $holidays, true)) {
                continue;
            }
            $count++;
        }

        return $count;
    }
}
