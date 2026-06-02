<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FaceEnrollmentSession extends Model
{
    protected $fillable = [
        'employee_id', 'image_count', 'average_quality_score', 'enrollment_score',
        'version', 'enrollment_mode', 'raw_images_retained',
    ];

    protected function casts(): array
    {
        return [
            'average_quality_score' => 'decimal:4',
            'enrollment_score' => 'decimal:4',
            'raw_images_retained' => 'boolean',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function images(): HasMany
    {
        return $this->hasMany(FaceEnrollmentImage::class);
    }

    public function embeddings(): HasMany
    {
        return $this->hasMany(FaceEmbedding::class);
    }
}
