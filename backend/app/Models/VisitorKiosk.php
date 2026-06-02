<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VisitorKiosk extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'organization_id', 'location_id', 'access_point_id', 'name', 'device_id',
        'api_token', 'allow_walk_in', 'require_host', 'require_liveness', 'is_active',
        'last_heartbeat_at',
    ];

    protected $hidden = ['api_token'];

    protected function casts(): array
    {
        return [
            'allow_walk_in' => 'boolean',
            'require_host' => 'boolean',
            'require_liveness' => 'boolean',
            'is_active' => 'boolean',
            'last_heartbeat_at' => 'datetime',
        ];
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function accessPoint(): BelongsTo
    {
        return $this->belongsTo(AccessPoint::class);
    }
}
