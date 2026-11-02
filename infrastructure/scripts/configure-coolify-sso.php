<?php

// Called inside the existing application bootstrap; never print identities/secrets.
return function (array $sso): bool {
    if (empty($sso['enabled'])) throw new RuntimeException('Invalid SSO configuration');
    if ($sso['provider'] !== 'github' || $sso['redirectUri'] !== 'https://admin.anico.online/auth/github/callback') {
        throw new RuntimeException('Invalid SSO endpoint');
    }
    return Illuminate\Support\Facades\DB::transaction(function () use ($sso): bool {
        $changed = false;
        $owner = App\Models\User::findOrFail(0);
        if (!in_array($owner->email, [$sso['owner']['legacyEmail'], $sso['owner']['email']], true)) {
            throw new RuntimeException('Existing owner does not match the approved identity migration');
        }
        if (App\Models\User::whereEmail($sso['owner']['email'])->where('id', '<>', 0)->exists()) {
            throw new RuntimeException('Owner target email belongs to another account');
        }
        $owner->email = $sso['owner']['email'];
        if ($owner->isDirty()) { $owner->saveQuietly(); $changed = true; }
        if (!$owner->teams()->where('team_id', 0)->wherePivot('role', 'owner')->exists()) {
            throw new RuntimeException('Root owner role must already exist');
        }
        foreach ($sso['admins'] as $member) {
            if (!filter_var($member['email'], FILTER_VALIDATE_EMAIL) || $member['email'] === $owner->email) {
                throw new RuntimeException('Invalid admin identity');
            }
            $user = App\Models\User::whereEmail($member['email'])->first();
            if (!$user) {
                // No personal team/owner role and no known local password.
                $user = new App\Models\User;
                $user->forceFill([
                    'name' => $member['login'], 'email' => $member['email'],
                    'password' => Illuminate\Support\Facades\Hash::make(Illuminate\Support\Str::random(80)),
                    'email_verified_at' => now(), 'current_team_id' => 0,
                ]);
                $user->saveQuietly();
                $changed = true;
            }
            $role = $user->teams()->where('team_id', 0)->first()?->pivot?->role;
            if ($role !== 'admin') {
                $user->teams()->syncWithoutDetaching([0 => ['role' => 'admin']]);
                $changed = true;
            }
        }
        $setting = App\Models\OauthSetting::firstOrNew(['provider' => 'github']);
        $setting->fill([
            'enabled' => true,
            'client_id' => $sso['clientId'], 'redirect_uri' => $sso['redirectUri'],
            'custom_label' => 'Přihlásit přes GitHub', 'scopes' => 'user:email',
            'allow_registration' => false, 'auto_join_root_team' => false,
            'require_email_verified' => true, 'use_pkce' => true, 'clock_skew_seconds' => 60,
        ]);
        // Avoid random ciphertext updates when the underlying secret is unchanged.
        if ($setting->client_secret !== $sso['clientSecret']) $setting->client_secret = $sso['clientSecret'];
        if ($setting->isDirty()) { $setting->save(); $changed = true; }
        $oidc = App\Models\OauthSetting::where('provider', 'oidc')->first();
        if ($oidc && $oidc->enabled) { $oidc->enabled = false; $oidc->save(); $changed = true; }
        return $changed;
    });
};
