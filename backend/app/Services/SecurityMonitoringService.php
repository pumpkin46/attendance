<?php

namespace App\Services;

use App\Models\AccessEvent;
use App\Models\AccessPoint;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\RecognitionEvent;
use App\Models\SecurityAlert;
use App\Models\User;
use App\Models\Visitor;
use App\Notifications\SecurityAlertRaised;
use Illuminate\Support\Facades\Cache;

class SecurityMonitoringService
{
    public function __construct(
        private readonly LiveEventService $liveEvents,
    ) {}

    public function raise(
        string $alertType,
        string $severity,
        string $title,
        string $message,
        array $context = [],
    ): ?SecurityAlert {
        if (! config('security_monitoring.enabled')) {
            return null;
        }

        $cooldown = config('security_monitoring.alert_cooldown_seconds', 120);
        $cacheKey = 'security:alert:'.md5($alertType.':'.$title.':'.($context['camera_id'] ?? 'none'));

        if ($cooldown > 0 && Cache::has($cacheKey)) {
            return null;
        }

        if ($cooldown > 0) {
            Cache::put($cacheKey, true, $cooldown);
        }

        $alert = SecurityAlert::create([
            'organization_id' => $context['organization_id'] ?? null,
            'alert_type' => $alertType,
            'severity' => $severity,
            'title' => $title,
            'message' => $message,
            'status' => 'open',
            'metadata' => $context['metadata'] ?? null,
            'camera_id' => $context['camera_id'] ?? null,
            'employee_id' => $context['employee_id'] ?? null,
            'visitor_id' => $context['visitor_id'] ?? null,
            'recognition_event_id' => $context['recognition_event_id'] ?? null,
            'access_point_id' => $context['access_point_id'] ?? null,
            'occurred_at' => $context['occurred_at'] ?? now(),
        ]);

        $this->liveEvents->record(
            'security_alert',
            $title,
            $alert->organization_id,
            [
                'payload' => [
                    'alert_id' => $alert->id,
                    'alert_type' => $alertType,
                    'severity' => $severity,
                ],
            ],
        );

        $this->notifySecurityOfficers($alert);

        return $alert;
    }

    public function onUnknownPerson(RecognitionEvent $event, ?Camera $camera): void
    {
        $this->raise(
            'unknown_person',
            'high',
            'Unknown person detected',
            sprintf(
                'Unrecognized face at %s (confidence %.1f%%)',
                $camera?->name ?? 'unknown camera',
                ($event->confidence ?? 0) * 100
            ),
            [
                'organization_id' => $camera?->location?->organization_id,
                'camera_id' => $camera?->id,
                'recognition_event_id' => $event->id,
                'metadata' => ['image_hash' => $event->image_hash],
            ],
        );
    }

    public function onSpoofAttempt(?Camera $camera, string $reason, ?float $confidence = null): void
    {
        $this->raise(
            'spoof_attempt',
            'critical',
            'Anti-spoof check failed',
            sprintf('Liveness/spoof failure: %s', str_replace('_', ' ', $reason)),
            [
                'organization_id' => $camera?->location?->organization_id,
                'camera_id' => $camera?->id,
                'metadata' => ['reason' => $reason, 'confidence' => $confidence],
            ],
        );
    }

    public function onAccessDenied(AccessPoint $point, ?string $denyReason, ?Employee $employee, ?Visitor $visitor): void
    {
        $this->raise(
            'access_denied',
            'medium',
            'Access denied',
            sprintf('Access denied at %s: %s', $point->name, $denyReason ?? 'unknown'),
            [
                'organization_id' => $point->organization_id,
                'access_point_id' => $point->id,
                'employee_id' => $employee?->id,
                'visitor_id' => $visitor?->id,
                'metadata' => ['deny_reason' => $denyReason],
            ],
        );
    }

    public function onAfterHoursAccess(?Camera $camera, ?Employee $employee): void
    {
        if (! $this->isAfterHours()) {
            return;
        }

        $name = $employee
            ? trim("{$employee->first_name} {$employee->last_name}")
            : 'Unknown';

        $this->raise(
            'after_hours',
            'high',
            'After-hours access',
            sprintf('%s recognized outside business hours', $name),
            [
                'organization_id' => $camera?->location?->organization_id ?? $employee?->organization_id,
                'camera_id' => $camera?->id,
                'employee_id' => $employee?->id,
            ],
        );
    }

    public function checkTailgating(?Employee $employee, ?AccessPoint $point): void
    {
        if (! $employee || ! $point) {
            return;
        }

        $window = config('security_monitoring.tailgating_window_seconds', 8);
        $recent = AccessEvent::where('access_point_id', $point->id)
            ->where('employee_id', $employee->id)
            ->where('granted', true)
            ->where('occurred_at', '>=', now()->subSeconds($window))
            ->count();

        if ($recent >= 2) {
            $this->raise(
                'tailgating',
                'high',
                'Possible tailgating',
                sprintf('Rapid re-entry at %s within %ds', $point->name, $window),
                [
                    'organization_id' => $point->organization_id,
                    'access_point_id' => $point->id,
                    'employee_id' => $employee->id,
                ],
            );
        }
    }

    public function dashboard(?int $organizationId = null): array
    {
        $base = SecurityAlert::query()
            ->when($organizationId, fn ($q) => $q->where('organization_id', $organizationId));

        $open = (clone $base)->where('status', 'open');
        $today = (clone $base)->whereDate('occurred_at', today());

        return [
            'open_total' => $open->count(),
            'critical_open' => (clone $open)->where('severity', 'critical')->count(),
            'high_open' => (clone $open)->where('severity', 'high')->count(),
            'today_total' => $today->count(),
            'by_type' => (clone $today)
                ->selectRaw('alert_type, count(*) as count')
                ->groupBy('alert_type')
                ->pluck('count', 'alert_type'),
            'recent' => (clone $base)
                ->with(['camera:id,name', 'employee:id,first_name,last_name'])
                ->orderByDesc('occurred_at')
                ->limit(10)
                ->get(),
        ];
    }

    public function acknowledge(SecurityAlert $alert, User $user): SecurityAlert
    {
        $alert->update([
            'status' => 'acknowledged',
            'acknowledged_by' => $user->id,
            'acknowledged_at' => now(),
        ]);

        return $alert->fresh();
    }

    public function resolve(SecurityAlert $alert): SecurityAlert
    {
        $alert->update([
            'status' => 'resolved',
            'resolved_at' => now(),
        ]);

        return $alert->fresh();
    }

    private function isAfterHours(): bool
    {
        $cfg = config('security_monitoring.after_hours');
        $now = now();
        $start = $now->copy()->setTimeFromTimeString($cfg['start'] ?? '20:00');
        $end = $now->copy()->setTimeFromTimeString($cfg['end'] ?? '06:00');

        if ($start->lessThan($end)) {
            return $now->gte($start) && $now->lte($end);
        }

        return $now->gte($start) || $now->lte($end);
    }

    private function notifySecurityOfficers(SecurityAlert $alert): void
    {
        $users = User::where('is_active', true)
            ->whereHas('roles', fn ($q) => $q->whereIn('name', ['security_officer', 'org_admin', 'admin']))
            ->get();

        foreach ($users as $user) {
            $user->notify(new SecurityAlertRaised($alert));
        }
    }
}
