#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point. New developers can run npm run setup on any OS.
cd "$(dirname "$0")/.."
exec npm run setup
