import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validate_environments", ROOT / "scripts/validate_environments.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EnvironmentBoundariesTest(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / "environments.json").read_text())

    def test_checked_in_configuration_is_valid(self):
        self.assertEqual(MODULE.validate(self.config), self.config)

    def test_both_environments_are_required(self):
        del self.config["environments"]["prod"]
        with self.assertRaises(ValueError):
            MODULE.validate(self.config)

    def test_dev_cannot_use_production_resources(self):
        for key in ("appNetwork", "dataNetwork", "databaseVolume", "project", "hostname"):
            with self.subTest(key=key):
                config = copy.deepcopy(self.config)
                config["environments"]["dev"][key] = config["environments"]["prod"][key]
                with self.assertRaises(ValueError):
                    MODULE.validate(config)

    def test_app_and_data_networks_must_differ(self):
        dev = self.config["environments"]["dev"]
        dev["dataNetwork"] = dev["appNetwork"]
        with self.assertRaises(ValueError):
            MODULE.validate(self.config)

    def test_management_cannot_share_an_application_network(self):
        self.config["managementNetwork"] = self.config["environments"]["dev"]["appNetwork"]
        with self.assertRaises(ValueError):
            MODULE.validate(self.config)

    def test_cannot_target_system_directories(self):
        for root in ("/", "/etc", "/var/lib/docker", "/srv/../etc", "relative/path"):
            with self.subTest(root=root):
                config = copy.deepcopy(self.config)
                config["rootDirectory"] = root
                with self.assertRaises(ValueError):
                    MODULE.validate(config)

    def test_unexpected_fields_are_rejected(self):
        self.config["publicPorts"] = [27017]
        with self.assertRaises(ValueError):
            MODULE.validate(self.config)


if __name__ == "__main__":
    unittest.main()
