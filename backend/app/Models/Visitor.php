<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Visitor extends Model
{
    protected $fillable = [
        'organization_id', 'host_employee_id', 'name', 'company', 'phone', 'purpose',
        'visit_start_at', 'visit_end_at', 'status', 'face_registered',
        'ai_identity_id', 'face_expires_at',
    ];

    protected function casts(): array
    {
        return [
            'visit_start_at' => 'datetime',
            'visit_end_at' => 'datetime',
            'face_expires_at' => 'datetime',
            'face_registered' => 'boolean',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'host_employee_id');
    }

    public function aiIdentityId(): string
    {
        return $this->ai_identity_id ?? 'visitor-'.$this->id;
    }

    public function isActive(): bool
    {
        return in_array($this->status, ['scheduled', 'checked_in'], true)
            && ($this->face_expires_at === null || $this->face_expires_at->isFuture());
    }
}
