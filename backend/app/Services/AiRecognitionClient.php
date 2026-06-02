<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiRecognitionClient
{
    private static int $nodeIndex = 0;

    public function enroll(string $employeeId, string $imageBase64): array
    {
        return $this->post('/api/v1/enroll', [
            'employee_id' => $employeeId,
            'image' => $imageBase64,
        ]);
    }

    public function validateImage(string $imageBase64, ?string $expectedPose = null): array
    {
        return $this->post('/api/v1/validate-image', array_filter([
            'image' => $imageBase64,
            'expected_pose' => $expectedPose,
        ], fn ($v) => $v !== null));
    }

    public function enrollStructured(string $employeeId, array $poses): array
    {
        return $this->post('/api/v1/enroll-structured', [
            'employee_id' => $employeeId,
            'poses' => $poses,
        ], max(config('services.ai.timeout', 2), 60));
    }

    public function enrollBatch(string $employeeId, array $images): array
    {
        return $this->post('/api/v1/enroll-batch', [
            'employee_id' => $employeeId,
            'images' => $images,
        ]);
    }

    public function identify(
        string $imageBase64,
        bool $requireLiveness = true,
        ?array $livenessFrames = null,
        ?string $sessionId = null,
        ?string $source = null,
    ): array {
        return $this->post('/api/v1/identify', array_filter([
            'image' => $imageBase64,
            'require_liveness' => $requireLiveness,
            'liveness_frames' => $livenessFrames,
            'session_id' => $sessionId,
            'source' => $source,
        ], fn ($v) => $v !== null));
    }

    public function recognize(
        string $imageBase64,
        bool $requireLiveness = true,
        ?array $livenessFrames = null,
        ?string $sessionId = null,
        ?string $source = null,
    ): array {
        return $this->post('/api/v1/recognize', array_filter([
            'image' => $imageBase64,
            'require_liveness' => $requireLiveness,
            'liveness_frames' => $livenessFrames,
            'session_id' => $sessionId,
            'source' => $source,
        ], fn ($v) => $v !== null));
    }

    public function recognizeStream(
        string $streamUrl,
        bool $requireLiveness = false,
        ?string $sessionId = null,
        ?string $source = null,
    ): array {
        return $this->post('/api/v1/recognize-stream', array_filter([
            'stream_url' => $streamUrl,
            'require_liveness' => $requireLiveness,
            'session_id' => $sessionId,
            'source' => $source,
        ], fn ($v) => $v !== null), max(config('services.ai.timeout', 2), 30));
    }

    public function verifyLiveness(array $frames): array
    {
        return $this->post('/api/v1/liveness/verify', [
            'frames' => $frames,
        ]);
    }

    public function detect(string $imageBase64): array
    {
        return $this->post('/api/v1/detect', ['image' => $imageBase64]);
    }

    public function captureStream(string $streamUrl): array
    {
        return $this->post('/api/v1/capture-stream', [
            'stream_url' => $streamUrl,
        ]);
    }

    public function deleteEmployee(string $employeeId): array
    {
        return $this->post('/api/v1/delete', ['employee_id' => $employeeId]);
    }

    public function analyzeAnomalies(array $records, array $config = []): array
    {
        return $this->post('/api/v1/anomalies/analyze', [
            'records' => $records,
            'config' => $config,
        ], max(config('services.ai.timeout', 2), 30));
    }

    public function health(): array
    {
        try {
            $response = Http::timeout(2)->get($this->baseUrl().'/health');

            return $response->json() ?? ['status' => 'unknown'];
        } catch (ConnectionException $e) {
            return ['status' => 'unavailable', 'error' => $e->getMessage()];
        }
    }

    /** NFR-005: Round-robin across recognition nodes */
    private function baseUrl(): string
    {
        $nodes = config('scaling.recognition_nodes', []);

        if (count($nodes) <= 1) {
            return rtrim($nodes[0] ?? config('services.ai.url'), '/');
        }

        $index = self::$nodeIndex % count($nodes);
        self::$nodeIndex++;

        return rtrim($nodes[$index], '/');
    }

    private function post(string $path, array $payload, ?int $timeout = null): array
    {
        $url = $this->baseUrl().$path;
        $timeout ??= config('services.ai.timeout', 2);

        try {
            $response = Http::timeout($timeout)
                ->acceptJson()
                ->post($url, $payload);

            if ($response->failed()) {
                Log::warning('AI service error', [
                    'path' => $path,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return [
                    'success' => false,
                    'error' => $response->json('detail') ?? 'AI service error',
                    'status' => $response->status(),
                ];
            }

            $data = array_merge(['success' => true], $response->json());
            $processingMs = (int) ($data['processing_ms'] ?? 0);
            $slaMs = config('nfr.recognition_sla_ms', 500);

            if ($processingMs > $slaMs) {
                Log::notice('NFR-001 SLA exceeded', [
                    'path' => $path,
                    'processing_ms' => $processingMs,
                    'sla_ms' => $slaMs,
                ]);
            }

            return $data;
        } catch (ConnectionException $e) {
            Log::error('AI service unreachable', ['path' => $path, 'error' => $e->getMessage()]);

            return ['success' => false, 'error' => 'AI service unavailable'];
        }
    }
}
