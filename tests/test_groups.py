"""Topics and Cards grouped by order concern, folded, with counts in fields, and a turn switch.

Contract:
- Each topic in topics.json has a `concern`; concerns appear in the order of their first topic.
- Topics tab: `.concern[data-concern]` (details) > `.topic-card[data-topic]` > `.idea[data-unit]`, all folded at first;
  opening a group folds its open siblings. Headers carry counts as `.pill[data-count=<kind>]` with the number in `b`.
- Cards tab: grouped by concern by default (`.card-group[data-level='concern']` > `.card-group[data-level='topic']`),
  folded; a search, a status chip other than All, or a filter opens the groups that hold matching rows.
- Turn switch `#topics-turns` / `#cards-turns`: `button[data-turn]` all | 1 | 2 | 3 with a count each; it starts on the
  learner's current turn. A question's turn is its own (lean) or, for networking, 2 at depth 2 and 1 otherwise. Rows of
  other turns are hidden.
"""
from __future__ import annotations

import json

from conftest import items_by_id, open_page


def topics(files):
    return json.loads(files["pilot/practice/topics.json"])


def turn_of(it):
    return it.get("turn") or (2 if it.get("depth", 1) >= 2 else 1)


def pill(locator, kind):
    return locator.locator(f":scope > summary .pill[data-count='{kind}'] b").first.inner_text().strip()


def visible(page, selector):
    return [r for r in page.locator(selector).all() if r.is_visible()]


def test_topics_are_grouped_by_concern_with_counts(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    order = list(dict.fromkeys(t["concern"] for t in topics(seed)))
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='topics']")
    concerns = page.locator("#topics-list .concern")
    assert [c.get_attribute("data-concern") for c in concerns.all()] == order
    first = concerns.first
    mine = [t["topic"] for t in topics(seed) if t["concern"] == order[0]]
    assert pill(first, "topics") == str(len(mine))
    asked = [it for it in items.values() if it["unit"].split(".")[0] in mine and turn_of(it) == 1]
    assert pill(first, "questions") == str(len(asked))
    assert not page.locator(".topic-card").first.is_visible()


def test_opening_a_group_folds_its_siblings(context, page_origin, repo):
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='topics']")
    a, b = page.locator("#topics-list .concern").all()[:2]
    a.locator(":scope > summary").click()
    assert a.evaluate("d => d.open")
    b.locator(":scope > summary").click()
    assert b.evaluate("d => d.open") and not a.evaluate("d => d.open")


def test_cards_are_grouped_by_concern_then_topic_and_folded(context, page_origin, repo):
    seed = repo.files()
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='cards']")
    groups = page.locator("#cards-list .card-group[data-level='concern']")
    assert groups.count() == len({t["concern"] for t in topics(seed)})
    assert not visible(page, "#cards-list .card-row")
    first = groups.first
    assert first.locator(".card-group[data-level='topic']").count() >= 1
    assert int(pill(first, "questions")) > 0
    page.fill("#cards-search", "packet")
    shown = visible(page, "#cards-list .card-row")
    assert shown and all("packet" in r.inner_text().lower() for r in shown)


def test_turn_switch_shows_one_turn_and_counts_each(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='cards']")
    switch = page.locator("#cards-turns")
    assert switch.locator("button.on").get_attribute("data-turn") == "1"
    second = sum(1 for it in items.values() if turn_of(it) == 2)
    assert switch.locator("button[data-turn='2'] b").inner_text().strip() == str(second)
    switch.locator("button[data-turn='2']").click()
    page.click("#cards-filters [data-filter='all']")
    page.fill("#cards-search", " ")
    page.fill("#cards-search", "")
    for g in page.locator("#cards-list .card-group[data-level='concern']").all():
        if g.is_visible():
            g.locator(":scope > summary").click()
            inner = [t for t in g.locator(".card-group[data-level='topic']").all() if t.is_visible()]
            if inner:
                inner[0].locator(":scope > summary").click()
            break
    shown = page.locator("#cards-list .card-row").all()
    assert all(r.get_attribute("data-turn") == "2" for r in shown if r.is_visible())
    assert any(r.is_visible() for r in shown) or second == 0
