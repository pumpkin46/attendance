<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AttendancePolicy extends Model
{
    protected $fillable = [
        'organization_id', 'name', 'grace_minutes', 'min_work_minutes', 'max_work_minutes',
        'break_minutes', 'overtime_after_minutes', 'overtime_multiplier',
        'night_shift_start', 'night_shift_end', 'night_shift_multiplier',
        'weekend_days', 'weekend_multiplier', 'holiday_paid',
        'auto_checkout_exit_zone', 'require_liveness_checkin', 'min_confidence',
        'half_day_minutes', 'is_default', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'weekend_days' => 'array',
            'holiday_paid' => 'boolean',
            'auto_checkout_exit_zone' => 'boolean',
            'require_liveness_checkin' => 'boolean',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            'min_confidence' => 'decimal:4',
            'overtime_multiplier' => 'decimal:2',
            'night_shift_multiplier' => 'decimal:2',
            'weekend_multiplier' => 'decimal:2',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }
}
