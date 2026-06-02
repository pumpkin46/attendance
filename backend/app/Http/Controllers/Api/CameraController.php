<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Services\AiRecognitionClient;
use App\Services\AuditService;
use App\Services\CameraMonitoringService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class CameraController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly AiRecognitionClient $ai,
        private readonly CameraMonitoringService $monitoring,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'camera_types' => config('cameras.camera_types'),
            'zones' => config('cameras.zones'),
            'statuses' => config('cameras.statuses'),
            'directions' => config('cameras.directions'),
            'deployment_modes' => config('cameras.deployment_modes'),
            'online_threshold_seconds' => config('cameras.online_threshold_seconds'),
            'health_metrics' => [
                'online_status',
                'fps',
                'latency_ms',
                'bandwidth_kbps',
                'cpu_usage_percent',
                'gpu_usage_percent',
                'dropped_frames',
                'recognition_events',
            ],
        ]);
    }

    public function monitoring(): JsonResponse
    {
        return response()->json($this->monitoring->summary());
    }

    public function index(Request $request): JsonResponse
    {
        $cameras = Camera::with('location')
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->when($request->zone, fn ($q, $z) => $q->where('zone', $z))
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->orderBy('name')
            ->get()
            ->map(fn (Camera $c) => $this->monitoring->formatCamera($c));

        return response()->json($cameras);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateCamera($request);

        if (empty($data['device_id'])) {
            $data['device_id'] = $this->generateDeviceId($data['name']);
        }

        $data['status'] ??= Camera::STATUS_ACTIVE;
        $data['direction'] ??= 'both';
        $data['deployment_mode'] ??= 'cloud';
        $data['camera_type'] ??= 'rtsp';

        $maxCameras = config('nfr.max_cameras', 100);
        if (Camera::where('status', Camera::STATUS_ACTIVE)->count() >= $maxCameras) {
            return response()->json([
                'message' => "Maximum active camera limit reached (NFR-003: {$maxCameras})",
            ], 422);
        }

        $camera = Camera::create($data);
        $this->audit->log('camera.created', $camera);

        return response()->json($this->monitoring->formatCamera($camera->load('location')), 201);
    }

    public function show(Camera $camera): JsonResponse
    {
        return response()->json($this->monitoring->formatCamera($camera->load('location')));
    }

    public function health(Request $request, Camera $camera): JsonResponse
    {
        $hours = $request->integer('hours', 24);

        return response()->json($this->monitoring->healthDetail($camera->load('location'), $hours));
    }

    public function update(Request $request, Camera $camera): JsonResponse
    {
        $old = $camera->toArray();
        $camera->update($this->validateCamera($request, partial: true));
        $this->audit->log('camera.updated', $camera, $old, $camera->fresh()->toArray());

        return response()->json($this->monitoring->formatCamera($camera->fresh()->load('location')));
    }

    public function destroy(Camera $camera): JsonResponse
    {
        $camera->update(['status' => Camera::STATUS_INACTIVE, 'is_active' => false]);
        $this->audit->log('camera.deactivated', $camera);

        return response()->json(['message' => 'Camera deactivated']);
    }

    public function heartbeat(Request $request, Camera $camera): JsonResponse
    {
        $data = $request->validate([
            'frame_rate_fps' => 'nullable|numeric|min:0|max:120',
            'latency_ms' => 'nullable|integer|min:0',
            'bandwidth_kbps' => 'nullable|integer|min:0',
            'cpu_usage_percent' => 'nullable|numeric|min:0|max:100',
            'gpu_usage_percent' => 'nullable|numeric|min:0|max:100',
            'dropped_frames_delta' => 'nullable|integer|min:0',
            'resolution_width' => 'nullable|integer|min:1',
            'resolution_height' => 'nullable|integer|min:1',
        ]);

        $extended = isset($data['bandwidth_kbps'])
            || isset($data['cpu_usage_percent'])
            || isset($data['gpu_usage_percent'])
            || isset($data['dropped_frames_delta']);

        if ($extended) {
            $camera = $this->monitoring->recordHealth($camera, $data);
        } else {
            $this->monitoring->recordFrame(
                $camera,
                isset($data['frame_rate_fps']) ? (float) $data['frame_rate_fps'] : null,
                $data['latency_ms'] ?? null,
            );
            if (isset($data['resolution_width'], $data['resolution_height'])) {
                $camera->update([
                    'resolution_width' => $data['resolution_width'],
                    'resolution_height' => $data['resolution_height'],
                ]);
            }
            $camera = $camera->fresh();
        }

        return response()->json([
            'status' => 'ok',
            'camera' => $this->monitoring->formatCamera($camera),
        ]);
    }

    public function capture(Request $request, Camera $camera): JsonResponse
    {
        if (! $camera->stream_url) {
            return response()->json(['message' => 'Camera has no stream URL configured'], 422);
        }

        $captureStart = microtime(true);
        $capture = $this->ai->captureStream($camera->stream_url);
        $latencyMs = (int) round((microtime(true) - $captureStart) * 1000);

        if (! ($capture['success'] ?? false)) {
            $camera->increment('dropped_frames');
            $camera->update(['health_updated_at' => now()]);

            return response()->json(['message' => $capture['error'] ?? 'Stream capture failed'], 503);
        }

        $bandwidthKbps = null;
        if (! empty($capture['image'])) {
            $rawLen = strlen($capture['image']);
            $bandwidthKbps = $latencyMs > 0 ? (int) round(($rawLen * 8) / $latencyMs) : null;
        }

        $this->monitoring->recordHealth($camera, [
            'frame_rate_fps' => $camera->target_fps,
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

        $detect = $this->ai->detect($capture['image']);
        $response = [
            'camera_id' => $camera->id,
            'capture_ms' => $capture['processing_ms'] ?? $latencyMs,
            'latency_ms' => $camera->fresh()->latency_ms,
            'bandwidth_kbps' => $camera->fresh()->bandwidth_kbps,
            'image_width' => $capture['image_width'] ?? null,
            'image_height' => $capture['image_height'] ?? null,
            'faces' => $detect['faces'] ?? [],
            'face_count' => $detect['face_count'] ?? 0,
            'detect_ms' => $detect['processing_ms'] ?? 0,
            'health' => $this->monitoring->formatCamera($camera->fresh())['health'],
        ];

        if ($request->boolean('identify', false)) {
            $identifyRequest = Request::create('', 'POST', [
                'image' => $capture['image'],
                'camera_id' => $camera->id,
                'require_liveness' => $request->boolean('require_liveness', false),
                'source' => 'rtsp',
            ]);

            $identifyResponse = app(RecognitionController::class)->identify($identifyRequest);
            $response['identify'] = $identifyResponse->getData(true);
        }

        if ($request->boolean('include_image', false)) {
            $response['image'] = $capture['image'];
        }

        return response()->json($response);
    }

    private function validateCamera(Request $request, bool $partial = false): array
    {
        $types = implode(',', array_keys(config('cameras.camera_types', [])));
        $rules = [
            'location_id' => ($partial ? 'sometimes' : 'required').'|exists:locations,id',
            'name' => ($partial ? 'sometimes' : 'required').'|string|max:255',
            'camera_type' => 'nullable|string|in:'.$types,
            'zone' => 'nullable|string|max:64',
            'floor' => 'nullable|string|max:32',
            'device_id' => 'nullable|string|max:255|'.Rule::unique('cameras', 'device_id')->ignore($request->route('camera')),
            'stream_url' => ['nullable', 'string', 'regex:/^(rtsp|rtmp|http|https):\/\/.+/i'],
            'target_fps' => 'nullable|integer|min:1|max:120',
            'resolution_width' => 'nullable|integer|min:1|max:7680',
            'resolution_height' => 'nullable|integer|min:1|max:4320',
            'status' => 'in:active,inactive,maintenance',
            'direction' => 'in:in,out,both',
            'deployment_mode' => 'in:cloud,edge',
        ];

        return $request->validate($rules);
    }

    private function generateDeviceId(string $name): string
    {
        $base = Str::upper(Str::slug($name, '-'));
        $candidate = $base;
        $suffix = 1;

        while (Camera::where('device_id', $candidate)->exists()) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }
}
