<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Services\AiRecognitionClient;
use App\Services\AuditService;
use App\Services\FaceEnrollmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class FaceEnrollmentController extends Controller
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly FaceEnrollmentService $enrollment,
        private readonly AuditService $audit
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'min_images' => config('enrollment.min_images', 10),
            'max_images' => config('enrollment.max_images', 50),
            'retain_raw_images' => config('enrollment.retain_raw_images', false),
        ]);
    }

    public function validateImage(Request $request): JsonResponse
    {
        $request->validate(['image' => 'required|string']);

        return response()->json($this->enrollment->validateImage($request->image));
    }

    public function enrollBatch(Request $request, Employee $employee): JsonResponse
    {
        $min = config('enrollment.min_images', 10);
        $max = config('enrollment.max_images', 50);

        $request->validate([
            'images' => "required|array|min:{$min}|max:{$max}",
            'images.*' => 'required|string',
        ]);

        $result = $this->enrollment->enrollBatch($employee, $request->images);

        if (! ($result['success'] ?? false)) {
            return response()->json($result, 422);
        }

        return response()->json([
            'message' => 'Face enrollment completed',
            'employee' => $employee->fresh(),
            'embeddings_stored' => $result['embeddings_stored'],
            'average_quality_score' => $result['average_quality_score'],
            'session_id' => $result['session_id'],
            'raw_images_retained' => $result['raw_images_retained'],
        ], 201);
    }

    /** @deprecated Use enrollBatch — single-image shortcut */
    public function enroll(Request $request, Employee $employee): JsonResponse
    {
        $request->validate(['image' => 'required|string']);

        $result = $this->ai->enroll((string) $employee->id, $request->image);

        if (! ($result['success'] ?? false)) {
            return response()->json(['message' => $result['error'] ?? 'Enrollment failed'], 422);
        }

        $faissId = $result['faiss_id'] ?? Str::uuid()->toString();

        FaceEmbedding::updateOrCreate(
            ['employee_id' => $employee->id, 'is_primary' => true],
            ['faiss_id' => $faissId, 'version' => ($employee->faceEmbeddings()->max('version') ?? 0) + 1]
        );

        $employee->update([
            'face_enrolled' => true,
            'face_enrolled_at' => now(),
        ]);

        $this->audit->log('face.enrolled', $employee);

        return response()->json([
            'message' => 'Face enrolled successfully',
            'employee' => $employee->fresh(),
            'quality_score' => $result['quality_score'] ?? null,
        ]);
    }

    public function status(Employee $employee): JsonResponse
    {
        $session = $employee->faceEnrollmentSessions()->latest()->first();

        return response()->json([
            'face_enrolled' => $employee->face_enrolled,
            'face_enrolled_at' => $employee->face_enrolled_at,
            'embeddings_count' => $employee->faceEmbeddings()->count(),
            'last_session' => $session ? [
                'id' => $session->id,
                'image_count' => $session->image_count,
                'average_quality_score' => $session->average_quality_score,
                'raw_images_retained' => $session->raw_images_retained,
                'created_at' => $session->created_at,
            ] : null,
        ]);
    }
}
