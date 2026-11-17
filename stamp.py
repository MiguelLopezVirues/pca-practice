"""Set the page version everywhere (version.json, VERSION in app.js, every ?v= stamp) before a release:
python stamp.py 2026-11-18.1"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
version = sys.argv[1]
(HERE / "version.json").write_text(json.dumps({"version": version}) + "\n", encoding="utf-8", newline="\n")
for name in ("index.html", "app.js", "github.js", "engine.js", "store.js"):
    p = HERE / name
    text = p.read_text(encoding="utf-8")
    text = re.sub(r"\?v=[\w.-]+", f"?v={version}", text)
    text = re.sub(r'const VERSION = "[^"]+"', f'const VERSION = "{version}"', text)
    p.write_bytes(text.encode("utf-8"))
print(version)
