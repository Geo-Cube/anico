#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../ansible"

if [[ ! -f inventory.local.yml ]]; then
  echo 'Create infrastructure/ansible/inventory.local.yml from inventory.example.yml and set the SSH connection.' >&2
  exit 1
fi

# Only host configuration is applied here. Cloud APIs, DNS and firewall are separate.
exec ansible-playbook site.yml "$@"
