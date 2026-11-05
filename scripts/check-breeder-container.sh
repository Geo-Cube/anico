#!/usr/bin/env bash
# Builds the breeder-service runtime image and smoke-tests it against a throwaway
# MongoDB on an internal Docker network (no published ports, no egress).
set -euo pipefail

cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null

# Same pinned image as infrastructure/compose.app.yaml (multi-arch digest).
mongo_image="$(awk '$1 == "image:" && $2 ~ /^mongo:/ { print $2; exit }' infrastructure/compose.app.yaml)"
if [ -z "$mongo_image" ]; then
  echo 'Pinned MongoDB image not found in infrastructure/compose.app.yaml.' >&2
  exit 1
fi

suffix="$(date +%s)-$$"
image="anico/breeder-service:smoke-$suffix"
network="anico-breeder-smoke-$suffix"
database="anico-breeder-smoke-db-$suffix"
breeder="anico-breeder-smoke-app-$suffix"
built=false

cleanup() {
  smoke_status=$?
  trap - EXIT
  if [ "$smoke_status" -ne 0 ]; then
    for container in "$breeder" "$database"; do
      if docker container inspect "$container" >/dev/null 2>&1; then
        echo "--- logs: $container ---" >&2
        docker logs --tail 120 "$container" >&2 2>&1 || true
      fi
    done
  fi
  docker rm --force --volumes "$breeder" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  if [ "$built" = true ]; then docker image rm --force "$image" >/dev/null 2>&1 || true; fi
  exit "$smoke_status"
}
trap cleanup EXIT

DOCKER_BUILDKIT=1 docker build --file apps/breeder-service/Dockerfile --tag "$image" .
built=true

# Runtime image must not ship sources, dev tooling or local env files.
test "$(docker image inspect --format '{{.Config.User}}' "$image")" = node
docker run --rm --network none --read-only --entrypoint sh "$image" -c '
  set -e
  for path in /app/.env /app/.git /app/infrastructure /app/apps/frontend \
    /app/apps/breeder-service/src /app/packages/auth/src /app/packages/shared-schemas/src \
    /app/node_modules/typescript /app/node_modules/vitest /app/node_modules/tsx \
    /app/node_modules/.bin/tsc /app/node_modules/.bin/tsx /app/node_modules/.bin/vitest; do
    if [ -e "$path" ]; then echo "Unexpected runtime path: $path" >&2; exit 1; fi
  done
  leaked="$(find /app -name node_modules -prune -o \( -name ".env" -o -name ".env.*" \) -print)"
  if [ -n "$leaked" ]; then echo "Env files leaked into runtime: $leaked" >&2; exit 1; fi
  test -f /app/apps/breeder-service/dist/server.js
'

# Internal network: the DB has no published port and nothing reaches the internet.
docker network create --internal "$network" >/dev/null
docker run --detach --name "$database" --network "$network" --network-alias mongodb \
  --env GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  "$mongo_image" >/dev/null
test -z "$(docker port "$database")"
mongo_ready=false
for _ in $(seq 1 60); do
  if docker exec "$database" mongosh --quiet --eval 'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)' >/dev/null 2>&1; then
    mongo_ready=true
    break
  fi
  sleep 1
done
if [ "$mongo_ready" != true ]; then
  echo 'MongoDB did not become ready within 60 s.' >&2
  exit 1
fi

# APP_ENV=local without identity config: requestAuthenticator returns undefined,
# so protected routes answer 401. The URI passes databaseTarget(), which
# MIGRATE_ON_START requires before migrating.
breeder_uri='mongodb://mongodb:27017/anico_breeder_local'
docker run --detach --name "$breeder" --network "$network" --network-alias breeder \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --env NODE_ENV=production --env APP_ENV=local --env LOG_LEVEL=info \
  --env MIGRATE_ON_START=true --env "MONGODB_URI=$breeder_uri" \
  "$image" >/dev/null
test -z "$(docker port "$breeder")"
test "$(docker exec "$breeder" id -u)" != 0
if docker exec "$breeder" sh -c 'touch /app/.write-probe' >/dev/null 2>&1; then
  echo 'Runtime filesystem is writable.' >&2
  exit 1
fi

# Probe from a separate container on the same network: proves HOST/PORT binding.
docker run --rm --network "$network" --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --entrypoint node "$image" --input-type=module -e '
  const base = "http://breeder:3000";
  const deadline = Date.now() + 60_000;
  let last = "no response";
  for (;;) {
    try {
      const response = await fetch(base + "/ready", { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) break;
      last = "HTTP " + response.status;
    } catch (error) {
      last = error.name;
    }
    if (Date.now() > deadline) throw new Error("Readiness did not reach HTTP 200 within 60 s (last: " + last + ")");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const expect = async (path, status) => {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    if (response.status !== status) throw new Error(path + " returned HTTP " + response.status + ", expected " + status);
    return response;
  };
  await expect("/health", 200);
  await expect("/breeders/me", 401);
  await expect("/verification-requests", 401);
  // API docs are enabled outside prod (APP_ENV=local) and served from production deps.
  const docs = await expect("/docs", 200);
  if (!(docs.headers.get("content-type") ?? "").includes("text/html")) throw new Error("/docs is not HTML");
  const spec = await (await expect("/openapi.json", 200)).json();
  if (typeof spec.openapi !== "string" || !spec.paths?.["/breeders/me"]) throw new Error("/openapi.json is incomplete");
'

# Startup migrations ran to completion and reset is refused for a non-personal database.
docker exec "$breeder" node apps/breeder-service/dist/database/cli.js status \
  | node --input-type=module -e '
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const status = JSON.parse(text);
    if (status.lock || status.migrations.some((item) => item.state !== "applied" || item.checksumMatches === false)) {
      console.error("Startup migrations are not fully applied");
      process.exit(1);
    }
  '
if docker exec "$breeder" node apps/breeder-service/dist/database/cli.js reset --confirm anico_breeder_local >/dev/null 2>&1; then
  echo 'Runtime allowed a reset of a non-personal database.' >&2
  exit 1
fi

# Node is PID 1 and must shut down gracefully on SIGTERM.
docker stop --time 15 "$breeder" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$breeder")" = 0

echo 'Breeder container checks passed: lean non-root read-only runtime, migrations, readiness, auth guard, API docs and graceful shutdown.'
