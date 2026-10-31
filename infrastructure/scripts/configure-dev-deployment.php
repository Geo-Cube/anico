<?php
// Pinned Coolify model API; never print tokens, environment values or SQL errors.
try {
    require '/var/www/html/vendor/autoload.php';
    $app = require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $input = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    if ($input['serviceName'] !== 'anico-dev-applications' || !preg_match('/^[a-f0-9]{64}$/', $input['token'])) throw new RuntimeException('Invalid input');
    $changed = false;
    $result = Illuminate\Support\Facades\DB::transaction(function () use ($input, &$changed) {
        $project = App\Models\Project::where('team_id', 0)->where('name', 'AniCo')->sole();
        if ($project->description !== 'Managed by AniCo Ansible: application environments') throw new RuntimeException('Unmanaged project');
        $environment = $project->environments()->where('name', 'dev')->sole();
        $server = App\Models\Server::findOrFail(0);
        $destination = $server->destinations()->firstOrFail();
        $matches = $environment->services()->where('name', $input['serviceName'])->get();
        if ($matches->count() > 1) throw new RuntimeException('Duplicate service');
        $service = $matches->first();
        $isNew = !$service;
        if ($service && ($service->description !== $input['description'] || $service->server_id !== $server->id || $service->connect_to_docker_network)) throw new RuntimeException('Unmanaged service');
        $compose = $input['compose'];
        // IaC re-application must preserve a newer CI release instead of rolling it back.
        if ($service) {
            $previous = parseDockerComposeYaml($service->docker_compose_raw);
            foreach (['frontend', 'backend'] as $name) {
                $image = $previous['services'][$name]['image'] ?? '';
                $repository = $name === 'frontend' ? 'frontend' : 'breeding-service';
                if (!preg_match('#^ghcr\.io/geo-cube/anico-'.$repository.'@sha256:[a-f0-9]{64}$#', $image)) throw new RuntimeException('Unmanaged image');
                $compose['services'][$name]['image'] = $image;
                $compose['services'][$name]['labels']['com.anico.revision'] = $previous['services'][$name]['labels']['com.anico.revision'];
            }
            $revision = $compose['services']['frontend']['labels']['com.anico.revision'];
            $compose['services']['frontend']['volumes'][0]['source'] = './anico-release-'.$revision.'.json';
            $compose['services']['frontend']['volumes'][0]['target'] = '/usr/share/nginx/html/anico-release-'.$revision.'.json';
            $compose['services']['frontend']['volumes'][0]['content'] = json_encode([
                'revision' => $revision,
                'images' => ['frontend' => $compose['services']['frontend']['image'], 'breeding-service' => $compose['services']['backend']['image']],
            ], JSON_THROW_ON_ERROR);
        }
        $service ??= new App\Models\Service;
        $comparison = $compose;
        unset($comparison['services']['frontend']['volumes'][0]['content']);
        // Coolify stores inline file content separately and removes it from raw YAML.
        $rawChanged = $isNew || $previous != $comparison;
        $service->fill(['name' => $input['serviceName'], 'description' => $input['description'],
            'environment_id' => $environment->id, 'server_id' => $server->id,
            'destination_id' => $destination->id, 'destination_type' => $destination->getMorphClass(),
            'connect_to_docker_network' => false, 'is_container_label_escape_enabled' => false]);
        if ($rawChanged) $service->docker_compose_raw = json_encode($compose, JSON_THROW_ON_ERROR);
        if ($service->isDirty()) { $service->save(); $changed = true; }
        $service->parse(isNew: $isNew);
        $oldDatabaseVariable = $service->environment_variables()->where('key', 'MONGODB_URI')->first();
        if ($oldDatabaseVariable) {
            if ($oldDatabaseVariable->value !== '{{environment.MONGODB_URI}}') throw new RuntimeException('Unexpected database variable');
            $oldDatabaseVariable->delete();
            $changed = true;
        }
        foreach (['LOG_LEVEL'] as $key) {
            if (!$environment->environment_variables()->where('key', $key)->exists()) throw new RuntimeException('Missing shared variable');
            $variable = $service->environment_variables()->where('key', $key)->first() ?? new App\Models\EnvironmentVariable;
            $variable->fill(['key' => $key, 'value' => '{{environment.'.$key.'}}',
                'resourceable_type' => $service->getMorphClass(), 'resourceable_id' => $service->id,
                'is_literal' => false, 'is_runtime' => true, 'is_buildtime' => false,
                'is_shown_once' => $key === 'MONGODB_URI']);
            if ($variable->isDirty()) { $variable->save(); $changed = true; }
        }
        $instance = App\Models\InstanceSettings::findOrFail(0);
        $instance->is_api_enabled = true;
        if ($instance->isDirty()) { $instance->save(); $changed = true; }
        $owner = App\Models\User::findOrFail(0);
        $token = $owner->tokens()->where('name', 'AniCo development CI')->first() ?? new App\Models\PersonalAccessToken;
        $rotated = $token->exists && $token->token !== hash('sha256', $input['token']);
        $token->fill(['name' => 'AniCo development CI', 'token' => hash('sha256', $input['token']),
            'team_id' => 0, 'abilities' => ['read', 'write', 'deploy']]);
        $token->tokenable()->associate($owner);
        if (!$token->exists || $rotated) $token->expires_at = now()->addYear();
        if ($token->expires_at && $token->expires_at->isPast()) throw new RuntimeException('Deploy token expired; rotate explicitly');
        if ($token->isDirty()) { $token->save(); $changed = true; }
        return ['uuid' => $service->uuid, 'changed' => $changed];
    });
    if (in_array('--start', $argv, true)) {
        App\Actions\Service\StartService::run(App\Models\Service::where('uuid', $result['uuid'])->sole());
    }
    echo json_encode($result, JSON_THROW_ON_ERROR), "\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Dev deployment configuration failed; values suppressed. '.get_class($error).' at '.basename($error->getFile()).':'.$error->getLine()."\n");
    exit(1);
}
