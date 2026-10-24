#!/usr/bin/env python3
"""AllitorFk B4: engines.dsh hard gate in plugin-manager.register_plugin (host test, no runtime)."""
import importlib.util, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'app/src/main/assets'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ASSETS / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


manager = load('plugin_manager_under_test', 'plugin-manager.py')
life = load('plugin_lifecycle_under_test', 'plugin-lifecycle.py')


class FakeLifecycle:
    version = '0.2.1-rc.3'

    def package_metadata(self, pkg):
        req = (pkg.get('engines') or {}).get('dsh') or ''
        ok = life.accepts_version(self.version, req) if req else None
        return {'compatibility': 'compatible' if ok is True else 'incompatible' if ok is False else 'unknown',
                'installedDsh': self.version}


manager.lifecycle = lambda: FakeLifecycle()
os.environ.pop('DSHA_PLUGIN_ALLOW_ENGINE_MISMATCH', None)
assert manager.engine_gate({'name': 'a'}) is None, 'undeclared stays advisory'
assert manager.engine_gate({'name': 'a', 'peerDependencies': {'@deepseek-ai/dsh': '0.1.0'}}) is None, 'peer stays advisory'
assert manager.engine_gate({'name': 'a', 'engines': {'dsh': '>=0.2.1-rc.1'}}) == 'compatible'
try:
    manager.engine_gate({'name': 'a', 'engines': {'dsh': '^0.1.7'}})
    raise AssertionError('mismatch must refuse')
except ValueError as error:
    assert 'engines.dsh=^0.1.7' in str(error)
os.environ['DSHA_PLUGIN_ALLOW_ENGINE_MISMATCH'] = '1'
assert manager.engine_gate({'name': 'a', 'engines': {'dsh': '^0.1.7'}}) == 'incompatible', 'explicit override'
os.environ.pop('DSHA_PLUGIN_ALLOW_ENGINE_MISMATCH')
print('PASS plugin engines.dsh gate')
