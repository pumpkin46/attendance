<?php

namespace App\Http\Middleware;

use App\Models\VisitorKiosk;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateVisitorKiosk
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken() ?? $request->query('kiosk_token');

        if (! $token) {
            return response()->json(['message' => 'Visitor kiosk token required'], 401);
        }

        $kiosk = VisitorKiosk::where('api_token', hash('sha256', $token))
            ->where('is_active', true)
            ->first();

        if (! $kiosk) {
            return response()->json(['message' => 'Invalid or inactive visitor kiosk token'], 401);
        }

        $kiosk->update(['last_heartbeat_at' => now()]);
        $request->attributes->set('visitor_kiosk', $kiosk);

        return $next($request);
    }
}
