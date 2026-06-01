<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $logs = AuditLog::with('user')
            ->when($request->action, fn ($q, $a) => $q->where('action', 'ilike', "%{$a}%"))
            ->when($request->user_id, fn ($q, $id) => $q->where('user_id', $id))
            ->when($request->date_from, fn ($q, $d) => $q->where('created_at', '>=', $d))
            ->orderByDesc('created_at')
            ->paginate($request->integer('per_page', 50));

        return response()->json($logs);
    }
}
