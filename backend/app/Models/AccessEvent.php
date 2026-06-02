<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccessEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'access_point_id', 'employee_id', 'visitor_id', 'action', 'granted',
        'deny_reason', 'confidence', 'liveness_passed', 'metadata', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'granted' => 'boolean',
            'liveness_passed' => 'boolean',
            'confidence' => 'decimal:4',
            'metadata' => 'array',
            'occurred_at' => 'datetime',
        ];
    }

    public function accessPoint(): BelongsTo
    {
        return $this->belongsTo(AccessPoint::class);
    }
}
