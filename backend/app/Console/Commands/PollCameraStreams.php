<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\RecognitionController;
use App\Models\Camera;
use App\Services\AiRecognitionClient;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;

class PollCameraStreams extends Command
{
    protected $signature = 'cameras:poll-streams {--once : Run a single poll cycle and exit}';

    protected $description = 'Capture frames from RTSP/IP cameras and run face recognition (FR-009)';

    public function handle(AiRecognitionClient $ai): int
    {
        $interval = config('attendance.camera_stream_poll_interval_seconds', 5);

        do {
            $cameras = Camera::query()
                ->where('is_active', true)
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
                $capture = $ai->captureStream($camera->stream_url);

                if (! ($capture['success'] ?? false)) {
                    $this->error("Camera {$camera->id} ({$camera->name}): ".($capture['error'] ?? 'capture failed'));
                    continue;
                }

                $camera->update(['last_heartbeat_at' => now()]);

                $request = Request::create('/api/v1/recognition/identify', 'POST', [
                    'image' => $capture['image'],
                    'camera_id' => $camera->id,
                    'require_liveness' => false,
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
