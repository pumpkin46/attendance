<?php

namespace App\Providers;

use App\Hashing\MigratingArgon2IdHasher;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Hash::extend('argon2id', function ($app) {
            return new MigratingArgon2IdHasher($app['config']->get('hashing.argon', []));
        });
    }
}
