<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MonitoringCenterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MonitoringCenterController extends Controller
{
    public function __construct(
        private readonly MonitoringCenterService $monitoring,
    ) {}

    public function dashboard(): JsonResponse
    {
        $this->monitoring->checkCameraStatusTransitions();

        return response()->json($this->monitoring->dashboard());
    }

    public function liveFeed(Request $request): JsonResponse
    {
        $since = $request->query('since');

        return response()->json([
            'events' => $this->monitoring->liveFeed(
                $request->integer('limit', 50),
                $since,
            ),
        ]);
    }
}
