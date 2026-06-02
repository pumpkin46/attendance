<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EdgeDevice;
use App\Models\Employee;
use App\Services\AttendanceService;
use App\Services\EdgeDeviceMonitoringService;
use App\Services\EdgeEmbeddingSyncService;
use App\Services\NfrComplianceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EdgeDeviceApiController extends Controller
{
    public function __construct(
        private readonly EdgeDeviceMonitoringService $monitoring,
        private readonly EdgeEmbeddingSyncService $sync,
        private readonly AttendanceService $attendance,
        private readonly NfrComplianceService $nfr,
    ) {}

    public function config(Request $request): JsonResponse
    {
        /** @var EdgeDevice $device */
        $device = $request->attributes->get('edge_device');

        return response()->json([
            'device_id' => $device->device_id,
            'camera_id' => $device->camera_id,
            'stream_url' => $device->stream_url,
            'local_ai_url' => $device->local_ai_url,
            'poll_interval_seconds' => $device->poll_interval_seconds,
            'require_liveness' => $device->require_liveness,
            'recognition_threshold' => $device->recognition_threshold ?? config('services.ai.threshold', 0.95),
            'sync_version' => $device->sync_version,
            'direction' => $device->camera?->direction ?? 'both',
        ]);
    }

    public function embeddings(Request $request): JsonResponse
    {
        /** @var EdgeDevice $device */
        $device = $request->attributes->get('edge_device');

        if ($request->query('version') && $request->query('version') === $device->sync_version) {
            return response()->json([
                'unchanged' => true,
                'version' => $device->sync_version,
            ]);
        }

        $bundle = $this->sync->exportForDevice($device);

        if (! ($bundle['success'] ?? false)) {
            return response()->json(['message' => $bundle['error'] ?? 'Embedding sync failed'], 503);
        }

        return response()->json($bundle);
    }

    public function syncAck(Request $request): JsonResponse
    {
        /** @var EdgeDevice $device */
        $device = $request->attributes->get('edge_device');

        $data = $request->validate([
            'version' => 'required|string|max:64',
            'embedding_count' => 'nullable|integer|min:0',
        ]);

        $device->update([
            'sync_version' => $data['version'],
            'last_sync_at' => now(),
        ]);

        return response()->json(['status' => 'ok']);
    }

    public function heartbeat(Request $request): JsonResponse
    {
        /** @var EdgeDevice $device */
        $device = $request->attributes->get('edge_device');

        $data = $request->validate([
            'frame_rate_fps' => 'nullable|numeric|min:0|max:120',
            'software_version' => 'nullable|string|max:50',
            'metadata' => 'nullable|array',
            'metadata.cpu_usage_percent' => 'nullable|numeric|min:0|max:100',
            'metadata.gpu_usage_percent' => 'nullable|numeric|min:0|max:100',
            'metadata.latency_ms' => 'nullable|integer|min:0',
            'metadata.dropped_frames_delta' => 'nullable|integer|min:0',
        ]);

        $this->monitoring->recordHeartbeat($device, $data);

        return response()->json([
            'status' => 'ok',
            'sync_version' => $device->fresh()->sync_version,
            'server_time' => now()->toIso8601String(),
        ]);
    }

    public function report(Request $request): JsonResponse
    {
        /** @var EdgeDevice $device */
        $device = $request->attributes->get('edge_device');

        $data = $request->validate([
            'employee_id' => 'nullable|integer|exists:employees,id',
            'confidence' => 'required|numeric|min:0|max:1',
            'liveness_passed' => 'boolean',
            'processing_ms' => 'nullable|integer|min:0',
            'matched' => 'required|boolean',
            'reason' => 'nullable|string|max:100',
        ]);

        $threshold = $device->recognition_threshold ?? config('services.ai.threshold', 0.95);
        $livenessPassed = $data['liveness_passed'] ?? ! $device->require_liveness;
        $processingMs = (int) ($data['processing_ms'] ?? 0);
        $camera = $device->camera;

        if ($device->require_liveness && ! $livenessPassed) {
            return response()->json([
                'matched' => false,
                'reason' => 'liveness_failed',
            ] + $this->slaMeta($processingMs));
        }

        if (! ($data['matched'] ?? false) || ! ($data['employee_id'] ?? null) || $data['confidence'] < $threshold) {
            $event = $this->attendance->recordEdgeUnknown(
                $camera,
                (float) $data['confidence'],
                $livenessPassed,
                $processingMs,
                $device->id,
            );

            return response()->json(array_merge([
                'matched' => false,
                'reason' => $data['reason'] ?? ($data['employee_id'] ? 'low_confidence' : 'unknown'),
                'event_id' => $event->id,
            ], $this->slaMeta($processingMs)));
        }

        $employee = Employee::where('id', $data['employee_id'])->where('is_active', true)->first();

        if (! $employee) {
            $event = $this->attendance->recordEdgeUnknown(
                $camera,
                (float) $data['confidence'],
                $livenessPassed,
                $processingMs,
                $device->id,
            );

            return response()->json(array_merge([
                'matched' => false,
                'reason' => 'unknown',
                'event_id' => $event->id,
            ], $this->slaMeta($processingMs)));
        }

        $attendanceResult = $this->attendance->processEdgeRecognition(
            $employee,
            $camera,
            (float) $data['confidence'],
            $livenessPassed,
            $processingMs,
            $device->id,
        );

        return response()->json(array_merge([
            'matched' => true,
            'employee' => $employee->only(['id', 'employee_code', 'first_name', 'last_name']),
            'confidence' => $data['confidence'],
            'attendance' => $attendanceResult,
        ], $this->slaMeta($processingMs)));
    }

    private function slaMeta(int $processingMs): array
    {
        return [
            'processing_ms' => $processingMs,
            'sla_ms' => config('nfr.recognition_sla_ms', 500),
            'sla_met' => $this->nfr->recognitionSlaMet($processingMs),
        ];
    }
}
