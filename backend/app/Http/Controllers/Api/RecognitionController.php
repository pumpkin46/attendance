<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\RecognitionEvent;
use App\Services\AiRecognitionClient;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class RecognitionController extends Controller
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly AttendanceService $attendance
    ) {}

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
        $data = $request->validate([
            'image' => 'required|string',
            'camera_id' => 'nullable|exists:cameras,id',
            'require_liveness' => 'boolean',
            'source' => 'nullable|string|in:webcam,upload,rtsp,ip_camera',
        ]);

        $camera = isset($data['camera_id']) ? Camera::find($data['camera_id']) : null;
        $threshold = config('services.ai.threshold', 0.95);
        $requireLiveness = $data['require_liveness'] ?? true;
        $source = $data['source'] ?? ($camera?->stream_url ? 'rtsp' : 'upload');

        $result = $this->ai->identify($data['image'], $requireLiveness);

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
                'metadata' => [
                    'liveness_reason' => $result['liveness_reason'] ?? 'liveness_failed',
                    'liveness_checks' => $result['liveness_checks'] ?? null,
                    'source' => $source,
                ],
                'recognized_at' => now(),
            ]);

            return response()->json([
                'matched' => false,
                'reason' => $result['liveness_reason'] ?? 'liveness_failed',
                'processing_ms' => $processingMs,
                'liveness_score' => $result['liveness_score'] ?? null,
                'liveness_checks' => $result['liveness_checks'] ?? null,
            ]);
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

            return response()->json([
                'matched' => false,
                'reason' => $employeeId ? 'low_confidence' : 'unknown',
                'confidence' => $confidence,
                'processing_ms' => $processingMs,
                'event_id' => $event->id,
                'snapshot_url' => $event->snapshotUrl(),
            ]);
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

            return response()->json([
                'matched' => false,
                'reason' => 'unknown',
                'event_id' => $event->id,
                'snapshot_url' => $event->snapshotUrl(),
            ]);
        }

        $attendanceResult = $this->attendance->processRecognition(
            $employee,
            $camera,
            $confidence,
            $livenessPassed,
            $processingMs,
            $imageHash
        );

        return response()->json([
            'matched' => true,
            'employee' => $employee->only(['id', 'employee_code', 'first_name', 'last_name']),
            'confidence' => $confidence,
            'processing_ms' => $processingMs,
            'liveness_passed' => $livenessPassed,
            'liveness_score' => $result['liveness_score'] ?? null,
            'attendance' => $attendanceResult,
        ]);
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
}
