<?php

namespace App\Http\Controllers\Concerns;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

trait RehashesPasswordOnLogin
{
    protected function rehashPasswordIfNeeded(User $user, string $plainPassword): void
    {
        if (! config('hashing.rehash_on_login', true)) {
            return;
        }

        if (! Hash::needsRehash($user->password)) {
            return;
        }

        $user->forceFill(['password' => Hash::make($plainPassword)])->save();
    }
}
