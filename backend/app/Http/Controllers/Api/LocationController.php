<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Location;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LocationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $locations = Location::query()
            ->when($request->user()?->organization_id, fn ($q, $id) => $q->where('organization_id', $id))
            ->orderBy('name')
            ->get(['id', 'name', 'address']);

        return response()->json($locations);
    }
}
