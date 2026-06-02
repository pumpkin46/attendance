<?php

namespace App\Services;

use App\Models\EdgeDevice;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class EdgeEmbeddingSyncService
{
    public function __construct(private readonly AiRecognitionClient $ai) {}

    public function exportForDevice(EdgeDevice $device): array
    {
        $bundle = $this->fetchExportBundle();

        if (! ($bundle['success'] ?? false)) {
            return $bundle;
        }

        $device->update([
            'sync_version' => $bundle['version'] ?? null,
            'last_sync_at' => now(),
        ]);

        return array_merge($bundle, [
            'threshold' => $device->recognition_threshold ?? config('services.ai.threshold', 0.95),
            'require_liveness' => $device->require_liveness,
        ]);
    }

    public function currentVersion(): ?string
    {
        $bundle = $this->fetchExportBundle();

        return ($bundle['success'] ?? false) ? ($bundle['version'] ?? null) : null;
    }

    private function fetchExportBundle(): array
    {
        $url = rtrim(config('services.ai.url'), '/').'/api/v1/embeddings/export';
        $timeout = config('services.ai.timeout', 2);

        try {
            $response = Http::timeout(max($timeout, 10))
                ->acceptJson()
                ->get($url);

            if ($response->failed()) {
                return [
                    'success' => false,
                    'error' => $response->json('detail') ?? 'Embedding export failed',
                ];
            }

            return array_merge(['success' => true], $response->json());
        } catch (\Throwable $e) {
            Log::error('Edge embedding export failed', ['error' => $e->getMessage()]);

            return ['success' => false, 'error' => 'AI service unavailable for embedding export'];
        }
    }
}
