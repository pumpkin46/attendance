<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RecognitionEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'camera_id', 'employee_id', 'result', 'confidence',
        'liveness_passed', 'processing_ms', 'image_hash', 'metadata', 'recognized_at',
    ];

    protected function casts(): array
    {
        return [
            'confidence' => 'decimal:4',
            'liveness_passed' => 'boolean',
            'metadata' => 'array',
            'recognized_at' => 'datetime',
        ];
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
