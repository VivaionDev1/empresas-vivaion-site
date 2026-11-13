#!/usr/bin/env python3
"""Adversarial regression tests for the HML archive extractor."""
from __future__ import annotations

import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "safe-extract-release.py"
spec = importlib.util.spec_from_file_location("safe_release_extractor", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def regular(name: str, data: bytes = b"sample"):
    m = tarfile.TarInfo(name)
    m.size = len(data)
    return m, data


def special(name: str, typecode: bytes, link: str = ""):
    m = tarfile.TarInfo(name)
    m.type = typecode
    m.linkname = link
    return m, None


class TestStrictExtract(unittest.TestCase):
    def run_case(self, members, accepted=False):
        with tempfile.TemporaryDirectory(prefix="empresas-archive-review-") as base:
            base = pathlib.Path(base)
            archive = base / "candidate.tgz"
            target = base / "extracted"
            target.mkdir()
            with tarfile.open(archive, mode="w:gz") as writer:
                for member, data in members:
                    writer.addfile(member, io.BytesIO(data) if data is not None else None)
            if accepted:
                result = module.extract_strict(archive, target)
                self.assertEqual(result["files"], 1)
                self.assertEqual((target / "frontend/dist/index.html").read_bytes(), b"sample")
            else:
                with self.assertRaises(ValueError):
                    module.extract_strict(archive, target)
                # Validation happens before extraction: not even first safe entry was created.
                self.assertEqual(list(target.iterdir()), [])

    def test_allowed_regular_file(self):
        self.run_case([regular("frontend/dist/index.html")], accepted=True)

    def test_symlink_rejected_before_any_extraction(self):
        self.run_case([regular("frontend/dist/index.html"),
                       special("frontend/dist/link", tarfile.SYMTYPE, "../outside")])

    def test_hardlink_rejected_before_any_extraction(self):
        self.run_case([regular("frontend/dist/index.html"),
                       special("frontend/dist/link", tarfile.LNKTYPE, "frontend/dist/index.html")])

    def test_device_rejected_before_any_extraction(self):
        self.run_case([regular("frontend/dist/index.html"),
                       special("frontend/dist/device", tarfile.CHRTYPE)])

    def test_path_traversal_rejected(self):
        self.run_case([regular("frontend/dist/index.html"),
                       regular("../outside/canary")])

    def test_hidden_sensitive_file_rejected(self):
        self.run_case([regular("frontend/dist/index.html"),
                       regular("backend/dist/.env")])

    def test_unexpected_root_file_rejected(self):
        self.run_case([regular("frontend/dist/index.html"),
                       regular("secret.txt")])

    def test_duplicate_file_rejected(self):
        self.run_case([regular("frontend/dist/index.html"), regular("frontend/dist/index.html")])

    def test_newline_in_filename_rejected(self):
        self.run_case([regular("frontend/dist/index.html"),
                       regular("frontend/dist/unsafe\nname.txt")])


if __name__ == "__main__":
    unittest.main()
