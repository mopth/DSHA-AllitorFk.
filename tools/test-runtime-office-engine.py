#!/usr/bin/env python3
"""Fails when dsh-runtime.bin lacks the LibreOffice WASM engine (soffice.wasm / soffice.data)."""
import importlib.util, tarfile, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'app/src/main/assets/dsh-runtime.bin'
PREFIX = 'usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/'
spec = importlib.util.spec_from_file_location('bdr', ROOT / 'tools/build-dsh-runtime.py')
bdr = importlib.util.module_from_spec(spec); spec.loader.exec_module(bdr)


class OfficeEngineTest(unittest.TestCase):
    def test_shipped_runtime_contains_office_engine(self):
        sizes = {}
        with tarfile.open(RUNTIME, 'r:gz') as archive:
            for member in archive:
                if member.isfile() and 'libreoffice-kit-wasm/assets/' in member.name:
                    sizes[member.name] = member.size
        for relative in bdr.OFFICE_ENGINE_FILES:
            name = PREFIX + relative
            self.assertIn(name, sizes, 'dsh-runtime.bin missing ' + relative)
            self.assertGreater(sizes[name], bdr.OFFICE_ENGINE_MIN_BYTES)

    def test_builder_refuses_tree_without_engine(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                bdr.require_office_engine(Path(tmp))
            for relative in bdr.OFFICE_ENGINE_FILES:
                path = Path(tmp) / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'x' * 10)
            with self.assertRaises(ValueError):  # truncated engine is refused too
                bdr.require_office_engine(Path(tmp))
            for relative in bdr.OFFICE_ENGINE_FILES:
                (Path(tmp) / relative).write_bytes(b'x' * (bdr.OFFICE_ENGINE_MIN_BYTES + 1))
            bdr.require_office_engine(Path(tmp))


if __name__ == '__main__':
    unittest.main()
