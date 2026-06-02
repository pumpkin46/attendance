<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Services\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BranchController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $branches = Branch::with('organization')
            ->when($request->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->orderBy('name')
            ->get();

        return response()->json($branches);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'organization_id' => 'required|exists:organizations,id',
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:32',
            'address' => 'nullable|string',
            'timezone' => 'nullable|string|max:64',
        ]);

        TenantContext::assertOrganizationAccess((int) $data['organization_id']);

        $branch = Branch::create($data);

        return response()->json($branch, 201);
    }
}
