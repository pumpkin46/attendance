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
        $poses = config('enrollment.required_poses', []);
        $labels = config('enrollment.pose_labels', []);
        $poseLabels = [];
        foreach ($poses as $pose) {
            $poseLabels[$pose] = $labels[$pose] ?? str_replace('_', ' ', ucfirst($pose));
        }

        return response()->json([
            'mode' => config('enrollment.mode', 'structured'),
            'required_poses' => $poses,
            'pose_labels' => $poseLabels,
            'min_images' => config('enrollment.min_images', 10),
            'max_images' => config('enrollment.max_images', 50),
            'retain_raw_images' => config('enrollment.retain_raw_images', false),
            'quality_rules' => [
                'reject_blurry' => true,
                'reject_dark' => true,
                'reject_occluded' => true,
                'reject_multiple_faces' => true,
                'reject_low_resolution' => true,
            ],
        ]);
    }

    public function validateImage(Request $request): JsonResponse
    {
        $rules = ['image' => 'required|string'];
        $allowed = config('enrollment.required_poses', []);
        if ($allowed !== []) {
            $rules['expected_pose'] = 'nullable|string|in:'.implode(',', $allowed);
        }
        $request->validate($rules);

        return response()->json(
            $this->enrollment->validateImage($request->image, $request->expected_pose)
        );
    }

    public function enrollStructured(Request $request, Employee $employee): JsonResponse
    {
        $required = config('enrollment.required_poses', []);
        $request->validate([
            'poses' => 'required|array',
            'poses.*' => 'required|string',
        ]);

        foreach ($required as $pose) {
            if (empty($request->input("poses.{$pose}"))) {
                return response()->json([
                    'success' => false,
                    'error' => "Missing required pose: {$pose}",
                    'missing_poses' => array_values(array_diff(
                        $required,
                        array_keys(array_filter($request->poses ?? []))
                    )),
                ], 422);
            }
        }

        $result = $this->enrollment->enrollStructured($employee, $request->poses);

        if (! ($result['success'] ?? false)) {
            return response()->json($result, 422);
        }

        return response()->json([
            'message' => 'Face enrollment completed',
            'employee' => $employee->fresh(),
            'embeddings_stored' => $result['embeddings_stored'],
            'average_quality_score' => $result['average_quality_score'],
            'enrollment_score' => $result['enrollment_score'],
            'session_id' => $result['session_id'],
            'accepted' => $result['accepted'] ?? [],
        ], 201);
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
                'enrollment_score' => $session->enrollment_score,
                'enrollment_mode' => $session->enrollment_mode ?? 'batch',
                'raw_images_retained' => $session->raw_images_retained,
                'poses' => $session->images()->whereNotNull('pose_type')->pluck('pose_type')->values(),
                'created_at' => $session->created_at,
            ] : null,
        ]);
    }
}
