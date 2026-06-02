<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RfidEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RfidEventController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = RfidEvent::with(['reader.location', 'employee'])
            ->when($request->date_from, fn ($q, $from) => $q->whereDate('tapped_at', '>=', $from))
            ->when($request->date_to, fn ($q, $to) => $q->whereDate('tapped_at', '<=', $to))
            ->when($request->result, fn ($q, $result) => $q->where('result', $result))
            ->orderByDesc('tapped_at');

        return response()->json($query->paginate($request->integer('per_page', 50)));
    }
}
