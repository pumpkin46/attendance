<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BuildingEvent extends Model
{
    protected $fillable = [
        'building_connector_id', 'event_type', 'payload', 'status',
        'error_message', 'dispatched_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'dispatched_at' => 'datetime',
        ];
    }

    public function connector(): BelongsTo
    {
        return $this->belongsTo(BuildingConnector::class, 'building_connector_id');
    }
}
