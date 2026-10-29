#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ansible-playbook -i inventory.example.yml audit.yml --syntax-check
ansible-playbook -i inventory.example.yml docker.yml --syntax-check
ansible-playbook -i inventory.example.yml docker-logging.yml --syntax-check
ansible-playbook -i inventory.example.yml docker-lifecycle.yml --syntax-check
ansible-playbook -i inventory.example.yml verify-docker-lifecycle.yml --syntax-check
ansible-playbook -i inventory.example.yml environments.yml --syntax-check
ansible-playbook -i inventory.example.yml verify-environments.yml --syntax-check
ansible-playbook -i inventory.example.yml cloudflared.yml --syntax-check
ansible-playbook -i inventory.example.yml coolify.yml --syntax-check
ansible-playbook -i inventory.example.yml verify-coolify.yml --syntax-check
ansible-playbook -i inventory.example.yml application-environments.yml --syntax-check
ansible-playbook -i inventory.example.yml site.yml --syntax-check
python3 ../scripts/validate_environments.py ../environments.json
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ../tests -p '*_test.py'
python3 -c 'import ast; from pathlib import Path; ast.parse(Path("../scripts/verify-docker-lifecycle.py").read_text())'
python3 -c 'import ast; from pathlib import Path; ast.parse(Path("../scripts/verify_environment_isolation.py").read_text())'
python3 -c 'import ast; from pathlib import Path; ast.parse(Path("../scripts/verify_coolify.py").read_text())'
python3 -c 'import ast; from pathlib import Path; ast.parse(Path("../scripts/verify_admin_origin.py").read_text())'
