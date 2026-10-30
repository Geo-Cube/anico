#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../ansible"
if [[ ! -f inventory.local.yml ]]; then
  echo 'Create infrastructure/ansible/inventory.local.yml before configuring applications.' >&2
  exit 1
fi
exec ansible-playbook application-environments.yml "$@"
