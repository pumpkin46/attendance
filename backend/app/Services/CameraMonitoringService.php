<?php

namespace App\Services;

use App\Models\Camera;
use App\Models\CameraHealthLog;
use App\Models\RecognitionEvent;
use Illuminate\Support\Facades\Cache;

class CameraMonitoringService
{
    public function onlineThresholdSeconds(): int
    {
        return config('cameras.online_threshold_seconds', 120);
    }

    public function summary(): array
    {
        $cameras = Camera::with('location')->orderBy('name')->get();
        $monitored = $cameras->map(fn (Camera $c) => $this->formatCamera($c));

        $online = $monitored->where('health.online', true)->count();
        $offline = $monitored->where('health.online', false)->count();

        return [
            'online' => $online,
            'offline' => $offline,
            'total' => $monitored->count(),
            'recognition_count_today' => (int) RecognitionEvent::query()
                ->whereDate('recognized_at', today())
                ->whereNotNull('camera_id')
                ->count(),
            'avg_fps' => round($monitored->avg('health.fps') ?? 0, 2),
            'avg_latency_ms' => (int) round($monitored->avg('health.latency_ms') ?? 0),
            'total_dropped_frames' => (int) $monitored->sum('health.dropped_frames'),
            'cameras' => $monitored->values(),
        ];
    }

    public function formatCamera(Camera $camera): array
    {
        $recognitionToday = RecognitionEvent::query()
            ->where('camera_id', $camera->id)
            ->whereDate('recognized_at', today())
            ->count();

        $online = $this->isOnline($camera);

        return [
            'id' => $camera->id,
            'name' => $camera->name,
            'camera_type' => $camera->camera_type ?? 'rtsp',
            'location' => $camera->location?->only(['id', 'name']),
            'zone' => $camera->zone,
            'floor' => $camera->floor,
            'stream_url' => $camera->stream_url,
            'target_fps' => $camera->target_fps,
            'resolution' => $camera->resolution(),
            'resolution_width' => $camera->resolution_width,
            'resolution_height' => $camera->resolution_height,
            'status' => $camera->status,
            'is_active' => $camera->is_active,
            'direction' => $camera->direction,
            'deployment_mode' => $camera->deployment_mode ?? 'cloud',
            'device_id' => $camera->device_id,
            'last_heartbeat_at' => $camera->last_heartbeat_at?->toIso8601String(),
            'last_frame_at' => $camera->last_frame_at?->toIso8601String(),
            'health' => [
                'online' => $online,
                'fps' => $camera->frame_rate_fps !== null ? (float) $camera->frame_rate_fps : null,
                'latency_ms' => $camera->latency_ms,
                'bandwidth_kbps' => $camera->bandwidth_kbps,
                'cpu_usage_percent' => $camera->cpu_usage_percent !== null
                    ? (float) $camera->cpu_usage_percent : null,
                'gpu_usage_percent' => $camera->gpu_usage_percent !== null
                    ? (float) $camera->gpu_usage_percent : null,
                'dropped_frames' => (int) ($camera->dropped_frames ?? 0),
                'recognition_events_today' => $recognitionToday,
                'updated_at' => $camera->health_updated_at?->toIso8601String(),
            ],
            'recognition_count_today' => $recognitionToday,
            'online' => $online,
            'frame_rate_fps' => $camera->frame_rate_fps !== null ? (float) $camera->frame_rate_fps : null,
        ];
    }

    public function healthDetail(Camera $camera, int $hours = 24): array
    {
        $since = now()->subHours($hours);

        $logs = CameraHealthLog::query()
            ->where('camera_id', $camera->id)
            ->where('recorded_at', '>=', $since)
            ->orderBy('recorded_at')
            ->get();

        return [
            'camera' => $this->formatCamera($camera->load('location')),
            'history' => $logs->map(fn (CameraHealthLog $log) => [
                'recorded_at' => $log->recorded_at->toIso8601String(),
                'online' => $log->online,
                'fps' => $log->frame_rate_fps !== null ? (float) $log->frame_rate_fps : null,
                'latency_ms' => $log->latency_ms,
                'bandwidth_kbps' => $log->bandwidth_kbps,
                'cpu_usage_percent' => $log->cpu_usage_percent !== null
                    ? (float) $log->cpu_usage_percent : null,
                'gpu_usage_percent' => $log->gpu_usage_percent !== null
                    ? (float) $log->gpu_usage_percent : null,
                'dropped_frames' => $log->dropped_frames,
                'recognition_events' => $log->recognition_events,
            ]),
        ];
    }

    public function isOnline(Camera $camera): bool
    {
        if ($camera->status !== Camera::STATUS_ACTIVE) {
            return false;
        }

        if (! $camera->last_heartbeat_at) {
            return false;
        }

        return $camera->last_heartbeat_at->diffInSeconds(now()) <= $this->onlineThresholdSeconds();
    }

    public function recordFrame(Camera $camera, ?float $reportedFps = null, ?int $latencyMs = null): void
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

        $updates = [
            'last_heartbeat_at' => $now,
            'last_frame_at' => $now,
            'frame_rate_fps' => $fps ?? $camera->frame_rate_fps,
            'health_updated_at' => $now,
        ];

        if ($latencyMs !== null) {
            $updates['latency_ms'] = $latencyMs;
        }

        $camera->update($updates);

        $this->maybeLogHealth($camera->fresh());
    }

    public function recordHealth(Camera $camera, array $metrics): Camera
    {
        $now = now();
        $recognitionToday = RecognitionEvent::query()
            ->where('camera_id', $camera->id)
            ->whereDate('recognized_at', today())
            ->count();

        $droppedDelta = (int) ($metrics['dropped_frames_delta'] ?? 0);
        $droppedTotal = (int) ($camera->dropped_frames ?? 0) + max(0, $droppedDelta);

        $fps = isset($metrics['frame_rate_fps']) ? (float) $metrics['frame_rate_fps'] : null;
        if ($fps !== null && $camera->frame_rate_fps !== null) {
            $fps = round($camera->frame_rate_fps * 0.6 + $fps * 0.4, 2);
        }

        $updates = [
            'last_heartbeat_at' => $now,
            'frame_rate_fps' => $fps ?? $camera->frame_rate_fps,
            'latency_ms' => $metrics['latency_ms'] ?? $camera->latency_ms,
            'bandwidth_kbps' => $metrics['bandwidth_kbps'] ?? $camera->bandwidth_kbps,
            'cpu_usage_percent' => $metrics['cpu_usage_percent'] ?? $camera->cpu_usage_percent,
            'gpu_usage_percent' => $metrics['gpu_usage_percent'] ?? $camera->gpu_usage_percent,
            'dropped_frames' => $droppedTotal,
            'health_updated_at' => $now,
        ];

        if ($metrics['frame_received'] ?? true) {
            $updates['last_frame_at'] = $now;
        }

        $camera->update($updates);

        $this->maybeLogHealth($camera->fresh(), $recognitionToday);

        return $camera->fresh();
    }

    private function maybeLogHealth(Camera $camera, ?int $recognitionToday = null): void
    {
        $interval = config('cameras.health_log_interval_seconds', 300);
        $cacheKey = "camera:health:log:{$camera->id}";

        if (! Cache::add($cacheKey, true, $interval)) {
            return;
        }

        $recognitionToday ??= RecognitionEvent::query()
            ->where('camera_id', $camera->id)
            ->whereDate('recognized_at', today())
            ->count();

        CameraHealthLog::create([
            'camera_id' => $camera->id,
            'online' => $this->isOnline($camera),
            'frame_rate_fps' => $camera->frame_rate_fps,
            'latency_ms' => $camera->latency_ms,
            'bandwidth_kbps' => $camera->bandwidth_kbps,
            'cpu_usage_percent' => $camera->cpu_usage_percent,
            'gpu_usage_percent' => $camera->gpu_usage_percent,
            'dropped_frames' => $camera->dropped_frames ?? 0,
            'recognition_events' => $recognitionToday,
            'recorded_at' => now(),
        ]);
    }
}
