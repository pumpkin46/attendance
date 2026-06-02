<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Models\FaceEnrollmentImage;
use App\Models\FaceEnrollmentSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class FaceEnrollmentService
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly AuditService $audit
    ) {}

    public function validateImage(string $imageBase64): array
    {
        return $this->ai->validateImage($imageBase64);
    }

    public function enrollBatch(Employee $employee, array $images): array
    {
        $min = config('enrollment.min_images', 10);
        $max = config('enrollment.max_images', 50);

        if (count($images) < $min) {
            return ['success' => false, 'error' => "Minimum {$min} images required"];
        }
        if (count($images) > $max) {
            return ['success' => false, 'error' => "Maximum {$max} images allowed"];
        }

        $result = $this->ai->enrollBatch((string) $employee->id, $images);

        if (! ($result['success'] ?? false)) {
            return $result;
        }

        $retainRaw = config('enrollment.retain_raw_images', false);
        $version = ($employee->faceEmbeddings()->max('version') ?? 0) + 1;

        return DB::transaction(function () use ($employee, $images, $result, $retainRaw, $version) {
            $employee->faceEmbeddings()->delete();

            $session = FaceEnrollmentSession::create([
                'employee_id' => $employee->id,
                'image_count' => $result['embeddings_stored'],
                'average_quality_score' => $result['average_quality_score'] ?? null,
                'version' => $version,
                'raw_images_retained' => $retainRaw,
            ]);

            $accepted = $result['accepted'] ?? [];
            $faissIds = $result['faiss_ids'] ?? [];

            foreach ($accepted as $i => $item) {
                $idx = $item['index'] ?? $i;
                $quality = $item['quality_score'] ?? null;
                $checks = $item['checks'] ?? null;
                $storagePath = null;

                if ($retainRaw && isset($images[$idx])) {
                    $storagePath = $this->storeRawImage($employee->id, $session->id, $idx, $images[$idx]);
                }

                FaceEnrollmentImage::create([
                    'face_enrollment_session_id' => $session->id,
                    'image_index' => $idx,
                    'storage_path' => $storagePath,
                    'quality_score' => $quality,
                    'validation_checks' => $checks,
                ]);

                if (isset($faissIds[$i])) {
                    FaceEmbedding::create([
                        'employee_id' => $employee->id,
                        'face_enrollment_session_id' => $session->id,
                        'faiss_id' => $faissIds[$i],
                        'quality_score' => $quality,
                        'image_index' => $idx,
                        'version' => $version,
                        'is_primary' => $i === 0,
                    ]);
                }
            }

            $employee->update([
                'face_enrolled' => true,
                'face_enrolled_at' => now(),
            ]);

            $this->audit->log('face.enrolled_batch', $employee, null, [
                'session_id' => $session->id,
                'embeddings' => count($faissIds),
                'raw_retained' => $retainRaw,
            ]);

            return array_merge($result, [
                'session_id' => $session->id,
                'raw_images_retained' => $retainRaw,
            ]);
        });
    }

    private function storeRawImage(int $employeeId, int $sessionId, int $index, string $imageBase64): string
    {
        $disk = config('enrollment.storage_disk', 'local');
        $base = config('enrollment.storage_path', 'enrollment');
        $path = "{$base}/{$employeeId}/{$sessionId}/{$index}.jpg";

        $data = $imageBase64;
        if (str_contains($data, ',')) {
            $data = explode(',', $data, 2)[1];
        }

        Storage::disk($disk)->put($path, base64_decode($data));

        return $path;
    }
}
