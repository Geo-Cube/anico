#!/usr/bin/env bash
set -euo pipefail

repository=$(git rev-parse --show-toplevel)
if [[ $(git -C "$repository" rev-parse --is-shallow-repository) != false ]]; then
  echo 'Secret scanning requires full Git history. Run git fetch --unshallow first.' >&2
  exit 1
fi

# Official release, pinned independently of the downloaded checksum manifest.
version=8.30.1
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    platform=linux_x64
    checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Linux/aarch64|Linux/arm64)
    platform=linux_arm64
    checksum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
    ;;
  Darwin/arm64)
    platform=darwin_arm64
    checksum=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5
    ;;
  Darwin/x86_64)
    platform=darwin_x64
    checksum=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709
    ;;
  *)
    echo 'Secret scanning supports macOS and Linux on x64/arm64.' >&2
    exit 1
    ;;
esac

scan_directory=$(mktemp -d "${TMPDIR:-/tmp}/anico-gitleaks.XXXXXX")
trap 'rm -rf "$scan_directory"' EXIT
archive="gitleaks_${version}_${platform}.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  --connect-timeout 10 --max-time 90 --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}" \
  --output "$scan_directory/$archive"

if command -v shasum >/dev/null 2>&1; then
  actual_checksum=$(shasum -a 256 "$scan_directory/$archive")
else
  actual_checksum=$(sha256sum "$scan_directory/$archive")
fi
if [[ ${actual_checksum%% *} != "$checksum" ]]; then
  echo 'Gitleaks checksum mismatch; scanner will not run.' >&2
  exit 1
fi
tar -xzf "$scan_directory/$archive" -C "$scan_directory" gitleaks

# Include every fetched ref, not just the latest diff. A removed secret still
# exists in Git history. Never print its value or publish scanner artifacts.
"$scan_directory/gitleaks" git "$repository" \
  --log-opts=--all --redact=100 --verbose --no-banner
