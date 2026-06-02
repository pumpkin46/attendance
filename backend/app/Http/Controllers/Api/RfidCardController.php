<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\RfidCard;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RfidCardController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Employee $employee): JsonResponse
    {
        return response()->json(
            $employee->rfidCards()->orderByDesc('assigned_at')->get()
        );
    }

    public function store(Request $request, Employee $employee): JsonResponse
    {
        $data = $request->validate([
            'uid' => 'required|string|max:64|unique:rfid_cards,uid',
            'label' => 'nullable|string|max:100',
        ]);

        $uid = strtoupper(trim($data['uid']));

        $card = RfidCard::create([
            'employee_id' => $employee->id,
            'uid' => $uid,
            'label' => $data['label'] ?? null,
            'assigned_at' => now(),
        ]);

        $this->audit->log('rfid_card.assigned', $card, null, $card->toArray());

        return response()->json($card, 201);
    }

    public function destroy(RfidCard $rfidCard): JsonResponse
    {
        $old = $rfidCard->toArray();
        $rfidCard->update(['is_active' => false]);
        $this->audit->log('rfid_card.revoked', $rfidCard, $old, $rfidCard->fresh()->toArray());

        return response()->json(['message' => 'RFID card revoked']);
    }
}
