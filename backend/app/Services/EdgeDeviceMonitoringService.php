<?php

namespace App\Services;

use App\Models\EdgeDevice;
use App\Models\RecognitionEvent;

class EdgeDeviceMonitoringService
{
    public function summary(): array
    {
        $devices = EdgeDevice::with(['location', 'camera'])->orderBy('name')->get();
        $formatted = $devices->map(fn (EdgeDevice $d) => $this->formatDevice($d));

        return [
            'online' => $formatted->where('online', true)->count(),
            'offline' => $formatted->where('online', false)->count(),
            'total' => $formatted->count(),
            'recognition_count_today' => (int) RecognitionEvent::query()
                ->whereDate('recognized_at', today())
                ->where('metadata->source', 'edge')
                ->count(),
            'devices' => $formatted->values(),
        ];
    }

    public function formatDevice(EdgeDevice $device): array
    {
        $threshold = config('attendance.edge_offline_seconds', 300);

        return [
            'id' => $device->id,
            'name' => $device->name,
            'device_id' => $device->device_id,
            'stream_url' => $device->stream_url,
            'local_ai_url' => $device->local_ai_url,
            'status' => $device->status,
            'is_active' => $device->is_active,
            'online' => $this->isOnline($device),
            'poll_interval_seconds' => $device->poll_interval_seconds,
            'require_liveness' => $device->require_liveness,
            'recognition_threshold' => $device->recognition_threshold,
            'sync_version' => $device->sync_version,
            'last_sync_at' => $device->last_sync_at?->toIso8601String(),
            'last_heartbeat_at' => $device->last_heartbeat_at?->toIso8601String(),
            'frame_rate_fps' => $device->frame_rate_fps !== null ? (float) $device->frame_rate_fps : null,
            'software_version' => $device->software_version,
            'metadata' => $device->metadata,
            'location' => $device->location?->only(['id', 'name']),
            'camera' => $device->camera?->only(['id', 'name', 'deployment_mode']),
        ];
    }

    public function isOnline(EdgeDevice $device): bool
    {
        if (! $device->is_active) {
            return false;
        }

        if (! $device->last_heartbeat_at) {
            return false;
        }

        $threshold = config('attendance.edge_offline_seconds', 300);

        return $device->last_heartbeat_at->diffInSeconds(now()) <= $threshold;
    }

    public function recordHeartbeat(EdgeDevice $device, array $metrics = []): void
    {
        $device->update([
            'last_heartbeat_at' => now(),
            'status' => EdgeDevice::STATUS_ONLINE,
            'frame_rate_fps' => $metrics['frame_rate_fps'] ?? $device->frame_rate_fps,
            'software_version' => $metrics['software_version'] ?? $device->software_version,
            'metadata' => array_merge($device->metadata ?? [], $metrics['metadata'] ?? []),
        ]);

        if ($device->camera) {
            app(CameraMonitoringService::class)->recordFrame(
                $device->camera,
                isset($metrics['frame_rate_fps']) ? (float) $metrics['frame_rate_fps'] : null
            );
        }
    }
}
