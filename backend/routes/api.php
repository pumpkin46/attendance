<?php

use App\Http\Controllers\Api\AttendanceAnomalyController;
use App\Http\Controllers\Api\AccessPointController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\MonitoringCenterController;
use App\Http\Controllers\Api\VisitorController;
use App\Http\Controllers\Api\AttendancePolicyController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CameraController;
use App\Http\Controllers\Api\EdgeDeviceApiController;
use App\Http\Controllers\Api\EdgeDeviceController;
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
use App\Http\Controllers\Api\BuildingIntegrationController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\SecurityController;
use App\Http\Controllers\Api\SecurityMonitoringController;
use App\Http\Controllers\Api\VisitorKioskApiController;
use App\Http\Controllers\Api\VisitorKioskController;
use App\Http\Controllers\Api\ShiftController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', HealthController::class);
    Route::get('/privacy/policy', [PrivacyController::class, 'policy']);

    Route::get('/auth/config', [AuthController::class, 'config']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::post('/auth/ldap', [AuthController::class, 'ldapLogin']);
    Route::post('/auth/saml/callback', [AuthController::class, 'samlCallback']);
    Route::get('/auth/oauth/{provider}/redirect', [AuthController::class, 'oauthRedirect']);
    Route::get('/auth/oauth/{provider}/callback', [AuthController::class, 'oauthCallback']);

    Route::post('/rfid/tap', [RfidTapController::class, 'tap'])->middleware('rfid.reader');

    Route::middleware('visitor.kiosk')->prefix('kiosk/visitor')->group(function () {
        Route::get('/config', [VisitorKioskApiController::class, 'config']);
        Route::get('/hosts', [VisitorKioskApiController::class, 'hosts']);
        Route::post('/lookup', [VisitorKioskApiController::class, 'lookup']);
        Route::post('/register', [VisitorKioskApiController::class, 'register']);
        Route::post('/identify', [VisitorKioskApiController::class, 'identify']);
        Route::post('/visitors/{visitor}/enroll-face', [VisitorKioskApiController::class, 'enrollFace']);
        Route::post('/visitors/{visitor}/check-in', [VisitorKioskApiController::class, 'checkIn']);
        Route::post('/heartbeat', [VisitorKioskApiController::class, 'heartbeat']);
    });

    Route::middleware('edge.device')->prefix('edge')->group(function () {
        Route::get('/config', [EdgeDeviceApiController::class, 'config']);
        Route::get('/embeddings', [EdgeDeviceApiController::class, 'embeddings']);
        Route::post('/sync-ack', [EdgeDeviceApiController::class, 'syncAck']);
        Route::post('/heartbeat', [EdgeDeviceApiController::class, 'heartbeat']);
        Route::post('/report', [EdgeDeviceApiController::class, 'report']);
    });

    Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);

        Route::get('security/config', [SecurityController::class, 'config'])->middleware('permission:security.view');

        Route::get('organizations', [OrganizationController::class, 'index']);
        Route::post('organizations', [OrganizationController::class, 'store']);
        Route::get('organizations/{organization}', [OrganizationController::class, 'show']);

        Route::get('branches', [BranchController::class, 'index']);
        Route::post('branches', [BranchController::class, 'store'])->middleware('permission:branches.manage');

        Route::get('departments', [DepartmentController::class, 'index']);
        Route::post('departments', [DepartmentController::class, 'store'])->middleware('permission:departments.manage');

        Route::apiResource('employees', EmployeeController::class);
        Route::get('enrollment/config', [FaceEnrollmentController::class, 'config']);
        Route::post('enrollment/validate-image', [FaceEnrollmentController::class, 'validateImage']);
        Route::post('employees/{employee}/enroll-face-batch', [FaceEnrollmentController::class, 'enrollBatch']);
        Route::post('employees/{employee}/enroll-face-structured', [FaceEnrollmentController::class, 'enrollStructured']);
        Route::post('employees/{employee}/enroll-face', [FaceEnrollmentController::class, 'enroll']);
        Route::get('employees/{employee}/face-status', [FaceEnrollmentController::class, 'status']);

        Route::get('attendance/config', [AttendanceController::class, 'config']);
        Route::get('attendance', [AttendanceController::class, 'index']);
        Route::get('attendance/today', [AttendanceController::class, 'today']);
        Route::apiResource('attendance-policies', AttendancePolicyController::class)->middleware('permission:shifts.manage');
        Route::post('attendance/manual', [AttendanceController::class, 'manual'])->middleware('permission:attendance.manage');

        Route::get('anomalies/summary', [AttendanceAnomalyController::class, 'summary'])->middleware('permission:reports.view');
        Route::get('anomalies', [AttendanceAnomalyController::class, 'index'])->middleware('permission:reports.view');
        Route::post('anomalies/detect', [AttendanceAnomalyController::class, 'detect'])->middleware('permission:attendance.manage');
        Route::patch('anomalies/{attendance_anomaly}', [AttendanceAnomalyController::class, 'update'])->middleware('permission:attendance.manage');

        Route::apiResource('shifts', ShiftController::class)->middleware('permission:shifts.manage');
        Route::post('shifts/{shift}/assign', [ShiftController::class, 'assign'])->middleware('permission:shifts.manage');

        Route::get('holidays', [HolidayController::class, 'index']);
        Route::post('holidays', [HolidayController::class, 'store'])->middleware('permission:holidays.manage');

        Route::get('leave-requests', [LeaveRequestController::class, 'index']);
        Route::post('leave-requests', [LeaveRequestController::class, 'store']);
        Route::patch('leave-requests/{leaveRequest}', [LeaveRequestController::class, 'update'])->middleware('permission:leave.approve');

        Route::get('locations', [LocationController::class, 'index']);

        Route::get('cameras/config', [CameraController::class, 'config']);
        Route::get('cameras/monitoring', [CameraController::class, 'monitoring']);
        Route::get('cameras/{camera}/health', [CameraController::class, 'health'])->middleware('permission:cameras.manage');
        Route::apiResource('cameras', CameraController::class)->middleware('permission:cameras.manage');
        Route::post('cameras/{camera}/heartbeat', [CameraController::class, 'heartbeat']);
        Route::post('cameras/{camera}/capture', [CameraController::class, 'capture'])->middleware('permission:cameras.manage');

        Route::get('edge-devices/monitoring', [EdgeDeviceController::class, 'monitoring']);
        Route::apiResource('edge-devices', EdgeDeviceController::class)->middleware('permission:edge.manage');
        Route::post('edge-devices/{edge_device}/regenerate-token', [EdgeDeviceController::class, 'regenerateToken'])
            ->middleware('permission:edge.manage');
        Route::get('edge-devices/{edge_device}/agent-config', [EdgeDeviceController::class, 'agentConfig'])
            ->middleware('permission:edge.manage');

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

        Route::get('recognition/config', [RecognitionController::class, 'config']);
        Route::get('recognition/metrics', [RecognitionController::class, 'metrics'])->middleware('permission:recognition.view');
        Route::post('recognition/detect', [RecognitionController::class, 'detect']);
        Route::post('recognition/recognize', [RecognitionController::class, 'recognize']);
        Route::post('recognition/recognize-stream', [RecognitionController::class, 'recognizeStream']);
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

        Route::get('monitoring/dashboard', [MonitoringCenterController::class, 'dashboard']);
        Route::get('monitoring/live-feed', [MonitoringCenterController::class, 'liveFeed']);

        Route::get('access-points/config', [AccessPointController::class, 'config']);
        Route::apiResource('access-points', AccessPointController::class)->middleware('permission:cameras.manage');
        Route::post('access-points/{access_point}/execute', [AccessPointController::class, 'execute'])
            ->middleware('permission:cameras.manage');

        Route::get('building/config', [BuildingIntegrationController::class, 'config']);
        Route::get('building/connectors', [BuildingIntegrationController::class, 'index'])
            ->middleware('permission:building.manage');
        Route::post('building/connectors', [BuildingIntegrationController::class, 'store'])
            ->middleware('permission:building.manage');
        Route::patch('building/connectors/{buildingConnector}', [BuildingIntegrationController::class, 'update'])
            ->middleware('permission:building.manage');
        Route::delete('building/connectors/{buildingConnector}', [BuildingIntegrationController::class, 'destroy'])
            ->middleware('permission:building.manage');
        Route::post('building/connectors/{buildingConnector}/test', [BuildingIntegrationController::class, 'testDispatch'])
            ->middleware('permission:building.manage');
        Route::get('building/events', [BuildingIntegrationController::class, 'events'])
            ->middleware('permission:building.manage');
        Route::post('building/occupancy/publish', [BuildingIntegrationController::class, 'occupancy'])
            ->middleware('permission:building.manage');

        Route::get('security-monitoring/config', [SecurityMonitoringController::class, 'config'])
            ->middleware('permission:security.monitor');
        Route::get('security-monitoring/dashboard', [SecurityMonitoringController::class, 'dashboard'])
            ->middleware('permission:security.monitor');
        Route::get('security-monitoring/alerts', [SecurityMonitoringController::class, 'index'])
            ->middleware('permission:security.monitor');
        Route::get('security-monitoring/alerts/{securityAlert}', [SecurityMonitoringController::class, 'show'])
            ->middleware('permission:security.monitor');
        Route::post('security-monitoring/alerts/{securityAlert}/acknowledge', [SecurityMonitoringController::class, 'acknowledge'])
            ->middleware('permission:security.monitor');
        Route::post('security-monitoring/alerts/{securityAlert}/resolve', [SecurityMonitoringController::class, 'resolve'])
            ->middleware('permission:security.monitor');

        Route::get('visitor-kiosks', [VisitorKioskController::class, 'index'])
            ->middleware('permission:visitor_kiosks.manage');
        Route::post('visitor-kiosks', [VisitorKioskController::class, 'store'])
            ->middleware('permission:visitor_kiosks.manage');
        Route::patch('visitor-kiosks/{visitorKiosk}', [VisitorKioskController::class, 'update'])
            ->middleware('permission:visitor_kiosks.manage');
        Route::post('visitor-kiosks/{visitorKiosk}/regenerate-token', [VisitorKioskController::class, 'regenerateToken'])
            ->middleware('permission:visitor_kiosks.manage');

        Route::apiResource('visitors', VisitorController::class);
        Route::post('visitors/{visitor}/enroll-face', [VisitorController::class, 'enrollFace']);

        Route::get('audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');

        Route::get('privacy/my-data', [PrivacyController::class, 'exportMyData']);
        Route::post('employees/{employee}/privacy/erase', [PrivacyController::class, 'eraseEmployee'])
            ->middleware('permission:employees.manage');
    });
});
