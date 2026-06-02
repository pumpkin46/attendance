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

class CameraController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly AiRecognitionClient $ai,
        private readonly CameraMonitoringService $monitoring,
    ) {}

    public function monitoring(): JsonResponse
    {
        return response()->json($this->monitoring->summary());
    }

    public function index(Request $request): JsonResponse
    {
        $cameras = Camera::with('location')
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('name')
            ->get()
            ->map(fn (Camera $c) => $this->monitoring->formatCamera($c));

        return response()->json($cameras);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => 'required|exists:locations,id',
            'name' => 'required|string|max:255',
            'device_id' => 'nullable|string|max:255|unique:cameras,device_id',
            'stream_url' => ['nullable', 'string', 'regex:/^(rtsp|rtmp|http|https):\/\/.+/i'],
            'status' => 'in:active,inactive,maintenance',
            'direction' => 'in:in,out,both',
            'deployment_mode' => 'in:cloud,edge',
        ]);

        if (empty($data['device_id'])) {
            $data['device_id'] = $this->generateDeviceId($data['name']);
        }

        $data['status'] ??= Camera::STATUS_ACTIVE;
        $data['direction'] ??= 'both';
        $data['deployment_mode'] ??= 'cloud';

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

    public function update(Request $request, Camera $camera): JsonResponse
    {
        $old = $camera->toArray();
        $camera->update($request->validate([
            'name' => 'sometimes|string|max:255',
            'location_id' => 'sometimes|exists:locations,id',
            'stream_url' => ['nullable', 'string', 'regex:/^(rtsp|rtmp|http|https):\/\/.+/i'],
            'status' => 'in:active,inactive,maintenance',
            'direction' => 'in:in,out,both',
            'deployment_mode' => 'in:cloud,edge',
            'is_active' => 'boolean',
        ]));
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
        ]);

        $this->monitoring->recordFrame($camera, isset($data['frame_rate_fps']) ? (float) $data['frame_rate_fps'] : null);

        return response()->json([
            'status' => 'ok',
            'last_heartbeat_at' => $camera->fresh()->last_heartbeat_at,
            'frame_rate_fps' => $camera->fresh()->frame_rate_fps,
        ]);
    }

    public function capture(Request $request, Camera $camera): JsonResponse
    {
        if (! $camera->stream_url) {
            return response()->json(['message' => 'Camera has no stream URL configured'], 422);
        }

        $capture = $this->ai->captureStream($camera->stream_url);

        if (! ($capture['success'] ?? false)) {
            return response()->json(['message' => $capture['error'] ?? 'Stream capture failed'], 503);
        }

        $this->monitoring->recordFrame($camera);

        $detect = $this->ai->detect($capture['image']);
        $response = [
            'camera_id' => $camera->id,
            'capture_ms' => $capture['processing_ms'] ?? 0,
            'image_width' => $capture['image_width'] ?? null,
            'image_height' => $capture['image_height'] ?? null,
            'faces' => $detect['faces'] ?? [],
            'face_count' => $detect['face_count'] ?? 0,
            'detect_ms' => $detect['processing_ms'] ?? 0,
            'frame_rate_fps' => $camera->fresh()->frame_rate_fps,
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
