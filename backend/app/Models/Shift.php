<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Shift extends Model
{
    use BelongsToTenant;

    public const TYPE_FIXED = 'fixed';

    public const TYPE_ROTATIONAL = 'rotational';

    public const TYPE_FLEXIBLE = 'flexible';

    public const TYPE_SPLIT = 'split';

    protected $fillable = [
        'organization_id', 'attendance_policy_id', 'name', 'type', 'rotation_slot',
        'start_time', 'end_time', 'segments', 'grace_minutes', 'break_minutes',
        'min_work_minutes', 'max_work_minutes', 'days_of_week', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'days_of_week' => 'array',
            'segments' => 'array',
            'is_active' => 'boolean',
        ];
    }

    public function attendancePolicy(): BelongsTo
    {
        return $this->belongsTo(AttendancePolicy::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ShiftAssignment::class);
    }
}
