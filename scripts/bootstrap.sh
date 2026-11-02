#!/usr/bin/env bash
set -euo pipefail

# Run from any directory after checking out this repository.
cd "$(dirname "$0")/.."

mkdir -p packages/shared-schemas/src infrastructure \
  apps/breeding-service/src/modules/breeding/{domain,application,infrastructure,http} \
  apps/breeding-service/tests/{unit,integration}

# npm reads all manifests, installs root and workspace dependencies,
# links @anico/shared-schemas locally and runs prepare (Husky).
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ ! -f apps/breeding-service/.env ]]; then
  cp apps/breeding-service/.env.example apps/breeding-service/.env
fi

npm run build
npm run typecheck
npm run test:coverage
