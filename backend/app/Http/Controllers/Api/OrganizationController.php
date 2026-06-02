<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Services\AuditService;
use App\Services\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrganizationController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $query = Organization::withCount(['branches', 'departments', 'employees']);

        if (! $request->user()?->isSuperAdmin()) {
            $orgId = $request->user()?->organization_id;
            $query->where('id', $orgId);
        }

        return response()->json($query->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        if (! $request->user()?->isSuperAdmin()) {
            abort(403, 'Only Super Admin can create organizations');
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:32|unique:organizations,code',
            'timezone' => 'nullable|string|max:64',
        ]);

        $org = Organization::create($data);
        $this->audit->log('organization.created', $org);

        return response()->json($org, 201);
    }

    public function show(Organization $organization): JsonResponse
    {
        TenantContext::assertOrganizationAccess($organization->id);

        return response()->json($organization->loadCount(['branches', 'departments', 'employees']));
    }
}
