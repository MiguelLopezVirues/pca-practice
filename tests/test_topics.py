"""Page version, Topics (topic -> ideas -> questions, with what each idea builds on), idea grouping and diagram
markers in Cards.

Contract:
- `version.json` {"version"} equals `VERSION` in app.js and every `?v=` of index.html and the module imports.
  When the served version.json differs from the running page, `#update` offers a reload. Settings shows
  `#page-version` and `#explain-count` (questions with an explanation).
- Topics tab: `.topic-card[data-topic]` in reading order, each with `a.topic-note` (Obsidian), and its ideas
  `.idea[data-unit]` (concepts, statement, `.idea-req[data-unit]` for the ideas it builds on, `.idea-for` for the
  ideas that build on it) and the idea's questions as `.card-row`. Tapping `.idea-req` opens and shows that idea.
- Cards: group `[data-group='idea']`; rows whose explanation has a diagram carry `data-diagram="yes"` and an icon;
  `#filter-diagrams` keeps only those.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from conftest import PAGE_DIR, items_by_id, open_groups, open_page, shown_order

VERSION_RE = re.compile(r'const VERSION = "([^"]+)"')


def explain_files(files):
    return {json.loads(d)["topic"]: json.loads(d) for p, d in files.items() if p.startswith("pilot/practice/explain/")}


def with_diagram(files):
    return {i for o in explain_files(files).values() for i, blocks in o["items"].items() if any(b["diagrams"] for b in blocks)}


def test_version_is_the_same_everywhere():
    version = json.loads((PAGE_DIR / "version.json").read_text(encoding="utf-8"))["version"]
    assert VERSION_RE.search((PAGE_DIR / "app.js").read_text(encoding="utf-8")).group(1) == version
    for name in ("index.html", "app.js", "github.js", "engine.js", "store.js"):
        stamps = re.findall(r"\?v=([\w.-]+)", (PAGE_DIR / name).read_text(encoding="utf-8"))
        assert all(s == version for s in stamps), name
    assert re.findall(r"\?v=", (PAGE_DIR / "index.html").read_text(encoding="utf-8"))


def test_a_newer_page_offers_a_reload(context, page_origin, repo):
    page = open_page(context, page_origin, repo, practice=False)
    assert not page.locator("#update").is_visible()
    page.route("**/version.json*", lambda r: r.fulfill(json={"version": "newer"}))
    page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_selector("#update", state="visible")


def test_settings_tell_the_page_version_and_the_explanations_loaded(context, page_origin, repo):
    version = json.loads((PAGE_DIR / "version.json").read_text(encoding="utf-8"))["version"]
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='settings']")
    assert version in page.locator("#page-version").inner_text()
    n = sum(len(o["items"]) for o in explain_files(repo.files()).values())
    assert str(n) in page.locator("#explain-count").inner_text()


def test_topics_show_ideas_with_their_questions_and_links(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    ex = explain_files(seed)
    order = shown_order(seed)
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='topics']")
    assert [c.get_attribute("data-topic") for c in page.locator(".topic-card").all()] == order
    card = page.locator(".topic-card[data-topic='NF-devices-by-layer']")
    assert card.locator("a.topic-note").get_attribute("href").startswith("obsidian://open?vault=vault&file=")
    assert card.locator(".idea").count() == len(ex["NF-devices-by-layer"]["ideas"])
    idea = card.locator(".idea[data-unit='NF-devices-by-layer.1']")
    assert idea.locator(".card-row").count() == sum(1 for it in items.values() if it["unit"] == "NF-devices-by-layer.1")
    assert sorted(r.get_attribute("data-unit") for r in idea.locator(".idea-req").all()) == \
        ["NF-osi-tcpip-layers.1", "NF-osi-tcpip-layers.2", "NF-stack-at-a-glance.4"]
    target = page.locator(".idea[data-unit='NF-stack-at-a-glance.4']")
    req = ".idea[data-unit='NF-devices-by-layer.1'] .idea-req[data-unit='NF-stack-at-a-glance.4']"
    open_groups(page, req)
    page.click(req)
    assert target.is_visible()
    assert page.locator(".idea[data-unit='NF-stack-at-a-glance.4'] .idea-for").count() >= 1


def test_cards_group_by_idea_and_mark_diagrams(context, page_origin, repo):
    seed = repo.files()
    diagrams = with_diagram(seed)
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='cards']")
    assert page.locator(".card-row[data-diagram='yes']").count() == len(diagrams)
    page.click("#cards-group [data-group='idea']")
    assert page.locator("#cards-list .card-row").count() == len(items_by_id(seed))
    assert page.locator("#cards-list .group-title", has_text="Packet").count() >= 1
    page.click("#open-filters")
    page.check("#filter-diagrams")
    page.click("#filter-done")
    shown = [r for r in page.locator("#cards-list .card-row").all() if r.is_visible()]
    assert shown and all(r.get_attribute("data-diagram") == "yes" for r in shown)
