<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RfidCard;
use App\Models\RfidReader;
use App\Services\AttendanceService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RfidTapController extends Controller
{
    public function __construct(private readonly AttendanceService $attendance) {}

    public function tap(Request $request): JsonResponse
    {
        /** @var RfidReader $reader */
        $reader = $request->attributes->get('rfid_reader');

        $data = $request->validate([
            'uid' => 'required|string|max:64',
            'timestamp' => 'nullable|date',
        ]);

        $uid = strtoupper(trim($data['uid']));
        $tappedAt = isset($data['timestamp']) ? Carbon::parse($data['timestamp']) : null;

        $response = $this->processTap($reader, $uid, $tappedAt);

        return response()->json($response['body'], $response['status']);
    }

    public function simulate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'uid' => 'required|string|max:64',
            'rfid_reader_id' => 'required|exists:rfid_readers,id',
            'timestamp' => 'nullable|date',
        ]);

        $reader = RfidReader::findOrFail($data['rfid_reader_id']);
        $uid = strtoupper(trim($data['uid']));
        $tappedAt = isset($data['timestamp']) ? Carbon::parse($data['timestamp']) : null;

        $response = $this->processTap($reader, $uid, $tappedAt);

        return response()->json($response['body'], $response['status']);
    }

    private function processTap(RfidReader $reader, string $uid, ?Carbon $tappedAt): array
    {
        $card = RfidCard::with('employee')
            ->where('uid', $uid)
            ->first();

        if (! $card) {
            $this->attendance->recordRfidEvent($reader, $uid, 'unknown', null, $tappedAt);

            return [
                'status' => 404,
                'body' => [
                    'matched' => false,
                    'reason' => 'unknown_card',
                    'uid' => $uid,
                ],
            ];
        }

        if (! $card->is_active || ! $card->employee?->is_active) {
            $this->attendance->recordRfidEvent($reader, $uid, 'inactive', $card->employee, $tappedAt);

            return [
                'status' => 422,
                'body' => [
                    'matched' => false,
                    'reason' => 'inactive',
                    'uid' => $uid,
                ],
            ];
        }

        $result = $this->attendance->processRfidTap($card->employee, $reader, $uid, $tappedAt);

        return [
            'status' => 200,
            'body' => [
                'matched' => true,
                'uid' => $uid,
                'employee' => [
                    'id' => $card->employee->id,
                    'employee_code' => $card->employee->employee_code,
                    'first_name' => $card->employee->first_name,
                    'last_name' => $card->employee->last_name,
                ],
                'attendance_action' => $result['action'],
                'record' => $result['record'] ?? null,
            ],
        ];
    }
}
