<?php

namespace App\Services;

use App\Models\AccessEvent;
use App\Models\AccessPoint;
use App\Models\Employee;
use App\Models\Visitor;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AccessControlService
{
    public function __construct(
        private readonly LiveEventService $liveEvents,
        private readonly BuildingIntegrationService $building,
        private readonly SecurityMonitoringService $security,
    ) {}

    public function evaluateAndExecute(
        AccessPoint $point,
        ?Employee $employee,
        ?Visitor $visitor,
        float $confidence,
        bool $livenessPassed,
        ?string $action = null,
    ): array {
        $action ??= $point->default_action;
        $conditions = config('access_control.grant_conditions', []);

        $authorized = $employee !== null || ($visitor !== null && $visitor->isActive());
        $recognized = $authorized;
        $faceOk = $recognized && $confidence >= (float) $point->min_confidence;
        $livenessOk = ! $point->require_liveness || $livenessPassed;

        $granted = true;
        $denyReason = null;

        if ($conditions['face_recognized'] ?? true) {
            if (! $faceOk) {
                $granted = false;
                $denyReason = $recognized ? 'low_confidence' : 'not_recognized';
            }
        }

        if ($granted && ($conditions['liveness_passed'] ?? true) && ! $livenessOk) {
            $granted = false;
            $denyReason = 'liveness_failed';
        }

        if ($granted && ($conditions['access_authorized'] ?? true) && ! $authorized) {
            $granted = false;
            $denyReason = 'access_not_authorized';
        }

        $event = AccessEvent::create([
            'access_point_id' => $point->id,
            'employee_id' => $employee?->id,
            'visitor_id' => $visitor?->id,
            'action' => $action,
            'granted' => $granted,
            'deny_reason' => $denyReason,
            'confidence' => $confidence,
            'liveness_passed' => $livenessPassed,
            'occurred_at' => now(),
        ]);

        if ($granted) {
            $this->executeHardwareAction($point, $action);
            $name = $employee
                ? trim("{$employee->first_name} {$employee->last_name}")
                : ($visitor?->name ?? 'Guest');
            $this->liveEvents->record(
                'access_granted',
                now()->format('H:i')." {$name} — ".config("access_control.actions.{$action}", $action),
                $point->organization_id,
                [
                    'access_point_id' => $point->id,
                    'employee_id' => $employee?->id,
                    'visitor_id' => $visitor?->id,
                    'payload' => ['action' => $action],
                ],
            );

            $buildingContext = [
                'organization_id' => $point->organization_id,
                'location_id' => $point->location_id,
                'access_point_id' => $point->id,
                'access_point' => $point->name,
                'action' => $action,
                'person_type' => $employee ? 'employee' : 'visitor',
                'person_name' => $name,
            ];
            $this->building->onAccessGranted($buildingContext);

            if ($employee) {
                $this->security->checkTailgating($employee, $point);
                $this->security->onAfterHoursAccess($point->camera()->first(), $employee);
            }
        } else {
            $this->liveEvents->record(
                'access_denied',
                now()->format('H:i')." Access denied at {$point->name} ({$denyReason})",
                $point->organization_id,
                ['access_point_id' => $point->id, 'payload' => ['reason' => $denyReason]],
            );

            $this->building->onAccessDenied([
                'organization_id' => $point->organization_id,
                'location_id' => $point->location_id,
                'access_point_id' => $point->id,
                'deny_reason' => $denyReason,
            ]);
            $this->security->onAccessDenied($point, $denyReason, $employee, $visitor);
        }

        return [
            'granted' => $granted,
            'action' => $action,
            'deny_reason' => $denyReason,
            'access_event_id' => $event->id,
        ];
    }

    public function manualAction(AccessPoint $point, string $action): array
    {
        $allowed = array_keys(config('access_control.actions', []));
        if (! in_array($action, $allowed, true)) {
            return ['success' => false, 'error' => 'invalid_action'];
        }

        $this->executeHardwareAction($point, $action);

        AccessEvent::create([
            'access_point_id' => $point->id,
            'action' => $action,
            'granted' => true,
            'metadata' => ['manual' => true],
            'occurred_at' => now(),
        ]);

        return ['success' => true, 'action' => $action];
    }

    private function executeHardwareAction(AccessPoint $point, string $action): void
    {
        if (! $point->controller_url) {
            Log::info('Access control (simulated)', [
                'point' => $point->name,
                'action' => $action,
            ]);

            return;
        }

        try {
            Http::timeout(3)->post($point->controller_url, [
                'action' => $action,
                'device_type' => $point->device_type,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Access controller unreachable', [
                'point' => $point->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function findPointForCamera(?int $cameraId): ?AccessPoint
    {
        if (! $cameraId) {
            return null;
        }

        return AccessPoint::where('camera_id', $cameraId)
            ->where('is_active', true)
            ->first();
    }
}
