<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Camera;
use App\Models\Employee;
use App\Models\LiveEvent;
use App\Models\RecognitionEvent;
use App\Models\Visitor;

class MonitoringCenterService
{
    public function __construct(
        private readonly CameraMonitoringService $cameras,
    ) {}

    public function dashboard(): array
    {
        $today = today()->toDateString();
        $cameraSummary = $this->cameras->summary();

        $records = AttendanceRecord::with('employee')
            ->where('work_date', $today)
            ->get();

        $activeEmployees = Employee::where('is_active', true)->count();
        $present = $records->whereIn('status', ['present', 'late'])->count();
        $late = $records->where('status', 'late')->count();
        $absent = max(0, $activeEmployees - $records->whereNotNull('check_in_at')->count());

        $unknownToday = RecognitionEvent::where('result', 'unknown')
            ->whereDate('recognized_at', $today)
            ->count();

        $activeVisitors = Visitor::whereIn('status', ['scheduled', 'checked_in'])
            ->where('visit_end_at', '>=', now())
            ->count();

        return [
            'active_cameras' => $cameraSummary['online'],
            'total_cameras' => $cameraSummary['total'],
            'employees_present' => $present,
            'employees_absent' => $absent,
            'employees_late' => $late,
            'unknown_persons_today' => $unknownToday,
            'active_visitors' => $activeVisitors,
            'camera_health' => [
                'online' => $cameraSummary['online'],
                'offline' => $cameraSummary['offline'],
                'avg_fps' => $cameraSummary['avg_fps'] ?? null,
                'avg_latency_ms' => $cameraSummary['avg_latency_ms'] ?? null,
                'total_dropped_frames' => $cameraSummary['total_dropped_frames'] ?? 0,
            ],
            'cameras' => $cameraSummary['cameras'],
        ];
    }

    public function liveFeed(int $limit = 50, ?string $since = null): array
    {
        $query = LiveEvent::with(['employee', 'camera', 'visitor'])
            ->orderByDesc('occurred_at')
            ->limit($limit);

        if ($since) {
            $query->where('occurred_at', '>=', $since);
        }

        $events = $query->get();

        if ($events->isEmpty()) {
            return $this->backfillFeedFromRecognition($limit);
        }

        return $events->map(fn (LiveEvent $e) => $this->formatEvent($e))->all();
    }

    private function backfillFeedFromRecognition(int $limit): array
    {
        return RecognitionEvent::with(['employee', 'camera'])
            ->whereDate('recognized_at', today())
            ->orderByDesc('recognized_at')
            ->limit($limit)
            ->get()
            ->map(function (RecognitionEvent $e) {
                $time = $e->recognized_at->format('H:i');
                if ($e->result === 'matched' && $e->employee) {
                    $action = $e->metadata['attendance_action'] ?? 'recognized';
                    $label = match ($action) {
                        'check_in' => 'Checked In',
                        'check_out' => 'Checked Out',
                        default => 'Recognized',
                    };
                    $message = "{$time} {$e->employee->first_name} {$e->employee->last_name} {$label}";
                    $type = $action === 'check_out' ? 'check_out' : 'check_in';
                } elseif ($e->result === 'unknown') {
                    $message = "{$time} Unknown Person Detected";
                    $type = 'unknown_person';
                } else {
                    $message = "{$time} Recognition ({$e->result})";
                    $type = 'recognition';
                }

                return [
                    'id' => 'rec-'.$e->id,
                    'event_type' => $type,
                    'message' => $message,
                    'occurred_at' => $e->recognized_at->toIso8601String(),
                ];
            })
            ->all();
    }

    private function formatEvent(LiveEvent $e): array
    {
        return [
            'id' => $e->id,
            'event_type' => $e->event_type,
            'message' => $e->message,
            'occurred_at' => $e->occurred_at->toIso8601String(),
            'camera' => $e->camera?->only(['id', 'name']),
            'employee' => $e->employee?->only(['id', 'first_name', 'last_name']),
            'visitor' => $e->visitor?->only(['id', 'name']),
        ];
    }

    public function checkCameraStatusTransitions(): void
    {
        $liveEvents = app(LiveEventService::class);
        $orgId = null;

        Camera::where('status', Camera::STATUS_ACTIVE)->each(function (Camera $camera) use ($liveEvents, &$orgId) {
            $online = $this->cameras->isOnline($camera);
            $cacheKey = "camera:online:state:{$camera->id}";
            $previous = cache()->get($cacheKey);

            if ($previous === null) {
                cache()->forever($cacheKey, $online);

                return;
            }

            if ($previous !== $online) {
                $time = now()->format('H:i');
                $message = $online
                    ? "{$time} {$camera->name} Online"
                    : "{$time} {$camera->name} Offline";

                $liveEvents->record(
                    $online ? 'camera_online' : 'camera_offline',
                    $message,
                    $camera->location?->organization_id,
                    ['camera_id' => $camera->id],
                );
                cache()->forever($cacheKey, $online);
            }
        });
    }
}
