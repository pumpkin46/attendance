<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Employee;
use App\Models\RecognitionEvent;
use App\Services\AiRecognitionClient;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PrivacyController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly AiRecognitionClient $ai,
    ) {}

    /** NFR-008: Privacy policy and GDPR metadata */
    public function policy(): JsonResponse
    {
        return response()->json([
            'enabled' => config('privacy.enabled'),
            'controller' => config('privacy.controller'),
            'lawful_basis' => config('privacy.lawful_basis'),
            'data_categories' => config('privacy.data_categories'),
            'subject_rights' => config('privacy.subject_rights'),
            'retention_days' => config('privacy.retention_days'),
            'contact' => config('privacy.controller.contact_email'),
        ]);
    }

    /** NFR-008: Data portability — export user's audit activity */
    public function exportMyData(Request $request): JsonResponse
    {
        $user = $request->user();

        $auditLogs = AuditLog::query()
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(500)
            ->get(['action', 'entity_type', 'entity_id', 'ip_address', 'created_at']);

        return response()->json([
            'exported_at' => now()->toIso8601String(),
            'user' => $user->only(['id', 'name', 'email', 'created_at']),
            'audit_logs' => $auditLogs,
            'note' => 'Biometric embeddings are stored as mathematical vectors. Contact your administrator for full erasure requests.',
        ]);
    }

    /** NFR-008: Right to erasure — remove employee biometric and attendance data */
    public function eraseEmployee(Request $request, Employee $employee): JsonResponse
    {
        $request->validate([
            'confirm' => 'required|accepted',
            'reason' => 'nullable|string|max:500',
        ]);

        $this->ai->deleteEmployee((string) $employee->id);

        $employee->faceEmbeddings()->delete();
        $employee->update([
            'face_enrolled' => false,
            'face_enrolled_at' => null,
        ]);

        RecognitionEvent::query()
            ->where('employee_id', $employee->id)
            ->update(['employee_id' => null]);

        $this->audit->log('privacy.employee_erasure', $employee, null, [
            'reason' => $request->reason,
            'requested_by' => $request->user()->id,
        ]);

        return response()->json([
            'message' => 'Biometric data erased for employee. Attendance records anonymized.',
            'employee_id' => $employee->id,
        ]);
    }
}
