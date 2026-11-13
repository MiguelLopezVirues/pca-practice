"""Fill tests/.cache with the Pyodide files the page loads (the tests serve them from there).

On networks that stall the CDN's zip, unpack `npm pack pyodide@314.0.7` and pass its package folder:
    python tests/fetch_pyodide.py <path to package>
"""
import shutil
import sys
import urllib.request
from pathlib import Path

BASE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/"
CACHE = Path(__file__).resolve().parent / ".cache" / "cdn.jsdelivr.net/pyodide/v314.0.7/full"
FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]


def get(name, local_package=None):
    out = CACHE / name
    if out.exists() and out.stat().st_size:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    part = out.with_suffix(out.suffix + ".part")
    if local_package:
        shutil.copyfile(Path(local_package) / name, part)
    else:
        with urllib.request.urlopen(BASE + name, timeout=600) as r:
            part.write_bytes(r.read())
    part.replace(out)
    print(f"{name}: {out.stat().st_size // 1024} KB", flush=True)


for n in FILES:
    get(n, sys.argv[1] if len(sys.argv) > 1 else None)
