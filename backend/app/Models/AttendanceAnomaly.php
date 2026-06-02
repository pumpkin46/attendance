<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceAnomaly extends Model
{
    protected $fillable = [
        'attendance_record_id', 'employee_id', 'anomaly_type', 'severity', 'score',
        'title', 'description', 'evidence', 'status', 'detection_run_id',
        'detected_at', 'acknowledged_at', 'acknowledged_by', 'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'score' => 'float',
            'evidence' => 'array',
            'detected_at' => 'datetime',
            'acknowledged_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function attendanceRecord(): BelongsTo
    {
        return $this->belongsTo(AttendanceRecord::class);
    }

    public function acknowledgedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'acknowledged_by');
    }
}
