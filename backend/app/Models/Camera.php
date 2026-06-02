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

    public const TYPE_RTSP = 'rtsp';

    public const TYPE_IP = 'ip';

    public const TYPE_USB = 'usb';

    public const TYPE_NVR = 'nvr';

    public const TYPE_CCTV = 'cctv';

    public const TYPE_MOBILE = 'mobile';

    protected $fillable = [
        'location_id', 'name', 'camera_type', 'zone', 'floor', 'device_id', 'stream_url',
        'target_fps', 'resolution_width', 'resolution_height',
        'direction', 'deployment_mode', 'status', 'is_active', 'last_heartbeat_at',
        'frame_rate_fps', 'last_frame_at', 'latency_ms', 'bandwidth_kbps',
        'cpu_usage_percent', 'gpu_usage_percent', 'dropped_frames', 'health_updated_at',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'last_heartbeat_at' => 'datetime',
            'last_frame_at' => 'datetime',
            'health_updated_at' => 'datetime',
            'frame_rate_fps' => 'decimal:2',
            'cpu_usage_percent' => 'decimal:2',
            'gpu_usage_percent' => 'decimal:2',
        ];
    }

    public function resolution(): ?string
    {
        if (! $this->resolution_width || ! $this->resolution_height) {
            return null;
        }

        return "{$this->resolution_width}x{$this->resolution_height}";
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

    public function edgeDevice(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(EdgeDevice::class);
    }

    public function healthLogs(): HasMany
    {
        return $this->hasMany(CameraHealthLog::class);
    }
}
