<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Camera extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_INACTIVE = 'inactive';

    public const STATUS_MAINTENANCE = 'maintenance';

    protected $fillable = [
        'location_id', 'name', 'device_id', 'stream_url',
        'direction', 'status', 'is_active', 'last_heartbeat_at',
        'frame_rate_fps', 'last_frame_at',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'last_heartbeat_at' => 'datetime',
            'last_frame_at' => 'datetime',
            'frame_rate_fps' => 'decimal:2',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (Camera $camera) {
            if ($camera->isDirty('status')) {
                $camera->is_active = $camera->status === self::STATUS_ACTIVE;
            } elseif ($camera->isDirty('is_active') && ! $camera->isDirty('status')) {
                $camera->status = $camera->is_active ? self::STATUS_ACTIVE : self::STATUS_INACTIVE;
            }
        });
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function recognitionEvents(): HasMany
    {
        return $this->hasMany(RecognitionEvent::class);
    }
}
