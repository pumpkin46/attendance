<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\RecognitionController;
use App\Models\Camera;
use App\Services\AiRecognitionClient;
use App\Services\CameraMonitoringService;
use App\Support\CameraSourceResolver;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;

class PollCameraStreams extends Command
{
    protected $signature = 'cameras:poll-streams {--once : Run a single poll cycle and exit}';

    protected $description = 'Capture frames from RTSP/IP cameras and run face recognition (FR-009)';

    public function handle(AiRecognitionClient $ai, CameraMonitoringService $monitoring): int
    {
        $interval = config('attendance.camera_stream_poll_interval_seconds', 5);

        do {
            $cameras = Camera::query()
                ->where('status', Camera::STATUS_ACTIVE)
                ->where('deployment_mode', 'cloud')
                ->whereNotNull('stream_url')
                ->where('stream_url', '!=', '')
                ->get();

            if ($cameras->isEmpty()) {
                $this->warn('No active cameras with stream_url configured.');

                if ($this->option('once')) {
                    return self::SUCCESS;
                }

                sleep($interval);
                continue;
            }

            /** @var RecognitionController $recognition */
            $recognition = App::make(RecognitionController::class);

            foreach ($cameras as $camera) {
                $captureStart = microtime(true);
                $capture = $ai->captureStream($camera->stream_url);
                $latencyMs = (int) round((microtime(true) - $captureStart) * 1000);

                if (! ($capture['success'] ?? false)) {
                    $camera->increment('dropped_frames');
                    $this->error("Camera {$camera->id} ({$camera->name}): ".($capture['error'] ?? 'capture failed'));
                    continue;
                }

                $bandwidthKbps = null;
                if (! empty($capture['image']) && $latencyMs > 0) {
                    $bandwidthKbps = (int) round((strlen($capture['image']) * 8) / $latencyMs);
                }

                $monitoring->recordHealth($camera, [
                    'frame_rate_fps' => round(1 / max($interval, 1), 2),
                    'latency_ms' => $capture['processing_ms'] ?? $latencyMs,
                    'bandwidth_kbps' => $bandwidthKbps,
                    'frame_received' => true,
                ]);

                if (isset($capture['image_width'], $capture['image_height'])) {
                    $camera->update([
                        'resolution_width' => $capture['image_width'],
                        'resolution_height' => $capture['image_height'],
                    ]);
                }

                $request = Request::create('/api/v1/recognition/identify', 'POST', [
                    'image' => $capture['image'],
                    'camera_id' => $camera->id,
                    'require_liveness' => false,
                    'source' => CameraSourceResolver::fromStreamUrl($camera->stream_url),
                    'session_id' => 'camera-'.$camera->id,
                ]);

                $response = $recognition->identify($request);
                $body = $response->getData(true);

                if ($body['matched'] ?? false) {
                    $name = trim(($body['employee']['first_name'] ?? '').' '.($body['employee']['last_name'] ?? ''));
                    $action = $body['attendance']['action'] ?? 'ok';
                    $this->info("Camera {$camera->name}: matched {$name} ({$action})");
                } elseif (($body['reason'] ?? '') === 'unknown') {
                    $this->warn("Camera {$camera->name}: unknown face flagged");
                }
            }

            if ($this->option('once')) {
                return self::SUCCESS;
            }

            sleep($interval);
        } while (true);
    }
}
