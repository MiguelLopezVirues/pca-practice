"""Fixtures for the practice page tests: a fake GitHub seeded with real practice data, the page server,
a cached Pyodide, and the desktop engine (CPython) as the reference the page must match."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
import threading
import urllib.request
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from fake_github import FakeRepo, serve

PAGE_DIR = Path(__file__).resolve().parents[1]
STUDY = Path(os.environ.get("PCA_STUDY_DIR", PAGE_DIR.parent / "pca-study"))
CACHE = Path(__file__).resolve().parent / ".cache"
T0 = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)
STATE = "pilot/practice/state/"
STATE_FILES = {STATE + n for n in ("state.json", "reviews.tsv", "credits.tsv", "unlocks.tsv", "answers.jsonl")}
TEST_CONFIG = {"new_order": "depth", "daily_new_cap": 30, "depth2_tiers": ["core"], "enable_fuzzing": False}
FIRST_TOPIC = "NF-stack-at-a-glance"


# ---------- the desktop engine as reference ----------
def _materialize(files: dict[str, bytes], root: Path):
    for path, data in files.items():
        p = root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


def _engine_module(root: Path):
    spec = importlib.util.spec_from_file_location(f"engine_{id(root)}", root / "pilot/practice/engine.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses look their module up here
    spec.loader.exec_module(mod)
    return mod


def _read_back(root: Path) -> dict[str, bytes]:
    return {p: (root / p).read_bytes() for p in STATE_FILES if (root / p).exists()}


def desktop_apply(files: dict[str, bytes], steps, tmp: Path) -> dict[str, bytes]:
    """Apply steps with the CPython engine on a copy of `files`; return the state files it writes.
    A step is ("read", topic, time) or ("record", item, rating, time[, prompt id]); the prompt id defaults to card:1."""
    root = tmp / f"ref{len(list(tmp.glob('ref*')))}"
    _materialize(files, root)
    mod = _engine_module(root)
    practice = root / "pilot/practice"
    eng = mod.Engine.load(practice)
    for step in steps:
        if step[0] == "read":
            eng.mark_read(step[1], step[2])
        elif step[0] == "turn":
            eng.set_turn(step[1], step[2])
        else:
            eng.record(step[1], step[2], step[3], prompt_id=step[4] if len(step) > 4 else "card:1")
    eng.save(practice)
    return _read_back(root)


def desktop_queue(files: dict[str, bytes], now, tmp: Path) -> list[str]:
    root = tmp / f"q{len(list(tmp.glob('q*')))}"
    _materialize(files, root)
    eng = _engine_module(root).Engine.load(root / "pilot/practice")
    return eng.queue(now)


def topics_with_concern(files: dict[str, bytes]) -> list[dict]:
    """topics.json, each topic with its concern from lean/concerns.tsv (by id prefix)."""
    rows = files["lean/concerns.tsv"].decode("utf-8-sig").splitlines()
    head = rows[0].split("\t")
    names = {c[head.index("prefix")]: c[head.index("concern")] for c in (r.split("\t") for r in rows[1:] if r.strip())}
    return [{**t, "concern": names.get(t["topic"].split("-")[0], "Other")}
            for t in json.loads(files["pilot/practice/topics.json"])]


def items_by_id(files: dict[str, bytes]) -> dict[str, dict]:
    """Networking items and lean questions (items_lean), by id."""
    out = {}
    for path, data in files.items():
        if path.startswith(("pilot/practice/items/", "pilot/practice/items_lean/")) and path.endswith(".json"):
            for it in json.loads(data):
                out[it["id"]] = it
    return out


def seed_files(tmp: Path, mutate_items=None) -> dict[str, bytes]:
    """Real practice data from pca-study, the test config, and a state with the first topic read at T0."""
    files = {
        "graph-tools/tsv_write.py": (STUDY / "graph-tools/tsv_write.py").read_bytes(),
        "pilot/idea_links.tsv": (STUDY / "pilot/idea_links.tsv").read_bytes(),
        "lean/idea_links.tsv": (STUDY / "lean/idea_links.tsv").read_bytes(),
        "lean/path.tsv": (STUDY / "lean/path.tsv").read_bytes(),
        "lean/concerns.tsv": (STUDY / "lean/concerns.tsv").read_bytes(),
        "pilot/relevance_final.tsv": (STUDY / "pilot/relevance_final.tsv").read_bytes(),
        "pilot/practice/engine.py": (STUDY / "pilot/practice/engine.py").read_bytes(),
        "pilot/practice/config.json": json.dumps(TEST_CONFIG).encode(),
        "pilot/practice/topics.json": (STUDY / "pilot/practice/topics.json").read_bytes(),
        "README.md": b"unrelated file the page never needs\n",
    }
    for f in sorted((STUDY / "pilot/practice/items").glob("*.json")):
        files[f"pilot/practice/items/{f.name}"] = f.read_bytes()
    for f in sorted((STUDY / "pilot/practice/items_lean").glob("*.json")):
        files[f"pilot/practice/items_lean/{f.name}"] = f.read_bytes()
    for f in sorted((STUDY / "pilot/practice/explain").glob("*.json")):
        files[f"pilot/practice/explain/{f.name}"] = f.read_bytes()
    if mutate_items:
        mutate_items(files)
    files.update(desktop_apply(files, [("read", FIRST_TOPIC, T0)], tmp))
    return files


# ---------- servers ----------
@pytest.fixture
def repo(tmp_path):
    r = FakeRepo()
    r.seed(seed_files(tmp_path))
    server = serve(r)
    r.api = f"http://127.0.0.1:{server.server_address[1]}"
    yield r
    server.shutdown()


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def page_origin():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(PAGE_DIR)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


# ---------- browser ----------
_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
          ".json": "application/json", ".zip": "application/zip"}


def _pyodide_from_cache(route):
    url = route.request.url
    local = CACHE / url.split("://", 1)[1].split("?")[0]
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        part = local.with_suffix(local.suffix + ".part")
        with urllib.request.urlopen(url, timeout=600) as resp, open(part, "wb") as out:
            shutil.copyfileobj(resp, out)
        part.replace(local)
    route.fulfill(path=str(local), headers={"Content-Type": _TYPES.get(local.suffix, "application/octet-stream"),
                                            "Access-Control-Allow-Origin": "*"})


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    # practice.test stands for a host that is not localhost
    return {**browser_type_launch_args, "args": ["--host-resolver-rules=MAP practice.test 127.0.0.1"]}


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "service_workers": "block"}


@pytest.fixture
def context(context):
    context.route("https://cdn.jsdelivr.net/pyodide/**", _pyodide_from_cache)
    context.clock.set_fixed_time(T0)
    return context


def page_url(origin, repo, extra=""):
    return f"{origin}/index.html?api={repo.api}&repo={repo.owner}/{repo.name}{extra}"


def open_page(context, origin, repo, token="good-token", practice=True):
    """Open the page; enter the token if the form shows; wait until it has settled.
    With practice=True, start practice from Today when there is something to practise."""
    page = context.new_page()
    page.goto(page_url(origin, repo))
    page.wait_for_function(
        "() => { const s = document.querySelector('#status'); "
        "return s && s.dataset.state !== 'loading' || !document.querySelector('#token-form')?.hidden; }",
        timeout=120_000)
    if token is not None and page.locator("#token-form").is_visible():
        page.fill("#token", token)
        page.click("#token-save")
    if settle(page) == "ready" and practice:
        page.click("#start")
        page.wait_for_selector("#view-practice", state="visible")
    return page


def settle(page, timeout=120_000):
    page.wait_for_function(
        "() => { const s = document.querySelector('#status'); "
        "return s && s.dataset.state !== 'loading'; }", timeout=timeout)
    return page.locator("#status").get_attribute("data-state")


def save_now(page, timeout=120_000):
    """Tap the sync button and wait until nothing is being saved; return the sync state."""
    page.click("#sync")
    page.wait_for_function(
        "() => { const s = document.querySelector('#sync'); "
        "return s && s.dataset.state !== 'saving' && "
        "(s.dataset.state !== 'idle' || document.querySelector('#pending').dataset.count === '0'); }",
        timeout=timeout)
    return page.locator("#sync").get_attribute("data-state")


def open_groups(page, inner):
    """Unfold the folded groups around the first element matching `inner`, outermost first, as a learner would."""
    n = page.locator(inner).first.evaluate("""el => {
        const path = [];
        for (let d = el.closest('details'); d; d = d.parentElement.closest('details')) path.unshift(d);
        path.forEach((d, i) => d.setAttribute('data-path', i));
        return path.length; }""")
    for i in range(n):
        d = page.locator(f"details[data-path='{i}']")
        if not d.evaluate("d => d.open"):
            d.locator(":scope > summary").click()
    page.evaluate("() => document.querySelectorAll('[data-path]').forEach(d => d.removeAttribute('data-path'))")


def click_row(page, item_id):
    row = f".card-row[data-item='{item_id}']"
    open_groups(page, row)
    page.click(row)


# the two-step self-grading: rating -> buttons clicked after revealing
STEPS = {1: ["#know-no"], 2: ["#know-yes", "#came-effort"], 3: ["#know-yes", "#came-moment"],
         4: ["#know-yes", "#came-instantly"]}


def next_card(page, before):
    """Wait until the page has moved past the card whose front was `before` (the answer is stored asynchronously)."""
    page.wait_for_function(
        "prev => document.querySelector('#card-front').innerText !== prev"
        " || !document.querySelector('#done').hidden || !document.querySelector('#explain-view').hidden",
        arg=before)


def rate(page, rating):
    """No and With effort open the explanation first; 'Next card' moves on."""
    before = page.locator("#card-front").inner_text()
    page.click("#reveal")
    for selector in STEPS[rating]:
        page.click(selector)
    if rating in (1, 2):
        page.click("#explain-next")
    next_card(page, before)
    return settle(page)


def plain(text):
    """Text without the markdown subset the page renders, whitespace collapsed: compares a source text with what shows."""
    text = re.sub(r"(?m)^\|[-:| ]+\|\s*$", "", text)
    text = re.sub(r"(?m)^\s*(- |\d+\. )", "", text)
    text = text.replace("**", "").replace("`", "").replace("==", "").replace("|", " ")
    return re.sub(r"\s+", " ", text).strip()
