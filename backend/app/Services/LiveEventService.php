<?php

namespace App\Services;

use App\Models\LiveEvent;

class LiveEventService
{
    public function record(
        string $eventType,
        string $message,
        ?int $organizationId = null,
        array $context = [],
    ): LiveEvent {
        return LiveEvent::create([
            'organization_id' => $organizationId,
            'event_type' => $eventType,
            'message' => $message,
            'payload' => $context['payload'] ?? null,
            'camera_id' => $context['camera_id'] ?? null,
            'employee_id' => $context['employee_id'] ?? null,
            'visitor_id' => $context['visitor_id'] ?? null,
            'access_point_id' => $context['access_point_id'] ?? null,
            'occurred_at' => $context['occurred_at'] ?? now(),
        ]);
    }
}
