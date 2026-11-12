import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / "scripts/anico-watchdog.sh"
URL = "https://hc-ping.com/5c9f1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"


def call(function, stdin="", *args):
    # $0 differs from the script path, so sourcing does not run main.
    return subprocess.run(
        ["bash", "-c", f'source "$1"; shift; {function} "$@"', "watchdog-test", str(SCRIPT), *args],
        input=stdin, capture_output=True, text=True, check=True,
    ).stdout


class ContainerHealthTests(unittest.TestCase):
    def test_only_unhealthy_or_crashing_containers_fail(self):
        listing = "\n".join([
            "/coolify\trunning\thealthy\t1",
            "/coolify-db\trunning\tnone\t1",
            "/anico-glitchtip\trunning\tstarting\t0",
            "/anico-dev-events\trunning\tunhealthy\t0",
            "/anico-dev-old\texited\tnone\t0",
            "/anico-dev-loop\trestarting\tnone\t0",
            "coolify-proxy\tmissing\tnone\t1",
        ]) + "\n"
        self.assertEqual(
            call("container_failures", listing).splitlines(),
            ["anico-dev-events unhealthy", "anico-dev-loop restarting", "coolify-proxy missing"],
        )

    def test_thresholds(self):
        self.assertEqual(call("disk_failure", "", "84"), "")
        self.assertIn("85%", call("disk_failure", "", "85"))
        self.assertEqual(call("disk_failure", "", ""), "disk usage unknown\n")
        self.assertEqual(call("memory_failure", "", str(201 * 1024)), "")
        self.assertIn("200 MiB", call("memory_failure", "", str(200 * 1024)))


class MainTests(unittest.TestCase):
    """Run the whole script with stubbed docker, df and curl."""

    def run_main(self, docker_ok=True, unhealthy=False, disk="40%", memory_kib=900000):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "curl.log"
            state = "unhealthy" if unhealthy else "healthy"
            stubs = {
                "docker": f"""#!/usr/bin/env bash
{'exit 1' if not docker_ok else ''}
case "$1" in
  version) echo 27.0 ;;
  ps)
    case "$*" in
      *com.anico.environment=dev*) echo dev123 ;;
      *com.anico.role=monitoring*) echo abc123 ;;
    esac ;;
  inspect)
    shift 2
    for id in "$@"; do
      case "$id" in
        abc123) printf '/anico-glitchtip\\trunning\\t{state}\\t0\\n' ;;
        dev123) printf '/anico-dev-app\\trunning\\thealthy\\t0\\n' ;;
        *) printf '/%s\\trunning\\thealthy\\t1\\n' "$id" ;;
      esac
    done ;;
esac
""",
                "df": f"#!/usr/bin/env bash\necho 'Use%'\necho ' {disk}'\n",
                "curl": f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {calls}\n",
            }
            for name, body in stubs.items():
                path = root / name
                path.write_text(body)
                path.chmod(0o755)
            meminfo = root / "meminfo"
            meminfo.write_text(f"MemTotal: 3900000 kB\nMemAvailable: {memory_kib} kB\n")
            environment = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "ANICO_WATCHDOG_PING_URL": URL,
                "ANICO_WATCHDOG_MEMINFO": str(meminfo),
            }
            result = subprocess.run(["bash", str(SCRIPT)], env=environment, capture_output=True, text=True)
            return result, calls.read_text() if calls.exists() else ""

    def test_success_pings_base_url(self):
        result, calls = self.run_main()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(calls.strip().endswith(URL))
        self.assertNotIn("/fail", calls)

    def test_checks_both_dev_and_monitoring_containers(self):
        result, calls = self.run_main(unhealthy=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("anico-glitchtip unhealthy", calls)
        self.assertNotIn("anico-dev-app", calls)

    def test_failures_post_reasons_without_values(self):
        result, calls = self.run_main(unhealthy=True, disk="91%", memory_kib=100 * 1024)
        self.assertEqual(result.returncode, 1)
        self.assertIn(URL + "/fail", calls)
        self.assertIn("anico-glitchtip unhealthy", calls)
        self.assertIn("disk / 91% used", calls)
        self.assertIn("memory available 100 MiB", calls)

    def test_docker_outage_still_reports_failure(self):
        result, calls = self.run_main(docker_ok=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("docker unavailable", calls)
        self.assertIn(URL + "/fail", calls)

    def test_invalid_url_never_pings(self):
        environment = {**os.environ, "ANICO_WATCHDOG_PING_URL": "https://example.com/x"}
        result = subprocess.run(["bash", str(SCRIPT)], env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
