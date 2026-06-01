<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceRecord extends Model
{
    protected $fillable = [
        'employee_id', 'location_id', 'camera_id', 'work_date',
        'check_in_at', 'check_out_at', 'check_in_method', 'check_out_method',
        'worked_minutes', 'overtime_minutes', 'status', 'notes',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date',
            'check_in_at' => 'datetime',
            'check_out_at' => 'datetime',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function camera(): BelongsTo
    {
        return $this->belongsTo(Camera::class);
    }
}
