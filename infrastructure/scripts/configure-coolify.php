<?php

// Run as a one-shot PHP container before workers start, then reapply policy via exec.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (in_array('--restore-management-key', $argv, true)) {
    $path = '/var/www/html/storage/app/ssh/management-key';
    if (file_exists($path)) throw new RuntimeException('Management key already exists');
    file_put_contents($path, App\Models\PrivateKey::findOrFail(0)->private_key, LOCK_EX);
    chmod($path, 0600);
    exit(0);
}
$initialize = in_array('--initialize', $argv, true);
if ($initialize) {
    // Seeder jobs must remain queued until private proxy configuration is persisted.
    config(['queue.default' => 'redis']);
    if (Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]) !== 0) {
        throw new RuntimeException('Coolify migration failed');
    }
    if (Illuminate\Support\Facades\Artisan::call('db:seed', ['--class' => 'Database\\Seeders\\ProductionSeeder', '--force' => true]) !== 0) {
        throw new RuntimeException('Coolify seeding failed');
    }
}

$sso = file_exists('/anico/sso.json') ? json_decode(file_get_contents('/anico/sso.json'), true, flags: JSON_THROW_ON_ERROR) : null;
$ssoChanged = $sso ? (require '/anico/sso.php')($sso) : false;
$user = App\Models\User::findOrFail(0);
if ($user->email !== ($sso['owner']['email'] ?? env('ROOT_USER_EMAIL'))) {
    throw new RuntimeException('Administrator email does not match the initialized instance');
}
$settings = App\Models\InstanceSettings::findOrFail(0);
$access = json_decode(file_get_contents('/anico/access.json'), true, flags: JSON_THROW_ON_ERROR);
$server = App\Models\Server::findOrFail(0);
// The server agent must reach Coolify privately, outside the interactive Access login.
$serverSettings = $server->settings;
$serverSettings->sentinel_custom_url = 'http://coolify:8080';
$agentChanged = $serverSettings->isDirty();
if ($agentChanged) $serverSettings->save();
$settings->fqdn = $access['publish']['administration'] ? 'https://'.$access['administratorHostname'] : null;
$settings->is_registration_enabled = false;
$settings->is_auto_update_enabled = false;
$settings->do_not_track = true;
$settings->is_dashboard_force_https_enabled = false; // Cloudflare terminates HTTPS; HTTP-origin redirects would loop.
$settings->instance_timezone = 'Europe/Prague';
$changed = $settings->isDirty() || $agentChanged || $ssoChanged;
if ($settings->isDirty()) $settings->save();

$configuration = file_get_contents('/anico/proxy.yaml');
$yaml = Symfony\Component\Yaml\Yaml::parse($configuration);
if (!empty($yaml['services']['traefik']['ports'])) {
    throw new RuntimeException('Proxy must not publish host ports');
}
$server->proxy->set('type', 'TRAEFIK');
$server->proxy->set('force_stop', $initialize);
$server->proxy->set('last_saved_proxy_configuration', $configuration);
$server->proxy->set('last_saved_settings', md5(base64_encode($configuration)));
if (!$initialize) {
    $server->proxy->set('last_applied_settings', md5(base64_encode($configuration)));
    $server->proxy->set('status', 'running');
}
$changed = $server->isDirty() || $changed;
if ($server->isDirty()) $server->save();
echo $changed ? "ANICO_CHANGED\n" : "ANICO_UNCHANGED\n";
