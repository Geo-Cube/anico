#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker with Compose is required.' >&2; exit 1; }
docker info >/dev/null
docker compose version >/dev/null

smoke_project="anico-smoke-$(date +%s)-$$"
context_image="anico/context-check:$smoke_project"
context_probe="$(mktemp apps/breeder-service/src/.env.docker-check.XXXXXX)"
printf '%s\n' 'build-context-sentinel' > "$context_probe"
export ANICO_BACKEND_PORT=0 ANICO_FRONTEND_PORT=0

compose() {
  docker compose --project-name "$smoke_project" -f infrastructure/compose.app.yaml "$@"
}

cleanup() {
  smoke_status=$?
  trap - EXIT
  if [ "$smoke_status" -ne 0 ]; then
    compose logs --tail=80 || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$context_image" >/dev/null 2>&1 || true
  rm -f "$context_probe"
  exit "$smoke_status"
}
trap cleanup EXIT

# Prove that Docker's actual context excludes local state and credentials.
base_image="$(awk '$1 == "FROM" { print $2; exit }' apps/breeder-service/Dockerfile)"
docker build --build-arg "BASE_IMAGE=$base_image" --tag "$context_image" --file - . <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /context
COPY . .
RUN test ! -e .git && test ! -e .pulumi && test ! -e node_modules \
    && test ! -e docs && test ! -e infrastructure/ansible \
    && test ! -e apps/breeder-service/.env \
    && test ! -e apps/breeder-service/tests \
    && test ! -e apps/breeder-service/dist \
    && test -e apps/breeder-service/seeds/development.mjs \
    && test "$(find infrastructure -type f | wc -l)" -eq 1 \
    && test -z "$(find apps/breeder-service/src -name '.env*' -print)"
DOCKERFILE

compose up --build --detach --wait --wait-timeout 120
backend="$(compose ps --quiet breeder-service)"
frontend="$(compose ps --quiet frontend)"
database="$(compose ps --quiet mongodb)"
backend_url="http://$(compose port breeder-service 3000)"
frontend_url="http://$(compose port frontend 8080)"

for container in "$backend" "$frontend"; do
  test "$(docker exec "$container" id -u)" -ne 0
  test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true
done
test -z "$(docker port "$database")"
docker exec "$database" mongosh --quiet --eval \
  'if (db.serverStatus().tcmalloc.usingPerCPUCaches !== false) quit(1)'
docker exec "$backend" sh -c '
  test ! -e /app/.env && test ! -e /app/.git && test ! -e /app/infrastructure \
    && test ! -e /app/apps/breeder-service/src \
    && test ! -e /app/node_modules/typescript \
    && test ! -e /app/node_modules/vitest \
    && test ! -e /app/node_modules/tsx \
    && test ! -e /app/node_modules/@pulumi
'
docker exec "$frontend" sh -c 'test ! -e /app && test ! -e /usr/share/nginx/html/.env'
docker exec "$backend" node --input-type=module -e '
  import dogs from "@anico/shared-schemas/catalogs/dog-breeds.json" with { type: "json" };
  import horses from "@anico/shared-schemas/catalogs/horse-breeds.json" with { type: "json" };
  for (const catalog of [dogs, horses]) {
    if (!catalog.breeds.length || new Set(catalog.breeds.map((breed) => breed.id)).size !== catalog.breeds.length) {
      throw new Error("Shared breed catalog is incomplete in the runtime image");
    }
  }
'
# breeder-service has no migrations yet: require a readable journal without failures or a held lock.
docker exec "$backend" node apps/breeder-service/dist/database/cli.js status \
  | node --input-type=module -e '
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const status = JSON.parse(text);
    if (!Array.isArray(status.migrations) || status.migrations.some(item => item.state !== "applied") || status.unknown?.length || status.lock) process.exit(1);
  '
if docker exec "$backend" node apps/breeder-service/dist/database/cli.js reset --confirm anico_breeder >/dev/null 2>&1; then
  echo 'Reset guard unexpectedly allowed a non-personal database.' >&2
  exit 1
fi

curl --fail --silent --show-error "$backend_url/ready" >/dev/null
# Account takeover persists a breeder profile; identity headers stand in for the gateway.
curl --fail --silent --show-error "$backend_url/breeders/me" \
  --header 'x-user-id: container-smoke' --header 'x-user-first-name: Container' \
  --header 'x-user-last-name: Smoke' --header 'x-user-email: container-smoke@example.com' \
  | node --input-type=module -e '
    let body = "";
    for await (const chunk of process.stdin) body += chunk;
    const account = JSON.parse(body);
    if (account.breederId !== "container-smoke" || account.accountState !== "NOT_SUBMITTED" || account.isVerified !== false) process.exit(1);
  '
docker exec "$database" mongosh anico_breeder --quiet --eval \
  "if (!db.breeders.findOne({breederId: 'container-smoke', hasBreedingStation: true})) quit(1)"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$backend_url/breeders/me")" = 401

html="$(curl --fail --silent --show-error "$frontend_url/")"
test "$html" = "$(curl --fail --silent --show-error "$frontend_url/nested/client-route")"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$frontend_url/assets/missing.js")" = 404
curl --fail --silent --show-error --head "$frontend_url/index.html" | tr -d '\r' | grep -qi '^Cache-Control: no-cache$'
asset_path="$(printf '%s' "$html" | node --input-type=module -e '
  let html = "";
  for await (const chunk of process.stdin) html += chunk;
  const path = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
  if (!path) process.exit(1);
  console.log(path);
')"
curl --fail --silent --show-error --head "$frontend_url$asset_path" | tr -d '\r' | grep -qi '^Cache-Control: public, max-age=31536000, immutable$'
curl --fail --silent --show-error --head "$frontend_url/" | tr -d '\r' | grep -qi '^X-Content-Type-Options: nosniff$'

# Node is PID 1 and must handle SIGTERM without being force-killed.
docker stop --time 15 "$backend" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$backend")" = 0
docker start "$backend" >/dev/null
backend_url="http://$(compose port breeder-service 3000)"

wait_for_status() {
  expected="$1"
  for attempt in $(seq 1 60); do
    actual="$(curl --max-time 2 --silent --output /dev/null --write-out '%{http_code}' "$backend_url/ready" || true)"
    if [ "$actual" = "$expected" ]; then return 0; fi
    sleep 1
  done
  echo "Readiness did not reach HTTP $expected (last response: $actual)." >&2
  return 1
}
wait_for_status 200

# A healthy HTTP process must stop reporting ready when MongoDB disappears.
docker stop --time 15 "$database" >/dev/null
wait_for_status 503
curl --fail --silent --show-error "$backend_url/health" >/dev/null
docker start "$database" >/dev/null
wait_for_status 200

echo 'Container checks passed: private context, production dependencies, non-root/read-only runtime, HTTP, persistence, SPA caching, graceful shutdown and DB recovery.'
