<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Services\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DepartmentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $departments = Department::with(['branch', 'organization'])
            ->when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->when($request->branch_id, fn ($q, $id) => $q->where('branch_id', $id))
            ->orderBy('name')
            ->get();

        return response()->json($departments);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:32',
        ]);

        TenantContext::assertOrganizationAccess((int) $data['organization_id']);

        $department = Department::create($data);

        return response()->json($department->load('branch'), 201);
    }
}
