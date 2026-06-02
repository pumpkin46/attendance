<?php

namespace App\Hashing;

use Illuminate\Hashing\Argon2IdHasher;

/**
 * Accepts legacy bcrypt hashes (e.g. from older seeds) and upgrades on login via rehash_on_login.
 */
class MigratingArgon2IdHasher extends Argon2IdHasher
{
    public function check(#[\SensitiveParameter] $value, $hashedValue, array $options = [])
    {
        if (is_null($hashedValue) || strlen($hashedValue) === 0) {
            return false;
        }

        if ($this->isBcryptHash($hashedValue)) {
            return password_verify($value, $hashedValue);
        }

        return parent::check($value, $hashedValue, $options);
    }

    public function needsRehash($hashedValue, array $options = [])
    {
        if ($this->isBcryptHash($hashedValue)) {
            return true;
        }

        return parent::needsRehash($hashedValue, $options);
    }

    private function isBcryptHash(string $hashedValue): bool
    {
        return preg_match('/^\$2[ayb]\$/', $hashedValue) === 1;
    }
}
