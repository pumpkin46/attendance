<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\RecognitionEvent;
use App\Services\AiRecognitionClient;
use App\Services\AttendanceService;
use App\Services\NfrComplianceService;
use App\Services\RecognitionMetricsService;
use App\Support\CameraSourceResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class RecognitionController extends Controller
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly AttendanceService $attendance,
        private readonly NfrComplianceService $nfr,
        private readonly RecognitionMetricsService $metrics,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'pipeline_stages' => config('recognition.pipeline_stages'),
            'supported_sources' => config('recognition.supported_sources'),
            'metrics_targets' => config('recognition.metrics'),
            'threshold' => config('services.ai.threshold', 0.95),
        ]);
    }

    public function metrics(Request $request): JsonResponse
    {
        $days = $request->integer('window_days', config('recognition.metrics_window_days', 7));

        return response()->json([
            'summary' => $this->metrics->summary($days),
            'by_source' => $this->metrics->bySource($days),
        ]);
    }

    public function detect(Request $request): JsonResponse
    {
        $data = $request->validate(['image' => 'required|string']);

        $result = $this->ai->detect($data['image']);

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Detection failed'], 503);
        }

        return response()->json([
            'faces' => $result['faces'] ?? [],
            'face_count' => $result['face_count'] ?? 0,
            'processing_ms' => $result['processing_ms'] ?? 0,
            'image_width' => $result['image_width'] ?? null,
            'image_height' => $result['image_height'] ?? null,
        ]);
    }

    public function identify(Request $request): JsonResponse
    {
        $sources = implode(',', config('recognition.supported_sources', []));
        $data = $request->validate([
            'image' => 'required|string',
            'camera_id' => 'nullable|exists:cameras,id',
            'require_liveness' => 'boolean',
            'liveness_frames' => 'nullable|array|max:30',
            'liveness_frames.*' => 'string',
            'session_id' => 'nullable|string|max:128',
            'source' => 'nullable|string|in:'.$sources,
        ]);

        $camera = isset($data['camera_id']) ? Camera::find($data['camera_id']) : null;
        $threshold = config('services.ai.threshold', 0.95);
        $requireLiveness = $data['require_liveness'] ?? true;
        $source = $data['source'] ?? CameraSourceResolver::fromStreamUrl($camera?->stream_url);
        $livenessFrames = $data['liveness_frames'] ?? null;
        $sessionId = $data['session_id'] ?? ($camera ? 'camera-'.$camera->id : null);

        $result = $this->ai->identify(
            $data['image'],
            $requireLiveness,
            $livenessFrames,
            $sessionId,
            $source,
        );

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Recognition failed'], 503);
        }

        $confidence = (float) ($result['confidence'] ?? 0);
        $livenessPassed = (bool) ($result['liveness_passed'] ?? false);
        $processingMs = (int) ($result['processing_ms'] ?? 0);
        $imageHash = hash('sha256', $data['image']);

        if ($requireLiveness && ! $livenessPassed) {
            RecognitionEvent::create([
                'camera_id' => $camera?->id,
                'result' => 'liveness_failed',
                'confidence' => $confidence,
                'liveness_passed' => false,
                'processing_ms' => $processingMs,
                'image_hash' => $imageHash,
                'metadata' => $this->eventMetadata($result, $source),
                'recognized_at' => now(),
            ]);

            return response()->json(array_merge([
                'matched' => false,
                'reason' => $result['liveness_reason'] ?? 'liveness_failed',
                'spoof_type' => $result['spoof_type'] ?? null,
                'liveness_score' => $result['liveness_score'] ?? null,
                'liveness_checks' => $result['liveness_checks'] ?? null,
            ], $this->slaMeta($processingMs)));
        }

        $employeeId = $result['employee_id'] ?? null;

        if (! $employeeId || $confidence < $threshold) {
            $event = $this->attendance->recordUnknown(
                $camera,
                $confidence,
                $livenessPassed,
                $processingMs,
                $imageHash,
                $data['image'],
                $source,
            );

            return response()->json(array_merge([
                'matched' => false,
                'reason' => $employeeId ? 'low_confidence' : 'unknown',
                'confidence' => $confidence,
                'event_id' => $event->id,
                'snapshot_url' => $event->snapshotUrl(),
            ], $this->slaMeta($processingMs)));
        }

        $employee = Employee::where('id', $employeeId)->where('is_active', true)->first();

        if (! $employee) {
            $event = $this->attendance->recordUnknown(
                $camera,
                $confidence,
                $livenessPassed,
                $processingMs,
                $imageHash,
                $data['image'],
                $source,
            );

            return response()->json(array_merge([
                'matched' => false,
                'reason' => 'unknown',
                'event_id' => $event->id,
                'snapshot_url' => $event->snapshotUrl(),
            ], $this->slaMeta($processingMs)));
        }

        $attendanceResult = $this->attendance->processRecognition(
            $employee,
            $camera,
            $confidence,
            $livenessPassed,
            $processingMs,
            $imageHash,
            $source,
            $this->eventMetadata($result, $source),
        );

        return response()->json(array_merge([
            'matched' => true,
            'employee' => $employee->only(['id', 'employee_code', 'first_name', 'last_name']),
            'confidence' => $confidence,
            'liveness_passed' => $livenessPassed,
            'liveness_score' => $result['liveness_score'] ?? null,
            'track_id' => $result['track_id'] ?? null,
            'quality_score' => $result['quality_score'] ?? null,
            'pipeline' => $result['pipeline'] ?? null,
            'attendance' => $attendanceResult,
        ], $this->slaMeta($processingMs, $result)));
    }

    public function recognize(Request $request): JsonResponse
    {
        $sources = implode(',', config('recognition.supported_sources', []));
        $data = $request->validate([
            'image' => 'required|string',
            'camera_id' => 'nullable|exists:cameras,id',
            'require_liveness' => 'boolean',
            'liveness_frames' => 'nullable|array|max:30',
            'liveness_frames.*' => 'string',
            'session_id' => 'nullable|string|max:128',
            'source' => 'nullable|string|in:'.$sources,
        ]);

        $camera = isset($data['camera_id']) ? Camera::find($data['camera_id']) : null;
        $source = $data['source'] ?? CameraSourceResolver::fromStreamUrl($camera?->stream_url);
        $sessionId = $data['session_id'] ?? ($camera ? 'camera-'.$camera->id : null);

        $result = $this->ai->recognize(
            $data['image'],
            $data['require_liveness'] ?? true,
            $data['liveness_frames'] ?? null,
            $sessionId,
            $source,
        );

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Recognition failed'], 503);
        }

        return response()->json(array_merge($result, $this->slaMeta(
            (int) ($result['processing_ms'] ?? 0),
            $result
        )));
    }

    public function recognizeStream(Request $request): JsonResponse
    {
        $data = $request->validate([
            'camera_id' => 'required|exists:cameras,id',
            'require_liveness' => 'boolean',
            'session_id' => 'nullable|string|max:128',
        ]);

        $camera = Camera::findOrFail($data['camera_id']);
        if (! $camera->stream_url) {
            return response()->json(['message' => 'Camera has no stream URL'], 422);
        }

        $source = CameraSourceResolver::fromStreamUrl($camera->stream_url);
        $sessionId = $data['session_id'] ?? 'camera-'.$camera->id;

        $result = $this->ai->recognizeStream(
            $camera->stream_url,
            $data['require_liveness'] ?? false,
            $sessionId,
            $source,
        );

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Stream recognition failed'], 503);
        }

        if ($request->boolean('record_attendance', false) && ($result['employee_id'] ?? null)) {
            $capture = $this->ai->captureStream($camera->stream_url);
            if ($capture['success'] ?? false) {
                return $this->identify(Request::create('', 'POST', [
                    'image' => $capture['image'],
                    'camera_id' => $camera->id,
                    'require_liveness' => $data['require_liveness'] ?? false,
                    'source' => $source,
                    'session_id' => $sessionId,
                ]));
            }
        }

        return response()->json(array_merge([
            'camera_id' => $camera->id,
            'source' => $source,
        ], $result, $this->slaMeta((int) ($result['processing_ms'] ?? 0), $result)));
    }

    public function events(Request $request): JsonResponse
    {
        $events = RecognitionEvent::with(['employee', 'camera'])
            ->when($request->result, fn ($q, $r) => $q->where('result', $r))
            ->when($request->date_from, fn ($q, $d) => $q->where('recognized_at', '>=', $d))
            ->when($request->date_to, fn ($q, $d) => $q->where('recognized_at', '<=', $d))
            ->orderByDesc('recognized_at')
            ->paginate($request->integer('per_page', 50));

        $events->getCollection()->transform(fn (RecognitionEvent $e) => $this->formatEvent($e));

        return response()->json($events);
    }

    public function verifyLiveness(Request $request): JsonResponse
    {
        $data = $request->validate([
            'frames' => 'required|array|min:1|max:30',
            'frames.*' => 'string',
        ]);

        $result = $this->ai->verifyLiveness($data['frames']);

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Liveness verification failed'], 503);
        }

        return response()->json($result);
    }

    public function snapshot(RecognitionEvent $event): StreamedResponse|JsonResponse
    {
        if (! $event->snapshot_path || ! Storage::disk('local')->exists($event->snapshot_path)) {
            return response()->json(['message' => 'Snapshot not found'], 404);
        }

        return Storage::disk('local')->response($event->snapshot_path, 'snapshot.jpg', [
            'Content-Type' => 'image/jpeg',
        ]);
    }

    public function unknownSummary(): JsonResponse
    {
        $today = now()->toDateString();

        return response()->json([
            'today' => RecognitionEvent::where('result', 'unknown')
                ->whereDate('recognized_at', $today)
                ->count(),
            'unreviewed' => RecognitionEvent::where('result', 'unknown')
                ->whereDate('recognized_at', '>=', now()->subDays(7)->toDateString())
                ->count(),
        ]);
    }

    private function formatEvent(RecognitionEvent $event): array
    {
        $data = $event->toArray();
        $data['snapshot_url'] = $event->snapshotUrl();

        return $data;
    }

    /** NFR-001: Recognition speed SLA metadata */
    private function slaMeta(int $processingMs, ?array $aiResult = null): array
    {
        $recognitionMs = (int) ($aiResult['recognition_ms'] ?? $processingMs);
        $livenessMs = isset($aiResult['liveness_ms']) ? (int) $aiResult['liveness_ms'] : null;

        return [
            'processing_ms' => $processingMs,
            'recognition_ms' => $recognitionMs,
            'liveness_ms' => $livenessMs,
            'sla_ms' => config('nfr.recognition_sla_ms', 300),
            'liveness_sla_ms' => config('nfr.liveness_sla_ms', 500),
            'sla_met' => $this->nfr->recognitionSlaMet($recognitionMs),
            'liveness_sla_met' => $livenessMs === null || $livenessMs <= config('nfr.liveness_sla_ms', 500),
            'sla' => $aiResult['sla'] ?? null,
        ];
    }

    private function eventMetadata(array $result, string $source): array
    {
        return [
            'liveness_reason' => $result['liveness_reason'] ?? null,
            'liveness_checks' => $result['liveness_checks'] ?? null,
            'liveness_ms' => $result['liveness_ms'] ?? null,
            'recognition_ms' => $result['recognition_ms'] ?? null,
            'spoof_type' => $result['spoof_type'] ?? null,
            'source' => $source,
            'track_id' => $result['track_id'] ?? null,
            'quality_score' => $result['quality_score'] ?? null,
            'pipeline_stages' => isset($result['pipeline'])
                ? array_column($result['pipeline'], 'stage')
                : null,
        ];
    }
}
