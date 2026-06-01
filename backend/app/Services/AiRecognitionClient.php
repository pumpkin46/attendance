<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiRecognitionClient
{
    public function enroll(string $employeeId, string $imageBase64): array
    {
        return $this->post('/api/v1/enroll', [
            'employee_id' => $employeeId,
            'image' => $imageBase64,
        ]);
    }

    public function identify(string $imageBase64, bool $requireLiveness = true): array
    {
        return $this->post('/api/v1/identify', [
            'image' => $imageBase64,
            'require_liveness' => $requireLiveness,
        ]);
    }

    public function deleteEmployee(string $employeeId): array
    {
        return $this->post('/api/v1/delete', ['employee_id' => $employeeId]);
    }

    public function health(): array
    {
        try {
            $response = Http::timeout(2)
                ->get(config('services.ai.url').'/health');

            return $response->json() ?? ['status' => 'unknown'];
        } catch (ConnectionException $e) {
            return ['status' => 'unavailable', 'error' => $e->getMessage()];
        }
    }

    private function post(string $path, array $payload): array
    {
        $url = rtrim(config('services.ai.url'), '/').$path;
        $timeout = config('services.ai.timeout', 5);

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

            return array_merge(['success' => true], $response->json());
        } catch (ConnectionException $e) {
            Log::error('AI service unreachable', ['path' => $path, 'error' => $e->getMessage()]);

            return ['success' => false, 'error' => 'AI service unavailable'];
        }
    }
}
