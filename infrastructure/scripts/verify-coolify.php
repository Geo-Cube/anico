<?php
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$settings = App\Models\InstanceSettings::findOrFail(0);
$server = App\Models\Server::findOrFail(0);
$user = App\Models\User::findOrFail(0);
$access = json_decode(file_get_contents('/anico/access.json'), true, flags: JSON_THROW_ON_ERROR);
$checks = [
    'administrator_exists' => $user->email === env('ROOT_USER_EMAIL'),
    'management_key_matches_database' => trim(App\Models\PrivateKey::findOrFail(0)->private_key) === trim(file_get_contents('/var/www/html/storage/app/ssh/management-key')),
    'administrator_is_owner' => $user->teams()->where('team_id', 0)->wherePivot('role', 'owner')->exists(),
    'registration_disabled' => !$settings->is_registration_enabled,
    'automatic_updates_disabled' => !$settings->is_auto_update_enabled,
    'server_agent_supported' => $server->isSentinelEnabled(),
    'agent_uses_private_url' => $server->settings->sentinel_custom_url === 'http://coolify:8080',
    'dashboard_url_matches_iac' => $settings->fqdn === ($access['publish']['administration'] ? 'https://'.$access['administratorHostname'] : null),
    'origin_https_redirect_disabled' => !$settings->is_dashboard_force_https_enabled,
    'proxy_config_matches_iac' => $server->proxy->get('last_saved_proxy_configuration') === file_get_contents('/anico/proxy.yaml'),
    'applied_proxy_config_matches' => $server->proxy->get('last_applied_settings') === md5(base64_encode(file_get_contents('/anico/proxy.yaml'))),
];
if (in_array(false, $checks, true)) {
    fwrite(STDERR, json_encode($checks)."\n");
    exit(1);
}
echo json_encode($checks)."\n";
