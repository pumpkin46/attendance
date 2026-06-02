<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CameraHealthLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'camera_id', 'online', 'frame_rate_fps', 'latency_ms', 'bandwidth_kbps',
        'cpu_usage_percent', 'gpu_usage_percent', 'dropped_frames',
        'recognition_events', 'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'online' => 'boolean',
            'frame_rate_fps' => 'decimal:2',
            'cpu_usage_percent' => 'decimal:2',
            'gpu_usage_percent' => 'decimal:2',
            'recorded_at' => 'datetime',
        ];
    }

    public function camera(): BelongsTo
    {
        return $this->belongsTo(Camera::class);
    }
}
