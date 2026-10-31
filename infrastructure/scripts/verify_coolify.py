#!/usr/bin/env python3
"""Read-only checks of the deployed management stack. Never print environment secrets."""
import json
import subprocess
import sys
from pathlib import Path

settings = json.loads(Path(sys.argv[1]).read_text())
expected = {
    "coolify": ("coolify", {"coolify", settings["databaseNetwork"]}),
    "coolify-db": ("postgres", {settings["databaseNetwork"]}),
    "coolify-redis": ("redis", {settings["databaseNetwork"]}),
    "coolify-proxy": ("proxy", {"coolify", "anico-dev-app"}),
}
result = []
for name, (image_key, networks) in expected.items():
    container = json.loads(subprocess.check_output(["docker", "inspect", name]))[0]
    assert container["State"]["Running"], f"{name} is not running"
    assert container["State"]["Health"]["Status"] == "healthy", f"{name} is not healthy"
    assert container["Config"]["Image"] == settings["images"][image_key], f"{name} image drift"
    actual_networks = set(container["NetworkSettings"]["Networks"])
    if name == 'coolify-proxy':
        metadata = Path('/data/coolify/source/anico/dev-deployment-metadata.json')
        allowed = networks | ({json.loads(metadata.read_text())['uuid']} if metadata.exists() else set())
        assert networks <= actual_networks <= allowed, 'Proxy network drift'
    else:
        assert actual_networks == networks, f"{name} network drift"
    bindings = container["HostConfig"]["PortBindings"] or {}
    if name == "coolify":
        assert set(bindings) == {"8080/tcp", "6001/tcp", "6002/tcp"}
        assert all(binding["HostIp"] == "127.0.0.1" for values in bindings.values() for binding in values)
    else:
        assert not bindings, f"{name} publishes host ports"
    assert container["HostConfig"]["LogConfig"] == {
        "Type": "local", "Config": {"max-file": "3", "max-size": "10m"}
    }, f"{name} log rotation drift"
    assert container["HostConfig"]["RestartPolicy"]["Name"] == "unless-stopped"
    if name in {"coolify-db", "coolify-redis"}:
        assert any(m.get("Name") == name for m in container["Mounts"]), f"{name} persistence missing"
    result.append({"name": name, "health": "healthy", "startedAt": container["State"]["StartedAt"]})
network = json.loads(subprocess.check_output(["docker", "network", "inspect", settings["databaseNetwork"]]))[0]
assert network["Internal"], "Management database network must be internal"
assert {v["Name"] for v in network["Containers"].values()} == {"coolify", "coolify-db", "coolify-redis"}
agent = json.loads(subprocess.check_output(["docker", "inspect", "coolify-sentinel"]))[0]
assert agent["State"]["Running"] and agent["State"]["Health"]["Status"] == "healthy"
assert agent["Config"]["Labels"].get("coolify.managed") == "true"
assert not agent["HostConfig"]["PortBindings"], "Server agent must not publish ports"
assert set(agent["NetworkSettings"]["Networks"]) == {"coolify"}
subprocess.run(["docker", "exec", "coolify", "php", "/anico/verify.php"], check=True)
print(json.dumps({"containers": result, "networkAndPortChecks": "passed"}))
