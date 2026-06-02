<?php

use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CameraController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\FaceEnrollmentController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\HolidayController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Http\Controllers\Api\LocationController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PrivacyController;
use App\Http\Controllers\Api\RecognitionController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RfidCardController;
use App\Http\Controllers\Api\RfidEventController;
use App\Http\Controllers\Api\RfidReaderController;
use App\Http\Controllers\Api\RfidTapController;
use App\Http\Controllers\Api\ShiftController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', HealthController::class);
    Route::get('/privacy/policy', [PrivacyController::class, 'policy']);

    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::get('/auth/oauth/{provider}/redirect', [AuthController::class, 'oauthRedirect']);
    Route::get('/auth/oauth/{provider}/callback', [AuthController::class, 'oauthCallback']);

    Route::post('/rfid/tap', [RfidTapController::class, 'tap'])->middleware('rfid.reader');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);

        Route::apiResource('employees', EmployeeController::class);
        Route::get('enrollment/config', [FaceEnrollmentController::class, 'config']);
        Route::post('enrollment/validate-image', [FaceEnrollmentController::class, 'validateImage']);
        Route::post('employees/{employee}/enroll-face-batch', [FaceEnrollmentController::class, 'enrollBatch']);
        Route::post('employees/{employee}/enroll-face', [FaceEnrollmentController::class, 'enroll']);
        Route::get('employees/{employee}/face-status', [FaceEnrollmentController::class, 'status']);

        Route::get('attendance', [AttendanceController::class, 'index']);
        Route::get('attendance/today', [AttendanceController::class, 'today']);
        Route::post('attendance/manual', [AttendanceController::class, 'manual'])->middleware('permission:attendance.manage');

        Route::apiResource('shifts', ShiftController::class)->middleware('permission:shifts.manage');
        Route::post('shifts/{shift}/assign', [ShiftController::class, 'assign'])->middleware('permission:shifts.manage');

        Route::get('holidays', [HolidayController::class, 'index']);
        Route::post('holidays', [HolidayController::class, 'store'])->middleware('permission:holidays.manage');

        Route::get('leave-requests', [LeaveRequestController::class, 'index']);
        Route::post('leave-requests', [LeaveRequestController::class, 'store']);
        Route::patch('leave-requests/{leaveRequest}', [LeaveRequestController::class, 'update'])->middleware('permission:leave.approve');

        Route::get('locations', [LocationController::class, 'index']);

        Route::get('cameras/monitoring', [CameraController::class, 'monitoring']);
        Route::apiResource('cameras', CameraController::class)->middleware('permission:cameras.manage');
        Route::post('cameras/{camera}/heartbeat', [CameraController::class, 'heartbeat']);
        Route::post('cameras/{camera}/capture', [CameraController::class, 'capture'])->middleware('permission:cameras.manage');

        Route::apiResource('rfid-readers', RfidReaderController::class)->middleware('permission:rfid.manage');
        Route::post('rfid-readers/{rfid_reader}/regenerate-token', [RfidReaderController::class, 'regenerateToken'])
            ->middleware('permission:rfid.manage');
        Route::get('employees/{employee}/rfid-cards', [RfidCardController::class, 'index']);
        Route::post('employees/{employee}/rfid-cards', [RfidCardController::class, 'store'])
            ->middleware('permission:rfid.manage');
        Route::delete('rfid-cards/{rfid_card}', [RfidCardController::class, 'destroy'])
            ->middleware('permission:rfid.manage');
        Route::get('rfid-events', [RfidEventController::class, 'index'])->middleware('permission:rfid.manage');
        Route::post('rfid/simulate', [RfidTapController::class, 'simulate'])->middleware('permission:rfid.manage');

        Route::post('recognition/detect', [RecognitionController::class, 'detect']);
        Route::post('recognition/identify', [RecognitionController::class, 'identify']);
        Route::post('recognition/liveness/verify', [RecognitionController::class, 'verifyLiveness']);
        Route::get('recognition/events', [RecognitionController::class, 'events'])->middleware('permission:recognition.view');
        Route::get('recognition/events/{event}/snapshot', [RecognitionController::class, 'snapshot'])->middleware('permission:recognition.view');
        Route::get('recognition/unknown-summary', [RecognitionController::class, 'unknownSummary'])->middleware('permission:recognition.view');

        Route::get('notifications', [NotificationController::class, 'index']);
        Route::get('notifications/unread-count', [NotificationController::class, 'unreadCount']);
        Route::post('notifications/{id}/read', [NotificationController::class, 'markRead']);
        Route::post('notifications/read-all', [NotificationController::class, 'markAllRead']);

        Route::get('reports/daily', [ReportController::class, 'daily'])->middleware('permission:reports.view');
        Route::get('reports/monthly', [ReportController::class, 'monthly'])->middleware('permission:reports.view');
        Route::get('reports/attendance-summary', [ReportController::class, 'attendanceSummary'])->middleware('permission:reports.view');
        Route::get('reports/overtime', [ReportController::class, 'overtime'])->middleware('permission:reports.view');
        Route::get('reports/unknown-persons', [ReportController::class, 'unknownPersons'])->middleware('permission:reports.view');
        Route::get('reports/export', [ReportController::class, 'export'])->middleware('permission:reports.export');

        Route::get('audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');

        Route::get('privacy/my-data', [PrivacyController::class, 'exportMyData']);
        Route::post('employees/{employee}/privacy/erase', [PrivacyController::class, 'eraseEmployee'])
            ->middleware('permission:employees.manage');
    });
});
