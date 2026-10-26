#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../ansible"
if [[ ! -f inventory.local.yml ]]; then
  echo 'Create infrastructure/ansible/inventory.local.yml before deploying.' >&2
  exit 1
fi
exec ansible-playbook coolify.yml "$@"
