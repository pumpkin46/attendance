<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Services\AiRecognitionClient;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class FaceEnrollmentController extends Controller
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly AuditService $audit
    ) {}

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
        return response()->json([
            'face_enrolled' => $employee->face_enrolled,
            'face_enrolled_at' => $employee->face_enrolled_at,
            'embeddings_count' => $employee->faceEmbeddings()->count(),
        ]);
    }
}
