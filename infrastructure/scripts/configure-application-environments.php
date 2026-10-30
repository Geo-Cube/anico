<?php

// Pinned to the installed Coolify model API. Never print variable values.
try {
    require '/var/www/html/vendor/autoload.php';
    $app = require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $desired = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    if ($desired['projectName'] !== 'AniCo' || array_keys($desired['environments']) !== ['dev', 'prod']) {
        throw new RuntimeException('Unexpected environment definition');
    }
    $verify = in_array('--verify', $argv, true);
    $plan = in_array('--plan', $argv, true);
    $changed = false;
    $summary = [];

    Illuminate\Support\Facades\DB::transaction(function () use ($desired, $verify, $plan, &$changed, &$summary) {
        $projects = App\Models\Project::where('team_id', 0)->where('name', $desired['projectName'])->get();
        if ($projects->count() > 1) throw new RuntimeException('Duplicate project');
        $project = $projects->first();
        if ($project && $project->description !== $desired['managedDescription']) {
            throw new RuntimeException('Refusing to adopt an unmanaged project');
        }
        if (!$project) {
            if ($verify) throw new RuntimeException('Project is missing');
            if ($plan) { $summary[] = 'Create managed AniCo project with dev/prod environments'; return; }
            $project = App\Models\Project::create([
                'team_id' => 0,
                'name' => $desired['projectName'],
                'description' => $desired['managedDescription'],
            ]);
            // Coolify creates an empty production environment with every project.
            $default = $project->environments()->where('name', 'production')->firstOrFail();
            if (!$default->isEmpty()) throw new RuntimeException('Default environment is not empty');
            $default->name = 'prod';
            $default->save();
            $changed = true;
        }
        foreach ($desired['environments'] as $name => $definition) {
            $matches = $project->environments()->where('name', $name)->get();
            if ($matches->count() > 1) throw new RuntimeException('Duplicate environment');
            $environment = $matches->first();
            if (!$environment) {
                if ($verify) throw new RuntimeException('Environment missing');
                if ($plan) { $summary[] = 'Create '.$name.' environment'; continue; }
                $environment = App\Models\Environment::create(['project_id' => $project->id, 'name' => $name]);
                $changed = true;
            }
            foreach ($definition['variables'] as $key => $value) {
                if (!preg_match('/^[A-Z_][A-Z0-9_]*$/', $key) || !is_string($value)) {
                    throw new RuntimeException('Invalid variable');
                }
                $matches = $environment->environment_variables()->where('key', $key)->get();
                if ($matches->count() > 1) throw new RuntimeException('Duplicate variable');
                $variable = $matches->first();
                if (!$variable || $variable->value !== $value) {
                    if ($verify) throw new RuntimeException('Variable differs');
                    if ($plan) { $summary[] = 'Set '.$name.' variable '.$key.' (value hidden)'; continue; }
                    $variable ??= new App\Models\SharedEnvironmentVariable;
                    $variable->fill([
                        'key' => $key,
                        'value' => $value,
                        'type' => 'environment',
                        'team_id' => 0,
                        // Coolify's project-level unique index must not merge dev/prod keys.
                        'project_id' => null,
                        'environment_id' => $environment->id,
                        'is_literal' => true,
                        'is_multiline' => str_contains($value, "\n"),
                        'comment' => 'Managed by AniCo IaC; persist changes in encrypted applicationVariables.',
                    ]);
                    $variable->save();
                    $changed = true;
                }
            }
            $summary[] = $name.': branch '.$definition['sourceBranch'].', '.count($definition['variables']).' variables verified (values hidden)';
        }
    });
    echo $changed ? "ANICO_CHANGED\n" : "ANICO_UNCHANGED\n";
    echo json_encode($summary, JSON_THROW_ON_ERROR), "\n";
} catch (Throwable $error) {
    // SQL exceptions can include bound secret values; suppress the full exception.
    fwrite(STDERR, "AniCo environment configuration failed; private values and SQL details suppressed.\n");
    $diagnostic = [
        'exception' => get_class($error),
        'code' => (string) $error->getCode(),
        'location' => basename($error->getFile()).':'.$error->getLine(),
    ];
    if (preg_match('/constraint "([a-z_]+)"/', $error->getMessage(), $match)) {
        $diagnostic['constraint'] = $match[1];
    }
    fwrite(STDERR, json_encode($diagnostic)."\n");
    exit(1);
}
