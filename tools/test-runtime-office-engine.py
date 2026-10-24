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

    def test_sharp_uses_native_arm64_not_wasm_fallback(self):
        names = set()
        with tarfile.open(RUNTIME, 'r:gz') as archive:
            for member in archive:
                names.add(member.name)
        self.assertFalse(any('/@img/sharp-wasm32/' in n for n in names), 'LGPL wasm fallback must not ship')
        self.assertTrue(any('/@img/sharp-linux-arm64/' in n and n.endswith('.node') for n in names))
        self.assertTrue(any('/@img/sharp-libvips-linux-arm64/' in n for n in names))
        self.assertEqual('unused-wasm-fallback', bdr.omitted(Path('@img/sharp-wasm32/lib/x.wasm')))
        self.assertEqual('', bdr.omitted(Path('@img/sharp-linux-arm64/lib/sharp.node')))

    def test_recovery_runtime_stays_on_accepted_independent_archive(self):
        import json
        lock = json.loads((ROOT / 'tools/recovery-runtime/lock.json').read_text(encoding='utf-8'))
        row = next(r for r in lock['archives'] if r['asset'] == 'recovery-dsh-runtime.bin')
        self.assertEqual('6d2a4d2efb0eed3a5a58f25753fa18d712fcba7ec65199e4641e946e00aa9853', row['sha256'])

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
