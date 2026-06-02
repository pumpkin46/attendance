<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $query = Employee::with(['location', 'organization'])
            ->withCount(['rfidCards as active_rfid_cards_count' => fn ($q) => $q->where('is_active', true)])
            ->when($request->search, function ($q, $search) {
                $q->where(function ($inner) use ($search) {
                    $inner->where('first_name', 'ilike', "%{$search}%")
                        ->orWhere('last_name', 'ilike', "%{$search}%")
                        ->orWhere('employee_code', 'ilike', "%{$search}%");
                });
            })
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->orderBy('last_name');

        return response()->json($query->paginate($request->integer('per_page', 25)));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'location_id' => 'nullable|exists:locations,id',
            'employee_code' => 'required|string|unique:employees,employee_code',
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => 'nullable|email',
            'department' => 'nullable|string',
            'job_title' => 'nullable|string',
            'hire_date' => 'nullable|date',
        ]);

        $maxEmployees = config('nfr.max_employees', 10_000);
        if (Employee::count() >= $maxEmployees) {
            return response()->json([
                'message' => "Maximum employee capacity reached (NFR-002: {$maxEmployees})",
            ], 422);
        }

        $employee = Employee::create($data);
        $this->audit->log('employee.created', $employee, null, $employee->toArray());

        return response()->json($employee->load('location'), 201);
    }

    public function show(Employee $employee): JsonResponse
    {
        return response()->json($employee->load(['location', 'organization', 'faceEmbeddings']));
    }

    public function update(Request $request, Employee $employee): JsonResponse
    {
        $old = $employee->toArray();
        $data = $request->validate([
            'location_id' => 'nullable|exists:locations,id',
            'first_name' => 'sometimes|string|max:100',
            'last_name' => 'sometimes|string|max:100',
            'email' => 'nullable|email',
            'department' => 'nullable|string',
            'job_title' => 'nullable|string',
            'is_active' => 'sometimes|boolean',
        ]);

        $employee->update($data);
        $this->audit->log('employee.updated', $employee, $old, $employee->fresh()->toArray());

        return response()->json($employee->fresh()->load('location'));
    }

    public function destroy(Employee $employee): JsonResponse
    {
        $old = $employee->toArray();
        $employee->update(['is_active' => false]);
        $this->audit->log('employee.deactivated', $employee, $old, $employee->fresh()->toArray());

        return response()->json(['message' => 'Employee deactivated']);
    }
}
