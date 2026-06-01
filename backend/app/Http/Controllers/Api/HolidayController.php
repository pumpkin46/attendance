<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Holiday;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HolidayController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $holidays = Holiday::when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->when($request->year, fn ($q, $year) => $q->whereYear('date', $year))
            ->orderBy('date')
            ->get();

        return response()->json($holidays);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'location_id' => 'nullable|exists:locations,id',
            'name' => 'required|string',
            'date' => 'required|date',
            'is_recurring' => 'boolean',
        ]);

        $holiday = Holiday::create($data);
        $this->audit->log('holiday.created', $holiday);

        return response()->json($holiday, 201);
    }
}
