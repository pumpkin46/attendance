<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RecognitionEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'camera_id', 'employee_id', 'result', 'confidence',
        'liveness_passed', 'processing_ms', 'image_hash', 'snapshot_path',
        'metadata', 'recognized_at', 'notified_at',
    ];

    protected function casts(): array
    {
        return [
            'confidence' => 'decimal:4',
            'liveness_passed' => 'boolean',
            'metadata' => 'array',
            'recognized_at' => 'datetime',
            'notified_at' => 'datetime',
        ];
    }

    public function snapshotUrl(): ?string
    {
        if (! $this->snapshot_path) {
            return null;
        }

        return url("/api/v1/recognition/events/{$this->id}/snapshot");
    }

    public function camera(): BelongsTo
    {
        return $this->belongsTo(Camera::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
