"""Check dev/prod Docker boundaries using disposable clients and HTTP targets."""

import json
from pathlib import Path
import subprocess
import sys
import time
import uuid


def run(*arguments, check=True, timeout=60):
    return subprocess.run(arguments, capture_output=True, text=True, check=check, timeout=timeout)


def inspect(kind, name):
    return json.loads(run("docker", kind, "inspect", name).stdout)[0]


def main():
    config = json.loads(Path(sys.argv[1]).read_text())
    image = "busybox:1.37.0"
    image_existed = run("docker", "image", "inspect", image, check=False).returncode == 0
    nonce = uuid.uuid4().hex[:12]
    label = "com.anico.isolation-test=" + nonce
    containers = []
    pulled = False
    try:
        for name, env in config["environments"].items():
            app = inspect("network", env["appNetwork"])
            data = inspect("network", env["dataNetwork"])
            volume = inspect("volume", env["databaseVolume"])
            assert not app["Internal"] and data["Internal"]
            for resource in (app, data, volume):
                assert resource["Labels"]["com.anico.environment"] == name
                assert resource["Labels"]["com.anico.managed-by"] == "ansible"
        print("PASS: separate environment resources and internal data networks", flush=True)

        run("docker", "pull", image)
        pulled = True
        clients = {}
        targets = {}

        def container(name, network, command):
            cid = run(
                "docker", "run", "-d", "--name", name, "--label", label,
                "--network", network, "--read-only", "--user", "65534:65534",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=1m,mode=1777",
                image, "sh", "-c", command,
            ).stdout.strip()
            containers.append(cid)
            return cid

        for name, env in config["environments"].items():
            target = container(
                f"anico-isolation-{nonce}-{name}-target", env["dataNetwork"],
                f"echo {name} > /tmp/index.html; exec httpd -f -p 8080 -h /tmp",
            )
            targets[name] = inspect("container", target)["NetworkSettings"]["Networks"][env["dataNetwork"]]["IPAddress"]
            client = container(
                f"anico-isolation-{nonce}-{name}-client", env["appNetwork"], "exec sleep 300"
            )
            run("docker", "network", "connect", env["dataNetwork"], client)
            clients[name] = client

        for name in ("dev", "prod"):
            own_url = f"http://{targets[name]}:8080/"
            deadline = time.monotonic() + 15
            while True:
                result = run("docker", "exec", clients[name], "wget", "-q", "-T", "2", "-O", "-", own_url, check=False)
                if result.returncode == 0 and result.stdout.strip() == name:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError(f"{name} cannot reach its own data network: {result.stderr}")
                time.sleep(0.2)
            print(f"PASS: {name} application probe can reach its own data network", flush=True)

            other = "prod" if name == "dev" else "dev"
            cross_url = f"http://{targets[other]}:8080/"
            result = run("docker", "exec", clients[name], "wget", "-q", "-T", "2", "-O", "-", cross_url, check=False)
            if result.returncode == 0:
                raise RuntimeError(f"Isolation failed: {name} reached {other} data network")
            print(f"PASS: {name} application probe cannot reach {other} data network by IP", flush=True)
    finally:
        for cid in reversed(containers):
            details = inspect("container", cid)
            if details["Config"]["Labels"].get("com.anico.isolation-test") != nonce:
                raise RuntimeError("Ownership check failed; refusing container cleanup")
            run("docker", "rm", "-f", cid)
        if pulled and not image_existed:
            run("docker", "image", "rm", image)
        print("Cleanup complete: temporary probes removed; environment networks and volumes preserved", flush=True)


if __name__ == "__main__":
    main()
