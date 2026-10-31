"""Report the real Ubuntu upstream kernel version without changing the host."""
import argparse
import json
import platform
import re
from pathlib import Path


def upstream_version(release, signature=""):
    text = signature.split()[-1] if signature.startswith("Ubuntu ") else release
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", text)
    if not match:
        raise ValueError("Cannot determine upstream kernel version")
    return tuple(map(int, match.groups()))


def compatible(version):
    return version >= (4, 18, 0) and not (6, 19, 0) <= version < (7, 0, 14)


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--require-safe", action="store_true")
    options = args.parse_args()
    signature_file = Path('/proc/version_signature')
    signature = signature_file.read_text().strip() if signature_file.exists() else ""
    release = platform.release()
    version = upstream_version(release, signature)
    safe = compatible(version)
    print(json.dumps({"release": release, "upstreamVersion": ".".join(map(str, version)), "mongodb8Compatible": safe}))
    if options.require_safe and not safe:
        raise SystemExit("Install a supported kernel before deploying MongoDB 8")
