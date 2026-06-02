<?php

namespace App\Services;

use App\Models\BuildingConnector;
use App\Models\BuildingEvent;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class BuildingIntegrationService
{
    public function dispatch(string $eventType, array $payload, ?int $organizationId = null, ?int $locationId = null): void
    {
        if (! config('building.enabled')) {
            return;
        }

        $connectors = BuildingConnector::query()
            ->where('is_active', true)
            ->when($organizationId, fn ($q) => $q->where('organization_id', $organizationId))
            ->when($locationId, fn ($q) => $q->where(function ($inner) use ($locationId) {
                $inner->whereNull('location_id')->orWhere('location_id', $locationId);
            }))
            ->get();

        foreach ($connectors as $connector) {
            if (! $connector->subscribesTo($eventType)) {
                continue;
            }

            $this->sendToConnector($connector, $eventType, $payload);
        }
    }

    public function publishOccupancy(?int $organizationId, ?int $locationId, int $presentCount, int $capacity = 0): void
    {
        $this->dispatch('occupancy_update', [
            'location_id' => $locationId,
            'present_count' => $presentCount,
            'capacity' => $capacity,
            'occupancy_ratio' => $capacity > 0 ? round($presentCount / $capacity, 4) : null,
            'timestamp' => now()->toIso8601String(),
        ], $organizationId, $locationId);
    }

    public function onAccessGranted(array $context): void
    {
        $this->dispatch('access_granted', $context, $context['organization_id'] ?? null, $context['location_id'] ?? null);

        if ($this->isAfterHours()) {
            $this->dispatch('after_hours_entry', $context, $context['organization_id'] ?? null, $context['location_id'] ?? null);
        }
    }

    public function onAccessDenied(array $context): void
    {
        $this->dispatch('access_denied', $context, $context['organization_id'] ?? null, $context['location_id'] ?? null);
    }

    public function onVisitorCheckedIn(array $context): void
    {
        $this->dispatch('visitor_checked_in', $context, $context['organization_id'] ?? null, $context['location_id'] ?? null);
    }

    private function sendToConnector(BuildingConnector $connector, string $eventType, array $payload): void
    {
        $record = BuildingEvent::create([
            'building_connector_id' => $connector->id,
            'event_type' => $eventType,
            'payload' => $payload,
            'status' => 'pending',
        ]);

        try {
            match ($connector->driver) {
                'webhook', 'bacnet_gateway' => $this->sendWebhook($connector, $eventType, $payload, $record),
                'mqtt' => $this->sendMqttSimulated($connector, $eventType, $payload, $record),
                default => $record->update(['status' => 'skipped', 'error_message' => 'Unknown driver']),
            };

            $connector->update(['last_sync_at' => now()]);
        } catch (\Throwable $e) {
            $record->update([
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);
            Log::warning('Building integration dispatch failed', [
                'connector' => $connector->id,
                'event' => $eventType,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function sendWebhook(
        BuildingConnector $connector,
        string $eventType,
        array $payload,
        BuildingEvent $record,
    ): void {
        if (! $connector->endpoint_url) {
            $record->update([
                'status' => 'skipped',
                'error_message' => 'No endpoint URL configured',
            ]);

            return;
        }

        $body = [
            'event' => $eventType,
            'connector' => $connector->name,
            'payload' => $payload,
            'sent_at' => now()->toIso8601String(),
        ];

        $request = Http::timeout(config('building.webhook_timeout_seconds', 5))
            ->acceptJson()
            ->asJson();

        if ($connector->api_secret) {
            $request = $request->withHeaders([
                'X-Building-Signature' => hash_hmac('sha256', json_encode($body), $connector->api_secret),
            ]);
        }

        $response = $request->post($connector->endpoint_url, $body);

        $record->update([
            'status' => $response->successful() ? 'sent' : 'failed',
            'error_message' => $response->successful() ? null : 'HTTP '.$response->status(),
            'dispatched_at' => now(),
        ]);
    }

    private function sendMqttSimulated(
        BuildingConnector $connector,
        string $eventType,
        array $payload,
        BuildingEvent $record,
    ): void {
        Log::info('Building MQTT (simulated)', [
            'connector' => $connector->name,
            'topic' => $connector->settings['topic'] ?? 'building/events',
            'event' => $eventType,
            'payload' => $payload,
        ]);

        $record->update(['status' => 'sent', 'dispatched_at' => now()]);
    }

    private function isAfterHours(): bool
    {
        $hours = config('building.business_hours');
        $now = now()->timezone($hours['timezone'] ?? 'UTC');
        $start = $now->copy()->setTimeFromTimeString($hours['start'] ?? '08:00');
        $end = $now->copy()->setTimeFromTimeString($hours['end'] ?? '18:00');

        return ! $now->between($start, $end);
    }
}
