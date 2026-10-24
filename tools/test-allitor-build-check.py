#!/usr/bin/env python3
"""F1: allitor-build-check retries only transient failures and self-checks expected outputs."""
import subprocess, tempfile, os
from pathlib import Path
S = str(Path(__file__).resolve().parent / 'allitor-mcp/src/build-check.sh')
run = lambda *a: subprocess.run(['bash', S, *a], capture_output=True, text=True)
assert run('--', 'true').returncode == 0
r = run('--retries', '3', '--', 'sh', '-c', 'echo "a.kt:1: error: x"; exit 2')
assert r.returncode == 2 and 'attempt 2' not in r.stderr and 'a.kt:1' in r.stderr
with tempfile.TemporaryDirectory() as d:
    c = os.path.join(d, 'c'); Path(c).write_text('0')
    r = run('--retries', '1', '--', 'sh', '-c', f'n=$(cat {c}); echo $((n+1)) > {c}; [ $n -ge 1 ] || {{ echo ECONNRESET; exit 1; }}')
    assert r.returncode == 0 and 'success after 2' in r.stderr, r.stderr
    o = os.path.join(d, 'o'); Path(o).write_text('x')
    assert run('--expect', o, '--', 'true').returncode == 0
    assert run('--expect', os.path.join(d, 'missing'), '--', 'true').returncode == 65
assert run('--retries', 'x', '--', 'true').returncode == 64
print('build-check tests passed')
