<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EdgeDevice extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_ONLINE = 'online';

    public const STATUS_OFFLINE = 'offline';

    public const STATUS_ERROR = 'error';

    protected $fillable = [
        'camera_id', 'location_id', 'name', 'device_id', 'api_token',
        'stream_url', 'local_ai_url', 'status', 'is_active',
        'poll_interval_seconds', 'require_liveness', 'recognition_threshold',
        'sync_version', 'last_sync_at', 'last_heartbeat_at',
        'frame_rate_fps', 'software_version', 'metadata',
    ];

    protected $hidden = ['api_token'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'require_liveness' => 'boolean',
            'recognition_threshold' => 'float',
            'last_sync_at' => 'datetime',
            'last_heartbeat_at' => 'datetime',
            'frame_rate_fps' => 'decimal:2',
            'metadata' => 'array',
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
}
