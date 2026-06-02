<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FaceEnrollmentImage extends Model
{
    protected $fillable = [
        'face_enrollment_session_id', 'image_index', 'pose_type', 'storage_path',
        'quality_score', 'validation_checks', 'face_metadata',
    ];

    protected function casts(): array
    {
        return [
            'quality_score' => 'decimal:4',
            'validation_checks' => 'array',
            'face_metadata' => 'array',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(FaceEnrollmentSession::class, 'face_enrollment_session_id');
    }
}
