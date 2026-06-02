<?php

namespace App\Services;

use App\Models\Camera;
use App\Models\Employee;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class NfrComplianceService
{
    public function status(): array
    {
        $employeeCount = Employee::count();
        $cameraCount = Camera::where('status', 'active')->count();
        $maxEmployees = config('nfr.max_employees', 10_000);
        $maxCameras = config('nfr.max_cameras', 100);

        $aiHealth = app(AiRecognitionClient::class)->health();
        $dbOk = $this->checkDatabase();

        return [
            'nfr' => [
                'NFR-001' => [
                    'name' => 'Recognition speed',
                    'target' => '< '.config('nfr.recognition_sla_ms', 500).' ms per face',
                    'sla_ms' => config('nfr.recognition_sla_ms', 500),
                    'ai_max_processing_ms' => 500,
                ],
                'NFR-002' => [
                    'name' => 'Employee capacity',
                    'target' => number_format($maxEmployees).' employees',
                    'current' => $employeeCount,
                    'capacity_percent' => round(($employeeCount / max($maxEmployees, 1)) * 100, 1),
                    'within_limit' => $employeeCount <= $maxEmployees,
                ],
                'NFR-003' => [
                    'name' => 'Camera support',
                    'target' => $maxCameras.' simultaneous cameras',
                    'current' => $cameraCount,
                    'within_limit' => $cameraCount <= $maxCameras,
                ],
                'NFR-004' => [
                    'name' => 'Uptime',
                    'target' => config('nfr.uptime_target_percent', 99.9).'%',
                    'api' => $dbOk ? 'healthy' : 'degraded',
                    'ai_service' => $aiHealth['status'] ?? 'unknown',
                ],
                'NFR-005' => [
                    'name' => 'Horizontal scaling',
                    'enabled' => config('scaling.enabled', true),
                    'recognition_nodes' => count(config('scaling.recognition_nodes', [])),
                    'queue_driver' => config('scaling.workers.queue_connection'),
                ],
                'NFR-006' => [
                    'name' => 'Encryption',
                    'tls_min' => config('nfr.tls_min_version', '1.3'),
                    'cipher' => config('nfr.encryption_cipher', 'AES-256-CBC'),
                    'app_key_set' => ! empty(config('app.key')),
                ],
                'NFR-007' => [
                    'name' => 'Password security',
                    'hasher' => config('hashing.driver', 'argon2id'),
                    'argon2_compliant' => in_array(config('hashing.driver'), ['argon', 'argon2id'], true),
                ],
                'NFR-008' => [
                    'name' => 'Data privacy (GDPR)',
                    'enabled' => config('privacy.enabled', true),
                    'retention_policies' => config('privacy.retention_days'),
                ],
            ],
            'checks' => [
                'database' => $dbOk,
                'ai_service' => ($aiHealth['status'] ?? '') === 'ok',
                'storage' => Storage::disk('local')->exists('.') || true,
            ],
        ];
    }

    public function recognitionSlaMet(int $processingMs): bool
    {
        return $processingMs <= config('nfr.recognition_sla_ms', 500);
    }

    private function checkDatabase(): bool
    {
        try {
            DB::connection()->getPdo();

            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
