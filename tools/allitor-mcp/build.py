#!/usr/bin/env python3
"""Reproducible tree tar for the allitor-tools .dshx pack (own code, MIT)."""
import io, tarfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / 'dist/allitor-mcp-tree.tar'
FILES = {'allitor-mcp/lib/mcp-core.mjs': HERE/'src/mcp-core.mjs', 'allitor-mcp/lib/server.mjs': HERE/'src/server.mjs',
         'allitor-mcp/LICENSE': HERE.parents[1]/'LICENSE', 'allitor-mcp/README.md': HERE/'README.md'}
BIN = b'#!/bin/sh\nexec node "$(dirname "$(readlink -f "$0")")/../lib/server.mjs" "$@"\n'
def add(t, name, data, mode):
    i = tarfile.TarInfo(name); i.size = len(data); i.mode = mode; i.mtime = 0; i.uid = i.gid = 0; i.uname = i.gname = ''
    t.addfile(i, io.BytesIO(data))
def main():
    OUT.parent.mkdir(exist_ok=True); buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.PAX_FORMAT) as t:
        add(t, 'allitor-mcp/bin/allitor-build-check', (HERE/'src/build-check.sh').read_bytes(), 0o755)
        add(t, 'allitor-mcp/bin/allitor-mcp', BIN, 0o755)
        for n in sorted(FILES): add(t, n, FILES[n].read_bytes(), 0o644)
    OUT.write_bytes(buf.getvalue())
    import hashlib; print(OUT, hashlib.sha256(buf.getvalue()).hexdigest())
if __name__ == '__main__': main()
