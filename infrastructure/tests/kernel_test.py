import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("kernel_status", Path(__file__).parents[1] / "scripts/kernel-status.py")
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)


class KernelTests(unittest.TestCase):
    def test_ubuntu_signature_overrides_truncated_release(self):
        version = kernel.upstream_version("7.0.0-42-generic", "Ubuntu 7.0.0-42.42-generic 7.0.24")
        self.assertEqual(version, (7, 0, 24))
        self.assertTrue(kernel.compatible(version))

    def test_incompatible_range_is_rejected(self):
        for version in [(6, 19, 0), (6, 19, 9), (7, 0, 0), (7, 0, 13)]:
            self.assertFalse(kernel.compatible(version))
        for version in [(6, 18, 9), (7, 0, 14), (7, 1, 0)]:
            self.assertTrue(kernel.compatible(version))

    def test_unknown_kernel_fails_closed(self):
        with self.assertRaises(ValueError):
            kernel.upstream_version("unknown")
