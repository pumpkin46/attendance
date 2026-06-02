<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FaceEmbedding extends Model
{
    protected $fillable = [
        'employee_id', 'face_enrollment_session_id', 'faiss_id',
        'quality_score', 'image_index', 'pose_type', 'face_metadata',
        'version', 'is_primary',
    ];

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'quality_score' => 'decimal:4',
            'face_metadata' => 'array',
        ];
    }

    public function enrollmentSession(): BelongsTo
    {
        return $this->belongsTo(FaceEnrollmentSession::class, 'face_enrollment_session_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
