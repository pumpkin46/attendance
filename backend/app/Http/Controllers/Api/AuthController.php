<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use App\Services\LdapAuthService;
use App\Services\SamlAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Socialite\Facades\Socialite;

class AuthController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly LdapAuthService $ldap,
        private readonly SamlAuthService $saml,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json([
            'jwt' => config('security.authentication.jwt'),
            'oauth2' => [
                'enabled' => config('security.authentication.oauth2.enabled'),
                'providers' => config('security.authentication.oauth2.providers'),
            ],
            'saml' => [
                'enabled' => $this->saml->isEnabled(),
                'login_url' => $this->saml->loginUrl(),
            ],
            'ldap' => [
                'enabled' => $this->ldap->isEnabled(),
            ],
        ]);
    }

    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $user = User::where('email', $request->email)->where('is_active', true)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        $token = $user->createToken('api')->plainTextToken;
        $this->audit->log('auth.login', $user);

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => $user->load('roles.permissions', 'organization'),
        ]);
    }

    public function ldapLogin(Request $request): JsonResponse
    {
        if (! $this->ldap->isEnabled()) {
            abort(404, 'LDAP authentication is not enabled');
        }

        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $user = $this->ldap->attempt($request->email, $request->password);

        if (! $user) {
            throw ValidationException::withMessages([
                'email' => ['LDAP authentication failed or user is not provisioned.'],
            ]);
        }

        $token = $user->createToken('api')->plainTextToken;
        $this->audit->log('auth.ldap_login', $user);

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => $user->load('roles.permissions', 'organization'),
        ]);
    }

    public function samlCallback(Request $request): JsonResponse
    {
        if (! $this->saml->isEnabled()) {
            abort(404, 'SAML authentication is not enabled');
        }

        $data = $request->validate([
            'email' => 'required|email',
            'name' => 'nullable|string|max:255',
            'name_id' => 'nullable|string|max:255',
        ]);

        $user = $this->saml->userFromAssertion(
            $data['email'],
            $data['name'] ?? null,
            ['name_id' => $data['name_id'] ?? null]
        );

        $token = $user->createToken('api')->plainTextToken;
        $this->audit->log('auth.saml_login', $user);

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => $user->load('roles.permissions', 'organization'),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->audit->log('auth.logout', $request->user());
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(
            $request->user()->load('roles.permissions', 'organization')
        );
    }

    public function oauthRedirect(string $provider): JsonResponse
    {
        $this->validateProvider($provider);

        return response()->json([
            'url' => Socialite::driver($provider)->stateless()->redirect()->getTargetUrl(),
        ]);
    }

    public function oauthCallback(Request $request, string $provider): JsonResponse
    {
        $this->validateProvider($provider);

        $oauthUser = Socialite::driver($provider)->stateless()->user();

        $user = User::firstOrCreate(
            ['email' => $oauthUser->getEmail()],
            [
                'name' => $oauthUser->getName() ?? $oauthUser->getEmail(),
                'password' => Hash::make(str()->random(32)),
                'oauth_provider' => $provider,
                'oauth_id' => $oauthUser->getId(),
            ]
        );

        if (! $user->oauth_id) {
            $user->update(['oauth_provider' => $provider, 'oauth_id' => $oauthUser->getId()]);
        }

        $token = $user->createToken('api')->plainTextToken;
        $this->audit->log('auth.oauth_login', $user);

        return response()->json([
            'token' => $token,
            'user' => $user->load('roles.permissions'),
        ]);
    }

    private function validateProvider(string $provider): void
    {
        if (! in_array($provider, ['google', 'microsoft'], true)) {
            abort(404, 'OAuth provider not supported');
        }
    }
}
