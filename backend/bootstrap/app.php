<?php

use App\Http\Middleware\CheckPermission;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'permission' => CheckPermission::class,
            'tenant' => \App\Http\Middleware\EnforceTenantIsolation::class,
            'rfid.reader' => \App\Http\Middleware\AuthenticateRfidReader::class,
            'edge.device' => \App\Http\Middleware\AuthenticateEdgeDevice::class,
            'visitor.kiosk' => \App\Http\Middleware\AuthenticateVisitorKiosk::class,
        ]);
        if (env('FORCE_HTTPS', false)) {
            $middleware->append(\App\Http\Middleware\ForceHttps::class);
        }
        // Token-based API (Bearer); no stateful Sanctum cookies / CSRF required.
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
