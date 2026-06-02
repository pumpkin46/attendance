<?php

namespace App\Http\Middleware;

use App\Models\RfidReader;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateRfidReader
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (! $token) {
            return response()->json(['message' => 'RFID reader token required'], 401);
        }

        $reader = RfidReader::where('api_token', hash('sha256', $token))
            ->where('is_active', true)
            ->first();

        if (! $reader) {
            return response()->json(['message' => 'Invalid or inactive RFID reader token'], 401);
        }

        $reader->update(['last_heartbeat_at' => now()]);
        $request->attributes->set('rfid_reader', $reader);

        return $next($request);
    }
}
