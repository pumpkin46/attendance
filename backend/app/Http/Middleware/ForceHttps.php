<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * NFR-006: Enforce HTTPS in production (TLS 1.3 terminated at reverse proxy).
 */
class ForceHttps
{
    public function handle(Request $request, Closure $next): Response
    {
        if (
            config('app.env') === 'production'
            && ! $request->secure()
            && $request->header('X-Forwarded-Proto') !== 'https'
        ) {
            return redirect()->secure($request->getRequestUri(), 301);
        }

        $response = $next($request);

        if (config('app.env') === 'production') {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('X-Frame-Options', 'DENY');
        }

        return $response;
    }
}
