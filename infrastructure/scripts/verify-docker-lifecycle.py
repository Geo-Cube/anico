"""Test Docker lifecycle on an EMPTY host. Restarts the daemon, never the host."""

import json
import os
from pathlib import Path
import subprocess
import time
import uuid


def run(*arguments, check=True, timeout=90):
    return subprocess.run(
        arguments, text=True, capture_output=True, check=check, timeout=timeout
    )


def wait_for(predicate, description, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.25)
    raise RuntimeError("Timed out: " + description)


def inspect(container):
    return json.loads(run("docker", "inspect", container).stdout)[0]


def ensure_no_other_containers(container=None):
    ids = set(run("docker", "ps", "-aq", "--no-trunc").stdout.split())
    if ids - ({container} if container else set()):
        raise RuntimeError("This test requires an otherwise empty Docker host")


def start_daemon():
    run("systemctl", "start", "docker.socket", "docker.service")
    wait_for(
        lambda: run("docker", "info", check=False, timeout=10).returncode == 0,
        "Docker API availability",
    )


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run as root via the Ansible verification playbook")
    ensure_no_other_containers()
    info = json.loads(run("docker", "info", "--format", "{{json .}}").stdout)
    if not info["LiveRestoreEnabled"]:
        raise RuntimeError("Enable live-restore before running this test")

    image = "busybox:1.37.0"
    image_existed = run("docker", "image", "inspect", image, check=False).returncode == 0
    container = None
    daemon_stopped = False
    label = "anico.lifecycle-test=" + uuid.uuid4().hex
    try:
        run("docker", "pull", image)
        workload = """
trap 'echo ANICO_GRACEFUL_STOP; exit 0' TERM INT
echo $$ > /tmp/main.pid
while :; do
  echo heartbeat >> /tmp/heartbeat
  sleep 1 &
  wait $!
done
"""
        container = run(
            "docker", "run", "-d", "--label", label,
            "--name", "anico-lifecycle-" + uuid.uuid4().hex[:12],
            "--network", "none", "--read-only",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=8m,mode=1777",
            "--user", "65534:65534", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--init",
            "--restart", "unless-stopped", "--stop-timeout", "20",
            "--health-cmd", "test -s /tmp/heartbeat",
            "--health-interval", "1s", "--health-timeout", "1s",
            "--health-retries", "5", image, "sh", "-c", workload,
        ).stdout.strip()
        started = time.monotonic()
        wait_for(
            lambda: inspect(container)["State"].get("Health", {}).get("Status") == "healthy",
            "initial healthy state",
        )
        before = inspect(container)
        logs = before["HostConfig"]["LogConfig"]
        assert logs["Type"] == "local", logs
        assert logs["Config"].get("max-size") == "10m", logs
        assert logs["Config"].get("max-file") == "3", logs
        print("PASS: healthcheck and inherited log rotation (local, 10m x 3)", flush=True)

        ensure_no_other_containers(container)
        pid = before["State"]["Pid"]
        heartbeat = Path(f"/proc/{pid}/root/tmp/heartbeat")
        old_size = heartbeat.stat().st_size
        daemon_stopped = True
        run("systemctl", "stop", "docker.service", "docker.socket")
        assert run("systemctl", "is-active", "docker.service", check=False).returncode != 0
        # Read through /proc without a Docker API call, which could reactivate the socket.
        wait_for(lambda: heartbeat.stat().st_size > old_size, "heartbeat while daemon is stopped", 10)
        start_daemon()
        daemon_stopped = False
        after = inspect(container)
        assert after["State"]["Running"]
        assert after["State"]["Pid"] == pid
        assert after["State"]["StartedAt"] == before["State"]["StartedAt"]
        assert after["RestartCount"] == before["RestartCount"]
        print("PASS: workload progressed while Docker was down; same PID after daemon restart", flush=True)

        # Allow the initial 10-second restart-policy monitoring period to elapse.
        remaining = 11 - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
        crash = run(
            "docker", "exec", container, "sh", "-c",
            'kill -KILL "$(cat /tmp/main.pid)"', check=False,
        )
        if crash.returncode not in (0, 137):
            raise RuntimeError("Could not simulate process crash: " + crash.stderr)
        wait_for(
            lambda: inspect(container)["RestartCount"] > after["RestartCount"]
            and inspect(container)["State"].get("Health", {}).get("Status") == "healthy",
            "automatic recovery after process crash",
        )
        print("PASS: unless-stopped recovered a crashed workload to healthy state", flush=True)

        run("docker", "stop", container)
        stopped = inspect(container)
        assert not stopped["State"]["Running"]
        assert stopped["State"]["ExitCode"] == 0
        assert "ANICO_GRACEFUL_STOP" in run("docker", "logs", container).stdout
        print("PASS: SIGTERM reached the workload; graceful exit code 0", flush=True)

        ensure_no_other_containers(container)
        run("systemctl", "restart", "docker.service")
        start_daemon()
        assert not inspect(container)["State"]["Running"]
        print("PASS: intentionally stopped container stayed stopped after daemon restart", flush=True)
    finally:
        if daemon_stopped:
            start_daemon()
        if container:
            current = inspect(container)
            key, value = label.split("=", 1)
            if current["Config"]["Labels"].get(key) != value:
                raise RuntimeError("Test container ownership check failed; refusing cleanup")
            run("docker", "rm", "-f", container)
        if not image_existed:
            run("docker", "image", "rm", image)
        print("Cleanup complete: temporary test container and newly pulled image removed", flush=True)


if __name__ == "__main__":
    main()
