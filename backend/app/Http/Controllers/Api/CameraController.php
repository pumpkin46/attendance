<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Services\AiRecognitionClient;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CameraController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly AiRecognitionClient $ai,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $cameras = Camera::with('location')
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('name')
            ->get();

        return response()->json($cameras);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => 'required|exists:locations,id',
            'name' => 'required|string',
            'device_id' => 'required|string|unique:cameras,device_id',
            'stream_url' => ['nullable', 'string', 'regex:/^(rtsp|rtmp|http|https):\/\/.+/i'],
            'direction' => 'in:in,out,both',
        ]);

        $camera = Camera::create($data);
        $this->audit->log('camera.created', $camera);

        return response()->json($camera->load('location'), 201);
    }

    public function show(Camera $camera): JsonResponse
    {
        return response()->json($camera->load('location'));
    }

    public function update(Request $request, Camera $camera): JsonResponse
    {
        $old = $camera->toArray();
        $camera->update($request->validate([
            'name' => 'sometimes|string',
            'stream_url' => ['nullable', 'string', 'regex:/^(rtsp|rtmp|http|https):\/\/.+/i'],
            'direction' => 'in:in,out,both',
            'is_active' => 'boolean',
        ]));
        $this->audit->log('camera.updated', $camera, $old, $camera->fresh()->toArray());

        return response()->json($camera->fresh());
    }

    public function destroy(Camera $camera): JsonResponse
    {
        $camera->update(['is_active' => false]);
        $this->audit->log('camera.deactivated', $camera);

        return response()->json(['message' => 'Camera deactivated']);
    }

    public function heartbeat(Camera $camera): JsonResponse
    {
        $camera->update(['last_heartbeat_at' => now()]);

        return response()->json(['status' => 'ok', 'last_heartbeat_at' => $camera->last_heartbeat_at]);
    }

    /**
     * FR-009: Capture a frame from RTSP/IP camera stream and optionally run recognition.
     */
    public function capture(Request $request, Camera $camera): JsonResponse
    {
        if (! $camera->stream_url) {
            return response()->json(['message' => 'Camera has no stream URL configured'], 422);
        }

        $capture = $this->ai->captureStream($camera->stream_url);

        if (! ($capture['success'] ?? false)) {
            return response()->json(['message' => $capture['error'] ?? 'Stream capture failed'], 503);
        }

        $camera->update(['last_heartbeat_at' => now()]);

        $detect = $this->ai->detect($capture['image']);
        $response = [
            'camera_id' => $camera->id,
            'capture_ms' => $capture['processing_ms'] ?? 0,
            'image_width' => $capture['image_width'] ?? null,
            'image_height' => $capture['image_height'] ?? null,
            'faces' => $detect['faces'] ?? [],
            'face_count' => $detect['face_count'] ?? 0,
            'detect_ms' => $detect['processing_ms'] ?? 0,
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
}
