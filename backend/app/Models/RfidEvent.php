<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RfidEvent extends Model
{
    protected $fillable = [
        'rfid_reader_id', 'employee_id', 'uid', 'result', 'metadata', 'tapped_at',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'tapped_at' => 'datetime',
        ];
    }

    public function reader(): BelongsTo
    {
        return $this->belongsTo(RfidReader::class, 'rfid_reader_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
