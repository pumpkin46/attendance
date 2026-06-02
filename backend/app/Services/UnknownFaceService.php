<?php

namespace App\Services;

use App\Models\Camera;
use App\Models\RecognitionEvent;
use App\Services\LiveEventService;
use App\Models\User;
use App\Notifications\UnknownFaceDetected;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

class UnknownFaceService
{
    public function record(
        ?Camera $camera,
        float $confidence,
        bool $livenessPassed,
        int $processingMs,
        string $imageHash,
        ?string $imageBase64 = null,
        ?string $source = null,
    ): RecognitionEvent {
        $snapshotPath = null;

        if ($imageBase64 && config('attendance.unknown_snapshot_enabled')) {
            $snapshotPath = $this->storeSnapshot($imageBase64, $camera?->id);
        }

        $event = RecognitionEvent::create([
            'camera_id' => $camera?->id,
            'result' => config('attendance.unknown_person_alert') ? 'unknown' : 'low_confidence',
            'confidence' => $confidence,
            'liveness_passed' => $livenessPassed,
            'processing_ms' => $processingMs,
            'image_hash' => $imageHash,
            'snapshot_path' => $snapshotPath,
            'metadata' => array_filter([
                'source' => $source,
                'alert_sent' => false,
            ]),
            'recognized_at' => now(),
        ]);

        if ($event->result === 'unknown') {
            $this->maybeNotifyAdmins($event, $camera);
            app(LiveEventService::class)->record(
                'unknown_person',
                now()->format('H:i').' Unknown Person Detected',
                $camera?->location?->organization_id,
                ['camera_id' => $camera?->id],
            );
        }

        return $event->load('camera');
    }

    private function storeSnapshot(string $imageBase64, ?int $cameraId): ?string
    {
        try {
            $payload = $imageBase64;
            if (str_contains($payload, ',')) {
                $payload = explode(',', $payload, 2)[1];
            }

            $binary = base64_decode($payload, true);
            if ($binary === false) {
                return null;
            }

            $dir = 'unknown-faces/'.($cameraId ?? 'none').'/'.now()->format('Y/m/d');
            $filename = uniqid('snap_', true).'.jpg';
            $path = $dir.'/'.$filename;

            Storage::disk('local')->put($path, $binary);

            return $path;
        } catch (\Throwable) {
            return null;
        }
    }

    private function maybeNotifyAdmins(RecognitionEvent $event, ?Camera $camera): void
    {
        if (! config('attendance.unknown_notify_admins')) {
            return;
        }

        $cooldown = config('attendance.unknown_alert_cooldown_seconds', 300);
        $cacheKey = 'unknown:alert:'.($camera?->id ?? 'none').':'.$event->image_hash;

        if ($cooldown > 0 && Cache::has($cacheKey)) {
            return;
        }

        if ($cooldown > 0) {
            Cache::put($cacheKey, true, $cooldown);
        }

        $admins = User::where('is_active', true)
            ->whereHas('roles', fn ($q) => $q->where('name', 'admin'))
            ->get();

        foreach ($admins as $admin) {
            $admin->notify(new UnknownFaceDetected($event));
        }

        $event->update([
            'notified_at' => now(),
            'metadata' => array_merge($event->metadata ?? [], ['alert_sent' => true]),
        ]);
    }
}
