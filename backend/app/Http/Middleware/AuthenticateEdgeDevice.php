<?php

namespace App\Http\Middleware;

use App\Models\EdgeDevice;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateEdgeDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (! $token) {
            return response()->json(['message' => 'Edge device token required'], 401);
        }

        $device = EdgeDevice::with(['camera', 'location'])
            ->where('api_token', hash('sha256', $token))
            ->where('is_active', true)
            ->first();

        if (! $device) {
            return response()->json(['message' => 'Invalid or inactive edge device token'], 401);
        }

        $request->attributes->set('edge_device', $device);

        return $next($request);
    }
}
