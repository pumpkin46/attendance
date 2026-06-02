<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BuildingConnector extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'organization_id', 'location_id', 'name', 'driver', 'endpoint_url',
        'api_secret', 'subscribed_events', 'settings', 'is_active', 'last_sync_at',
    ];

    protected $hidden = ['api_secret'];

    protected function casts(): array
    {
        return [
            'subscribed_events' => 'array',
            'settings' => 'array',
            'is_active' => 'boolean',
            'last_sync_at' => 'datetime',
        ];
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(BuildingEvent::class);
    }

    public function subscribesTo(string $eventType): bool
    {
        $events = $this->subscribed_events
            ?? config('building.default_subscribed_events', []);

        return in_array($eventType, $events, true);
    }
}
