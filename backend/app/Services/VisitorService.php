<?php

namespace App\Services;

use App\Models\Visitor;
use Carbon\Carbon;
use Illuminate\Support\Str;

class VisitorService
{
    public function __construct(
        private readonly AiRecognitionClient $ai,
        private readonly LiveEventService $liveEvents,
    ) {}

    public function register(array $data): Visitor
    {
        $hours = config('visitors.default_visit_hours', 8);
        $start = isset($data['visit_start_at'])
            ? Carbon::parse($data['visit_start_at'])
            : now();
        $end = isset($data['visit_end_at'])
            ? Carbon::parse($data['visit_end_at'])
            : $start->copy()->addHours($hours);

        $buffer = config('visitors.face_expiry_buffer_minutes', 30);

        $visitor = Visitor::create([
            'organization_id' => $data['organization_id'],
            'host_employee_id' => $data['host_employee_id'] ?? null,
            'name' => $data['name'],
            'company' => $data['company'] ?? null,
            'phone' => $data['phone'] ?? null,
            'purpose' => $data['purpose'] ?? null,
            'visit_start_at' => $start,
            'visit_end_at' => $end,
            'face_expires_at' => $end->copy()->addMinutes($buffer),
            'status' => 'scheduled',
            'ai_identity_id' => 'pending',
            'check_in_code' => $this->generateCheckInCode(),
        ]);

        $visitor->update([
            'ai_identity_id' => 'visitor-'.$visitor->id,
            'badge_number' => $this->generateBadgeNumber($visitor->id),
        ]);

        return $visitor->fresh();
    }

    public function enrollFace(Visitor $visitor, string $imageBase64): array
    {
        if (! $visitor->isActive() && $visitor->status === 'expired') {
            return ['success' => false, 'error' => 'Visitor registration expired'];
        }

        $identityId = $visitor->aiIdentityId();
        $result = $this->ai->enroll($identityId, $imageBase64);

        if (! ($result['success'] ?? false)) {
            return $result;
        }

        $visitor->update([
            'face_registered' => true,
            'ai_identity_id' => $identityId,
            'face_expires_at' => $visitor->visit_end_at->copy()->addMinutes(
                config('visitors.face_expiry_buffer_minutes', 30)
            ),
        ]);

        $this->liveEvents->record(
            'visitor_registered',
            now()->format('H:i')." Visitor {$visitor->name} face enrolled",
            $visitor->organization_id,
            ['visitor_id' => $visitor->id],
        );

        return array_merge($result, [
            'visitor_id' => $visitor->id,
            'ai_identity_id' => $identityId,
            'face_expires_at' => $visitor->face_expires_at?->toIso8601String(),
        ]);
    }

    public function expireDueVisitors(): int
    {
        $due = Visitor::query()
            ->whereIn('status', ['scheduled', 'checked_in'])
            ->where('face_expires_at', '<', now())
            ->get();

        $count = 0;
        foreach ($due as $visitor) {
            $this->expireVisitor($visitor);
            $count++;
        }

        return $count;
    }

    public function expireVisitor(Visitor $visitor): void
    {
        if ($visitor->face_registered && $visitor->ai_identity_id) {
            $this->ai->deleteEmployee($visitor->ai_identity_id);
        }

        $visitor->update([
            'status' => 'expired',
            'face_registered' => false,
        ]);

        $this->liveEvents->record(
            'visitor_expired',
            now()->format('H:i')." Visitor {$visitor->name} access expired",
            $visitor->organization_id,
            ['visitor_id' => $visitor->id],
        );
    }

    public function resolveVisitorFromIdentity(string $identityId): ?Visitor
    {
        if (! str_starts_with($identityId, 'visitor-')) {
            return null;
        }

        $visitor = Visitor::where('ai_identity_id', $identityId)
            ->orWhere('id', (int) str_replace('visitor-', '', $identityId))
            ->first();

        if (! $visitor || ! $visitor->isActive()) {
            return null;
        }

        return $visitor;
    }

    public function lookupByCodeOrPhone(string $query, int $organizationId): ?Visitor
    {
        $normalized = strtoupper(preg_replace('/\s+/', '', $query));

        return Visitor::where('organization_id', $organizationId)
            ->whereIn('status', ['scheduled', 'checked_in'])
            ->where(function ($q) use ($normalized, $query) {
                $q->where('check_in_code', $normalized)
                    ->orWhere('phone', $query);
            })
            ->where('visit_end_at', '>=', now())
            ->first();
    }

    public function checkIn(Visitor $visitor): Visitor
    {
        $visitor->update([
            'status' => 'checked_in',
            'checked_in_at' => now(),
        ]);

        $this->liveEvents->record(
            'visitor_checked_in',
            now()->format('H:i')." Visitor {$visitor->name} checked in",
            $visitor->organization_id,
            ['visitor_id' => $visitor->id],
        );

        app(BuildingIntegrationService::class)->onVisitorCheckedIn([
            'organization_id' => $visitor->organization_id,
            'visitor_id' => $visitor->id,
            'name' => $visitor->name,
            'badge_number' => $visitor->badge_number,
            'host_employee_id' => $visitor->host_employee_id,
        ]);

        return $visitor->fresh(['host']);
    }

    private function generateCheckInCode(): string
    {
        $length = config('visitor_kiosks.check_in_code_length', 6);

        do {
            $code = strtoupper(Str::random($length));
        } while (Visitor::where('check_in_code', $code)->exists());

        return $code;
    }

    private function generateBadgeNumber(int $visitorId): string
    {
        $prefix = config('visitor_kiosks.badge_prefix', 'V');

        return $prefix.str_pad((string) $visitorId, 5, '0', STR_PAD_LEFT);
    }
}
