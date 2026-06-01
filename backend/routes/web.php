<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'service' => 'Attendance Platform API',
        'version' => '1.0.0',
        'status' => 'ok',
    ]);
});
