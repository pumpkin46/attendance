<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AccessPoint extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'organization_id', 'location_id', 'camera_id', 'name', 'device_type',
        'default_action', 'controller_url', 'require_liveness', 'min_confidence', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'require_liveness' => 'boolean',
            'is_active' => 'boolean',
            'min_confidence' => 'decimal:4',
        ];
    }

    public function camera(): BelongsTo
    {
        return $this->belongsTo(Camera::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(AccessEvent::class);
    }
}
