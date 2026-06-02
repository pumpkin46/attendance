<?php

namespace App\Services;

use App\Models\Camera;
use App\Models\RecognitionEvent;

class CameraMonitoringService
{
    private const ONLINE_THRESHOLD_SECONDS = 120;

    public function summary(): array
    {
        $cameras = Camera::with('location')->orderBy('name')->get();
        $monitored = $cameras->map(fn (Camera $c) => $this->formatCamera($c));

        $online = $monitored->where('online', true)->count();
        $offline = $monitored->where('online', false)->count();

        return [
            'online' => $online,
            'offline' => $offline,
            'total' => $monitored->count(),
            'recognition_count_today' => (int) RecognitionEvent::query()
                ->whereDate('recognized_at', today())
                ->whereNotNull('camera_id')
                ->count(),
            'cameras' => $monitored->values(),
        ];
    }

    public function formatCamera(Camera $camera): array
    {
        $recognitionToday = RecognitionEvent::query()
            ->where('camera_id', $camera->id)
            ->whereDate('recognized_at', today())
            ->count();

        return [
            'id' => $camera->id,
            'name' => $camera->name,
            'location' => $camera->location?->only(['id', 'name']),
            'stream_url' => $camera->stream_url,
            'status' => $camera->status,
            'is_active' => $camera->is_active,
            'online' => $this->isOnline($camera),
            'frame_rate_fps' => $camera->frame_rate_fps !== null ? (float) $camera->frame_rate_fps : null,
            'last_heartbeat_at' => $camera->last_heartbeat_at?->toIso8601String(),
            'last_frame_at' => $camera->last_frame_at?->toIso8601String(),
            'recognition_count_today' => $recognitionToday,
            'direction' => $camera->direction,
            'device_id' => $camera->device_id,
        ];
    }

    public function isOnline(Camera $camera): bool
    {
        if ($camera->status !== 'active') {
            return false;
        }

        if (! $camera->last_heartbeat_at) {
            return false;
        }

        return $camera->last_heartbeat_at->diffInSeconds(now()) <= self::ONLINE_THRESHOLD_SECONDS;
    }

    public function recordFrame(Camera $camera, ?float $reportedFps = null): void
    {
        $now = now();
        $fps = $reportedFps;

        if ($fps === null && $camera->last_frame_at) {
            $delta = $camera->last_frame_at->diffInSeconds($now);
            if ($delta > 0) {
                $fps = round(1 / $delta, 2);
            }
        }

        if ($fps !== null && $camera->frame_rate_fps !== null) {
            $fps = round($camera->frame_rate_fps * 0.6 + $fps * 0.4, 2);
        }

        $camera->update([
            'last_heartbeat_at' => $now,
            'last_frame_at' => $now,
            'frame_rate_fps' => $fps ?? $camera->frame_rate_fps,
        ]);
    }
}
