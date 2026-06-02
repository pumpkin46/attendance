<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AiRecognitionClient;
use App\Services\NfrComplianceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    public function __invoke(
        AiRecognitionClient $ai,
        NfrComplianceService $nfr,
    ): JsonResponse {
        $dbOk = false;
        $dbLatencyMs = null;

        try {
            $start = microtime(true);
            DB::select('SELECT 1');
            $dbLatencyMs = (int) round((microtime(true) - $start) * 1000);
            $dbOk = true;
        } catch (\Throwable) {
            // degraded
        }

        $aiHealth = $ai->health();
        $nfrStatus = $nfr->status();
        $healthy = $dbOk && ($aiHealth['status'] ?? '') === 'ok';

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'timestamp' => now()->toIso8601String(),
            'uptime_target' => config('nfr.uptime_target_percent', 99.9).'%',
            'components' => [
                'api' => ['status' => 'ok', 'version' => app()->version()],
                'database' => [
                    'status' => $dbOk ? 'ok' : 'down',
                    'latency_ms' => $dbLatencyMs,
                ],
                'ai_recognition' => $aiHealth,
            ],
            'nfr_compliance' => $nfrStatus,
        ], $healthy ? 200 : 503);
    }
}
