<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RfidReader extends Model
{
    protected $fillable = [
        'location_id', 'name', 'device_id', 'direction',
        'api_token', 'is_active', 'last_heartbeat_at',
    ];

    protected $hidden = ['api_token'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'last_heartbeat_at' => 'datetime',
        ];
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(RfidEvent::class);
    }
}
